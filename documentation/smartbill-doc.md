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
- **Phase 2 pre-flight (payload checkpoint): DONE.** `smartbillTestIssue`
  (button on `/admin/pricing`) issues + deletes sample documents. Drafts are
  number-less (SmartBill numbers at fiscalization) → each run leaves a ciornă
  to delete manually (Facturi → Ciorne).
- **Phase 4 + 4b: DONE (2026-07-17).** Cancellation invalidates the documents:
  proforma deleted in every branch (`cancelBookingWithRefund`,
  `cancelPendingCreditOrder`, scheduled `markNoShows`/`expireStaleHolds` —
  unpaid only; paid no-shows forfeit and keep their invoice); auto-issued
  invoice → **anulare** same fiscal day, **storno** (`/invoice/reverse`)
  later, stored under `smartbill.storno` with SmartBill's public
  `documentViewUrl`. Reprice: unpaid re-quote replaces the proforma; paid
  extension/overstay → proforma for the difference (`smartbill.extraProformas`,
  desk money → manual invoice); paid shortening → **partial storno**
  (negative-line invoice, `smartbill.partialStornos`) when we auto-issued the
  original. All verbs verified live 2026-07-17; statuses now include
  `cancelled` | `storno` | `cancel-failed`; `smartbill.proformaDeleted` marks
  a dropped proforma.
- **Phase 2 real wiring: DONE (2026-07-17), client-verified.** `smartbillIssueSafe` (index.js) issues: **proforma** on every
  order (`createPayment`; `adminCreateLongtermBooking` non-broker;
  `grantCreditsForCash`; skipped when a voucher covers the full amount) and
  **fiscal invoice** on online payment confirm (`netopiaCallback` — new
  bookings, repays at `repayAmount`, credit packs). Pay-at-location fiscal
  invoices stay MANUAL in the SmartBill UI (locked decision) —
  `adminMarkOrderPaid` issues nothing. Best-effort: failures stamp
  `smartbill.status='failed'` + `lastError`; money flows never break. Outcome
  shape: `smartbill.{proforma,invoice,status,lastError}` on
  `pendingOrders`/`bookings`/`tokenTransactions`, rules-protected
  (server-written only). Fixed alongside: `sanitizeBilling` dropped PJ
  `locality`/`county`, which would have failed every PJ document.

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

## Mandatory invoice fields (per SmartBill account config + client feedback 2026-07-17)

- **PF (persoană fizică)** — required: **Nume, Prenume, Județ + Localitate**
  (linked dropdowns). Optional: Adresă, CNP.
- **PJ (persoană juridică)** — required: **CUI, Nume companie, Județ +
  Localitate, Nr. reg. com. (J...)**. Optional: the rest.
- **În afara României (abroad)** — checkbox on every billing form; lifts the
  Județ/Localitate requirement. Documents issue under **BUCUREȘTI/BUCUREȘTI**
  and PF gets CNP **0000000000000** (`ABROAD_CNP`, mirrored client + server).

Enforced client-side in `BillingFields.js` (+ CreateTransactionModal + the
collect-payment dialog) and server-side by `checkBillingComplete()` (fails
BEFORE calling SmartBill with a precise list of missing fields).

## Document line descriptions (client spec 2026-07-17)

- Long-term: `Servicii parcare conform rezervării {code}` — the reservation
  number is minted at ORDER time (`pendingOrders.bookingCode`) so even the
  order-time proforma carries it; `createBookingFromOrder` reuses it.
- Credits: `Servicii parcare - credite`.
- One line per document, quantity 1, price = VAT-inclusive charged total.

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

1. ~~Unblock proforma~~ **done 2026-07-16** — secrets v2 (full-rights user).
2. ~~Phase 2 wiring~~ **done 2026-07-17** — proforma + invoice on the paid flows
   (see TL;DR above); functions + rules deployed.
3. **VERIFY with real money paths** (this is the current step):
   - a small online booking (or Netopia sandbox if `NETOPIA_ENV` permits) →
     proforma at order time (MANGO 000X) + fiscal invoice on confirm (Mango 0060),
     amounts and client data correct in the SmartBill UI;
   - a desk reservation + a desk credit sale → proforma each, no auto invoice;
   - a PJ order → regCom/locality present on the document;
   - delete any leftover test ciorne (Facturi → Ciorne).
4. ~~Phase 4 — storno on cancel/refund + 4b reprice adjustments~~ **done
   2026-07-17** (see TL;DR). Verify once with a real cancellation of a paid
   test booking: expect anulare/storno visible in SmartBill + proforma gone.
5. ~~Phase 5/6 — surfacing~~ **done 2026-07-17** (plain invoices have no public
   URL — verified — so a proxy was built):
   - **`invoicePdf` HTTP function** streams the PDF from SmartBill; auth =
     possession of the unguessable doc id (`?order=` / `?booking=` / `?tx=` +
     `&doc=invoice|proforma|storno`), same trust model as `/pay`. Works for
     guests; embeddable in emails BEFORE the invoice exists (early click →
     graceful 404). Frontend base URL: `INVOICE_PDF_URL` in `constants.js`;
     builder `invoicePdfLink()` in `invoiceService.js`.
   - **Customer**: BookingHistory rows link invoice/proforma (+ storno);
     pending credit orders link their proforma.
   - **Admin**: BookingDetailModal shows a "Documente" row with all links.
   - **Emails**: `booking-longterm-confirm` + `credit-purchase` now receive
     `params.invoiceUrl` (online-paid) and `params.proformaUrl` — ⚠️ the
     Brevo TEMPLATES must be edited (Brevo UI) to render download buttons
     from these params; until then the params are simply unused.
   - Cashbook invoice column: dropped — desk invoices are manual (decision 1a),
     `cashEntries.invoiceNumber` never gets stamped.
6. **Phase 7/8 — retry queue for `smartbill.status='failed'` docs; e-Factura**
   (B2B VAT payers; needs `isVatPayer` persisted on PJ billing — currently not
   stored by `readBilling`, comes from `lookupCui` at capture time).

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
