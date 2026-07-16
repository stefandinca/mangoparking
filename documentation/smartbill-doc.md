# SmartBill integration — current state (where we left off)

> **Working status file.** Point-in-time snapshot of the SmartBill fiscal-invoicing
> work so it can be resumed on another machine / session. The formal plan lives in
> [roadmap/v.1.2_smartbill.md](roadmap/v.1.2_smartbill.md); credential handling is
> in [smartbill-demo.md](smartbill-demo.md).
>
> Last updated: 2026-07-16 (second pass — new credentials + pinned series).

---

## TL;DR — where we are

- **Phase 1 (foundations): DONE.** REST wrapper + admin healthcheck built, three
  secrets set in Secret Manager, healthcheck ran **green**.
- **Credentials swapped 2026-07-16** (secret versions **2**) to a full-rights
  user — this was the fix for the earlier proforma-rights blocker
  (`Lipsesc drepturile de: emitere proforma, acces serii`). Both functions
  redeployed to bind the new versions.
- **Series pinned in code** (`functions/src/smartbill.js`): fiscal-invoice
  series **`Mango`** (type `f`, nextNumber 60 at pin time), proforma series
  **`MANGO`** (type `p`, nextNumber 1). ⚠️ The two names differ **only by
  case**, and the casing on the account is the opposite of what was first
  communicated — GET /series is the source of truth. Resolution is
  case-insensitive within each document type (`matchSeries()`), so a rename
  between casings keeps working; the account's exact spelling is what gets
  sent when issuing. The healthcheck verifies both resolve; `smartbillTestIssue`
  issues ONLY into these (missing series = hard per-slot error, no fallback).
- **Phase 2 pre-flight (payload checkpoint): BUILT.** An admin-only
  `smartbillTestIssue` callable issues sample documents and deletes them, to
  confirm SmartBill accepts our payload shape before wiring the money path.
  Last full run was under the old (rights-limited) token: draft invoice
  **accepted**, proforma blocked → needs a re-run with the new credentials.
- **Phase 2 real wiring (issue on payment): NOT STARTED.** Waiting on the
  checkpoint going fully green.

## Last checkpoint result (`Test document issue`)

> Run under the OLD rights-limited token — superseded by the 2026-07-16
> credential swap; re-run to refresh.

- **Invoice (draft): ✓** — SmartBill accepted the fiscal-invoice payload (issued
  with `isDraft:true`, so NOT fiscalized / not e-Factura-reported). A draft on
  series **"Mango"** was left on the account (draft invoices return no fiscal
  number to delete against) → **delete it manually** in SmartBill (Facturi → Ciorne).
- **Proforma: ✗** — `Nu poti emite proforma. Lipsesc drepturile de: emitere
  proforma, acces serii (ACR).` → resolved by swapping the secrets to a
  full-rights user (2026-07-16, secret versions 2).

## Account series (pinned 2026-07-16, from GET /series)

| Document | Series name | SmartBill type | Next number at pin | Code constant (`smartbill.js`) |
|---|---|---|---|---|
| Fiscal invoice | **`Mango`** | `f` | 60 | `INVOICE_SERIES` |
| Proforma (estimate) | **`MANGO`** | `p` | 1 | `PROFORMA_SERIES` |

