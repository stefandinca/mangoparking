# SmartBill integration — current state (where we left off)

> **Working status file.** Point-in-time snapshot of the SmartBill fiscal-invoicing
> work so it can be resumed on another machine / session. The formal plan lives in
> [roadmap/v.1.2_smartbill.md](roadmap/v.1.2_smartbill.md); credential handling is
> in [smartbill-demo.md](smartbill-demo.md).
>
> Last updated: 2026-07-16. Latest relevant commit: `a6b36e6` (on `origin/main`).

---

## TL;DR — where we are

- **Phase 1 (foundations): DONE.** REST wrapper + admin healthcheck built, three
  secrets set in Secret Manager, healthcheck ran **green** (invoice series present,
  21% VAT found → account is a VAT payer).
- **Phase 2 pre-flight (payload checkpoint): BUILT, partially verified.** An
  admin-only `smartbillTestIssue` callable issues sample documents and deletes
  them, to confirm SmartBill accepts our payload shape before wiring the money path.
- **BLOCKED on a SmartBill account-side permission**, not on our code: the API
  token's user lacks proforma rights. Fiscal-invoice payload was **accepted**
  (as a draft); proforma failed with a permissions error.
- **Phase 2 real wiring (issue on payment): NOT STARTED.** Waiting on the
  checkpoint going fully green.

## Last checkpoint result (`Test document issue`)

- **Invoice (draft): ✓** — SmartBill accepted the fiscal-invoice payload (issued
  with `isDraft:true`, so NOT fiscalized / not e-Factura-reported). A draft named
  series **"Mango"** was left on the account (draft invoices return no fiscal
  number to delete against) → **delete it manually** in SmartBill (Facturi → Ciorne).
- **Proforma: ✗** — `Nu poti emite proforma. Lipsesc drepturile de: emitere
  proforma, acces serii (ACR).` → the API **user** is missing rights. Fix in
  SmartBill (Setări → Utilizatori/Drepturi): enable **emitere proformă** +
  **acces serii**, and ensure a proforma (estimate) series exists. Or swap the
  secrets to a full-rights user (same company/CIF) — see smartbill-demo.md.

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
  - `smartbillHealthcheck` — read-only: lists invoice series + taxes, returns
    `{ ready, series, taxes, hasExpectedVat, expectedVatPercent }`.
  - `smartbillTestIssue` — the checkpoint. Issues + deletes a **PF proforma**, a
    **PJ proforma** (validates regCom+locality mapping), and a **PF fiscal draft**.
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

`SMARTBILL_USERNAME`, `SMARTBILL_TOKEN`, `SMARTBILL_CIF` — all set (version 1).
Bound per-function via `secrets: SMARTBILL_SECRETS`.

---

## How to run / verify

Admin login required. Either `npm run dev` locally and log in as admin, or use the
deployed site. Go to **`/admin/pricing`** → SmartBill card:

1. **Check SmartBill connection** → `smartbillHealthcheck`.
2. **Test document issue** → `smartbillTestIssue` (issues + deletes samples).

The two callables are deployed and live. The frontend buttons are on `origin/main`
(deployed via Vercel on push to main).

## Next steps (resume here)

1. **Unblock proforma** — grant the API user *emitere proformă* + *acces serii* in
   SmartBill, OR swap secrets to a full-rights user (same company/CIF) per
   `smartbill-demo.md`, then redeploy `smartbillHealthcheck` + `smartbillTestIssue`.
2. **Delete the stray "Mango" draft** invoice from the earlier checkpoint run.
3. **Re-run Test document issue** → expect Proforma (PF) ✓, Proforma (PJ) ✓,
   Invoice (draft) ✓.
4. **Phase 2 — wire issuance into the paid flows** (`createBookingFromOrder`,
   `adminMarkOrderPaid`, credit path): proforma up front everywhere; fiscal invoice
   auto on online-paid, manual on pay-at-location. Flip `isDraft:false`. Persist the
   issued `{ series, number }` onto the booking/order doc (new `smartbill` field —
   not written by any flow yet). Guard every issue with `checkBillingComplete`.
5. **Later phases** — customer email of the PDF (SmartBill `/document/send`,
   `type: factura|proforma`), storno on refund/cancel (`reverseInvoice`), e-Factura
   for B2B VAT payers.

## Known caveats

- **Draft invoices can't be auto-deleted** via API (no fiscal number returned) →
  the checkpoint may leave draft strays; delete them in the SmartBill UI.
- A **real** (`isDraft:false`) fiscal invoice in RO is legally binding and
  auto-reported to ANAF via e-Factura. Phase 2 mints real invoices on every
  online payment — factor this into refund/storno handling.
- Cancel/reverse verbs in `smartbill.js` are community-SDK convention, flagged
  PROVISIONAL until exercised against the account.