The names differ **only by case** (and the shared account also carries the
company's other series: RENT, ACR, TRO, OTP/…). `matchSeries()` resolves the
pinned name case-insensitively within each type and issuing always uses the
account's exact spelling, so a cosmetic rename between casings won't break
anything.

## Document model (decided 2026-07-16)

Every order issues a **proforma** up front. Fiscal invoice follows by payment path:

| Flow | Proforma | Fiscal invoice |
|------|----------|----------------|
| Online-paid (Netopia confirmed / voucher-covered) | yes, up front | **yes**, auto, once payment confirmed |
| Pay-at-location | yes, up front | **no** — issued **manually** after cash is collected |
| Credit-pack purchase | follows the same rule by payment method | |

Implication: **two SmartBill series** are needed — a proforma series (type `p`)
and an invoice series (type `f`). This supersedes the earlier "one series for
everything" idea.

## Mandatory invoice fields (per SmartBill account config)

- **PF (persoană fizică)** — required: **Nume, Prenume, Localitate**. Optional:
  Adresă, CNP.
- **PJ (persoană juridică)** — required: **CUI, Nume companie, Localitate,
  Nr. reg. com. (J...)**. Optional: the rest.

Enforced client-side in `BillingFields.js` and server-side by
`checkBillingComplete()` (fails BEFORE calling SmartBill with a precise list of
missing fields).

---

## What's built — file by file

### Backend (`functions/src/`)

- **`smartbill.js`** — REST wrapper. Base `https://ws.smartbill.ro/SBORO/api`,
  HTTP Basic auth, `errorText`-on-HTTP-200 failure handling. Exports:
  - Secrets: `SMARTBILL_USERNAME/TOKEN/CIF`, `SMARTBILL_SECRETS`, `sellerCif()`.
  - `DEFAULT_VAT_PERCENT = 21`.
  - Read: `listSeries(type)` (`'p'`=proforma, `'f'`=invoice), `listTaxes()`.
  - Invoice: `issueInvoice(payload)`, `deleteInvoice(series, number)`,
    `invoicePdfUrl()`.
  - Proforma (estimate): `issueEstimate(payload)`, `deleteEstimate(series, number)`,
    `estimatePdfUrl()`.
  - Mutations (PROVISIONAL, not yet used): `cancelInvoice`, `reverseInvoice` (storno).
  - `buildInvoicePayload({billing, items, seriesName, issueDate, isDraft, ...})` —
    maps PF/PJ billing → SmartBill client + product lines. PJ now sends `regCom`;
    both send `city` (locality) + `county`. `isDraft:true` = non-fiscalized draft.
  - `checkBillingComplete(billing)` → `{ ok, missing:[...] }` mandatory-field guard.
- **`index.js`** — two admin-only callables (both `europe-west1`, bind `SMARTBILL_SECRETS`):
  - `smartbillHealthcheck` — read-only: lists invoice + proforma series and taxes,
    returns `{ ready, hasInvoiceSeries, hasProformaSeries, hasExpectedVat, series,
    proformaSeries, taxes, ... }`. `ready` requires the pinned `MANGO` (f) and
    `Mango` (p) series to both exist plus 21% VAT.
  - `smartbillTestIssue` — the checkpoint. Issues + deletes a **PF proforma**, a
    **PJ proforma** (validates regCom+locality mapping), and a **PF fiscal draft** —
    strictly into the pinned series (missing series = per-slot error, no fallback).
    Returns `{ ok, proforma, proformaCompany, invoice }`; a `STRAY` field on any
    slot means a test doc was left behind (needs manual cleanup).
- **`cui.js`** — `lookupCui` (ANAF) now also returns `locality` + `county` from
  the seat block, so PJ billing can carry a separate localitate.

### Frontend (`src/`)

- **`services/invoiceService.js`** — `smartbillHealthcheck()`, `smartbillTestIssue()`
  callable wrappers.
- **`pages/admin/AdminPricing.js`** — SmartBill card with two buttons ("Check
  connection", "Test document issue") + result rendering (PF/PJ proforma + draft rows).
- **`components/widgets/BillingFields.js`** — PJ form gained a **mandatory
  Localitate** field (ANAF-autofilled); `regCom` promoted to required. `readBilling`
  returns `locality` for PJ. (PF already had name + locality.)
- **`i18n/ro.js` + `en.js`** — `smartbill.*` keys incl. `testIssue*`.

### Secrets (Google Secret Manager, project `mango-parking`)

`SMARTBILL_USERNAME`, `SMARTBILL_TOKEN`, `SMARTBILL_CIF` — all at **version 2**
(2026-07-16: swapped to a full-rights user to unblock proforma issuing). Bound
per-function via `secrets: SMARTBILL_SECRETS`; both callables redeployed after
the swap. Local scratch copy of the values lives in
`documentation/smartbill-creds.md` — **gitignored**, never commit it.

---

## How to run / verify

Admin login required. Either `npm run dev` locally and log in as admin, or use the
deployed site. Go to **`/admin/pricing`** → SmartBill card:

1. **Check SmartBill connection** → `smartbillHealthcheck`.
2. **Test document issue** → `smartbillTestIssue` (issues + deletes samples).

The two callables are deployed and live. The frontend buttons are on `origin/main`
(deployed via Vercel on push to main).

## Next steps (resume here)

1. ~~Unblock proforma~~ **done 2026-07-16** — secrets swapped to a full-rights
   user (versions 2), both callables redeployed, series pinned in code.
2. **Delete the stray "Mango" draft** invoice from the earlier checkpoint run
   (SmartBill UI → Facturi → Ciorne).
3. **Re-run Check connection + Test document issue** (`/admin/pricing`) → expect
   `ready` (both series + VAT) and Proforma (PF) ✓, Proforma (PJ) ✓,
   Invoice (draft) ✓.
4. **Phase 2 — wire issuance into the paid flows** (`createBookingFromOrder`,
   `adminMarkOrderPaid`, credit path): proforma up front everywhere; fiscal invoice
   auto on online-paid, manual on pay-at-location. Flip `isDraft:false`. Persist the
   issued `{ series, number }` onto the booking/order doc (new `smartbill` field —
   not written by any flow yet). Guard every issue with `checkBillingComplete`.
5. **Later phases** — customer email of the PDF (SmartBill `/document/send`,
   `type: factura|proforma`), storno on refund/cancel (`reverseInvoice`), e-Factura
   for B2B VAT payers.

## Numbering semantics (verified on the live account 2026-07-16)

- **Drafts (ciorne) have no number.** SmartBill assigns a fiscal number at
  validation/fiscalization, not at draft creation — a ciornă shows as just
  "Mango" in the UI and does **not** consume a number (`nextNumber` for the
  `Mango` f-series stayed at 60 after the draft test). The first real Phase 2
  invoice (`isDraft:false`) will be **Mango 0060**, continuing the client's
  existing sequence.
- **Deleting the last document frees its number.** The checkpoint's PF and PJ
  test proformas both show as MANGO 0001 because each was deleted right after
  issue, rolling the counter back — nothing is burned (`nextNumber` stayed 1).
  The proforma series `MANGO` is brand new, so the first real proforma will be
  **MANGO 0001**; there is no earlier proforma sequence to continue.

## Known caveats

- **Draft invoices can't be auto-deleted** via API (no fiscal number to delete
  against) → each checkpoint run leaves one draft stray; the report's `STRAY`
  field now says so explicitly. Delete them in SmartBill → Facturi → Ciorne.
- A **real** (`isDraft:false`) fiscal invoice in RO is legally binding and
  auto-reported to ANAF via e-Factura. Phase 2 mints real invoices on every
  online payment — factor this into refund/storno handling.
- Cancel/reverse verbs in `smartbill.js` are community-SDK convention, flagged
  PROVISIONAL until exercised against the account.
