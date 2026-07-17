# Mango Parking v1.2 — SmartBill Integration

> **Status: 🟢 PHASES 1–2 DONE (documents issue on the paid flows); Phases 4–8 PLANNED**
> (updated 2026-07-17). Phase 2 is live: `createPayment` issues a **proforma** on
> every order, `netopiaCallback` issues the **fiscal invoice** on online payment
> confirm (bookings, repays, credit packs), `adminCreateLongtermBooking`
> (non-broker) + `grantCreditsForCash` issue proformas for desk sales. All via
> `smartbillIssueSafe` (best-effort — a SmartBill failure stamps
> `smartbill.status='failed'` + `lastError`, never breaks a money flow). The
> `smartbill` field is rules-protected (server-written only). Phase 3 as
> originally written is **superseded** by decision 1a — pay-at-location fiscal
> invoices are issued manually in the SmartBill UI, so `adminMarkOrderPaid`
> issues nothing. **First real documents pending verification** — see the Phase 2
> checkpoint below.
>
> **New in this pass — the Phase 2 pre-flight checkpoint.** Before wiring
> SmartBill into the money path, `smartbillTestIssue` (admin callable, button on
> `/admin/pricing`) verifies the exact payload shape SmartBill accepts: it issues
> a **real proforma** (`POST /estimate`, non-fiscal) and a **draft fiscal invoice**
> (`POST /invoice` with `isDraft:true`, so it is NOT fiscalized / e-Factura-reported)
> from a sample, then deletes both. A `STRAY` marker on the result means a test
> document was left behind and needs manual cleanup. Once this reads OK, Phase 2
> flips `isDraft:false` and wires issuance into the paid flows.
>
> **Document model (decided 2026-07-16):** every order gets a **proforma** up
> front. Online-paid orders additionally get a **fiscal invoice** once payment is
> confirmed. Pay-at-location orders get **proforma only** — the fiscal invoice is
> issued manually after cash is collected. This means TWO series (a proforma
> series, type `p`, and an invoice series, type `f`), superseding the earlier
> "one series for everything" decision.
>
> **Deploy note:** `smartbillHealthcheck` and `smartbillTestIssue` bind
> `SMARTBILL_USERNAME` / `SMARTBILL_TOKEN` / `SMARTBILL_CIF`, so
> `firebase deploy --only functions` will fail until those three secrets exist in
> Secret Manager (they now do — versions **2**, swapped 2026-07-16 to a
> full-rights user after the first token lacked proforma rights).
>
> **Series (pinned 2026-07-16, from GET /series):** fiscal-invoice series
> **`Mango`** (type `f`), proforma series **`MANGO`** (type `p`) — constants
> `INVOICE_SERIES` / `PROFORMA_SERIES` in `functions/src/smartbill.js`. The
> names differ only by case; `matchSeries()` resolves case-insensitively within
> each type and issues under the account's exact spelling.

## Goal

Issue Romanian fiscal invoices (facturi) automatically from every paid order — Netopia online, admin cash, admin card — with auto-paired chitanță for cash flows, e-Factura submission for B2B, and proper storno on cancellation. Customers and admins can download the PDF straight from the booking row.

Documentation: <https://api.smartbill.ro/>

---

## Locked decisions

1. **Series strategy** — ~~one series for everything~~ **superseded 2026-07-16**: two series are required — a **proforma** series (type `p`) and a **fiscal invoice** series (type `f`) — because every order issues a proforma and only paid orders issue a fiscal invoice. Within each type, one series covers both product lines (parking + credits).
1a. **Proforma vs fiscal split** — **online-paid**: proforma at order creation + fiscal invoice once Netopia/voucher confirms payment. **Pay-at-location**: proforma only; the fiscal invoice is created manually after cash is collected. Credit-pack purchases follow the same rule by payment method.
2. **Cash flows** — emit **factură + chitanță** automatically (SmartBill auto-pairs when `paymentBase` is set). No bon fiscal route.
3. **PF without CNP** — factură for everyone, PF or PJ, CNP or no CNP. Romanian fiscal law accepts name + address as identifier for PF.
4. **e-Factura** — auto-submit to ANAF SPV for any invoice where the client is a VAT payer (PJ with CUI returned `isTaxPayer: true` from ANAF). Skip for PF.
5. **VAT rate** — **21%** standard rate (Romania's 2026 rate). Configured server-side; if SmartBill account is non-VAT-payer, code branches to `taxPercentage: 0`.
6. **County + locality mandatory** (client, 2026-07-17) — every invoice carries the client's **Județ + Localitate**, captured via linked dropdowns (dataset: `src/data/roLocalities.js`). An **"outside Romania"** checkbox lifts the requirement: documents issue under **BUCUREȘTI/BUCUREȘTI** and PF gets CNP `0000000000000` on the invoice and stored profile.
7. **Line descriptions** (client, 2026-07-17) — long-term: `Servicii parcare conform rezervării {reservation number}` (the code is minted at order time so the proforma already carries it); credits: `Servicii parcare - credite`.

---

## What SmartBill gives us

- REST API at `https://ws.smartbill.ro/SBORO/api` — HTTP Basic auth (username = SmartBill account email, password = API token from SmartBill admin → My Account → Integrations → API Information). **Note:** the host is `ws.smartbill.ro`, not `api.smartbill.ro` (that's the docs site); an earlier draft of this doc had it wrong in one place. The code sample in §1.2 already uses the correct host.
- Endpoints used:
  - `POST /invoice` — issue factura. Returns `{ series, number, url }` (public PDF link).
  - `POST /invoice/cancel` — clean cancel (same fiscal day only, no VAT impact).
  - `POST /invoice/creditnote` — storno (refund/credit note). Used for prior-day cancellations.
  - `GET /invoice/pdf` — PDF stream (already in `url` from issue response; this is a fallback).
  - `POST /einvoice` — submit invoice to ANAF SPV (e-Factura, B2B mandate).
  - `GET /einvoice/status/{uploadId}` — poll e-Factura status (`OK` | `NOK` | `IN_PROGRESS`).
  - `GET /tax` — list VAT rates available in the account (called once at boot to verify 21% exists).
  - `GET /series` — list series by type (`f` invoices, `p` proformas). The healthcheck verifies both pinned series exist.
- Series are configured in SmartBill's admin UI; we pass `seriesName: 'Mango'` (invoices, type `f`) or `seriesName: 'MANGO'` (proformas, type `p`) in every request body — pinned as constants in `smartbill.js`, resolved case-insensitively against the account.
- SmartBill returns **HTTP 200** with `{ errorText: "...", number: 0 }` on validation failures. Don't trust HTTP status alone — always check `errorText`.

---

## Existing repo plumbing we'll reuse

- Billing object on `bookings`, `pendingOrders`, `tokenTransactions` with PF/PJ split: `{ type, firstName, lastName, cnp?, address, locality, companyName?, cui?, regCom?, companyAddress? }` — populated by `BillingFields.js`.
- ANAF CUI lookup (`cuiService.js` → callable `lookupCui`) — already returns `isVatPayer`, which feeds into the e-Factura decision.
- Three paid flows already exist in `functions/src/index.js`:
  - `createBookingFromOrder` (Netopia success branch)
  - `adminMarkOrderPaid` (cash/card mark-paid for unpaid bookings & credit orders)
  - `adminCreateLongtermBooking` + `grantCreditsForCash` (direct over-the-counter sales)
- Cancellation: `cancelBookingWithRefund` callable.
- Brevo Trigger Email (writes to `mail` collection) — extend templates to include invoice PDF link.
- `auditLog` collection — used for every issue/cancel/storno.

---

## Phase 1 — Foundations (~0.5 day)

> **Built 2026-07-16:** the wrapper (`functions/src/smartbill.js`) and the
> healthcheck callable (§1.4) are in the codebase. What remains in Phase 1 is
> operational: set the three secrets (§1.1) and run the healthcheck once. The
> `smartbill` doc-shape (§1.3) is documented but not yet written by any flow —
> that lands with Phase 2. Corrections found while building: the base host is
> `ws.smartbill.ro` (§reconciliation note); `POST /invoice` returns series+number
> but **not** a public PDF link (the authenticated `/invoice/pdf` URL needs Basic
> auth — Phase 6's "public link" assumption is the V2 issue variant, to confirm);
> and the cancel/reverse/delete verbs in the wrapper are the community-SDK
> convention, flagged PROVISIONAL until the sandbox confirms them.

### 1.1 Secrets

- `firebase functions:secrets:set SMARTBILL_USERNAME`
- `firebase functions:secrets:set SMARTBILL_TOKEN`
- `firebase functions:secrets:set SMARTBILL_CIF` (your fiscal code, RO format `RO12345678` or unprefixed)

Bind all three on every callable/trigger that issues invoices — list in `secrets: [SMARTBILL_USERNAME, SMARTBILL_TOKEN, SMARTBILL_CIF]`.

### 1.2 New `functions/src/smartbill.js`

```js
const BASE = 'https://ws.smartbill.ro/SBORO/api';

async function smartbillFetch(path, init = {}) {
  const user = process.env.SMARTBILL_USERNAME;
  const tok  = process.env.SMARTBILL_TOKEN;
  const auth = Buffer.from(`${user}:${tok}`).toString('base64');
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (body.errorText) throw new Error(`SmartBill: ${body.errorText}`);
  if (!res.ok) throw new Error(`SmartBill HTTP ${res.status}`);
  return body;
}

export function buildInvoicePayload({ billing, items, paymentMethod, paymentBase = 'OP', dueDateIso }) { /* … */ }
export async function issueInvoice(payload) { /* POST /invoice */ }
export async function cancelInvoice({ seriesName, number }) { /* POST /invoice/cancel */ }
export async function creditNote({ seriesName, number, items }) { /* POST /invoice/creditnote */ }
export async function submitEinvoice({ seriesName, number }) { /* POST /einvoice */ }
export async function einvoiceStatus(uploadId) { /* GET /einvoice/status/{uploadId} */ }
```

### 1.3 Doc-shape extension

`smartbill` field on `bookings`, `pendingOrders`, `tokenTransactions` — **as
implemented in Phase 2** (two-document model; the original single-invoice shape
below it is superseded):

```js
smartbill: {
  proforma: { series: 'MANGO', number: 12, issuedAt: '2026-07-17T...' },  // absent until issued
  invoice:  { series: 'Mango', number: 60, issuedAt: '2026-07-17T...' },  // online-paid only
  status: 'proforma-issued' | 'invoiced' | 'failed',
  lastError: null | 'billing incomplete: regCom' | 'SmartBill: ...',
}
```

Written via dot-path updates so the invoice stamp never clobbers the proforma
block. `attempts` + `eFactura` sub-blocks arrive with Phases 7–8 (retry queue,
ANAF SPV). PDF URLs are NOT stored — SmartBill's PDF endpoints need Basic auth,
so Phase 5 will proxy through a callable instead of persisting a public link.

Server-written only — enforced in `firestore.rules`: `bookings` staff
create/update reject any write touching `smartbill`; `tokenTransactions` client
creates reject it; `pendingOrders` already allow no client writes.

### 1.4 Boot validation

Add a one-shot callable `smartbillHealthcheck` (admin-only). Calls `/series` and `/tax`, surfaces what's configured. Run it once after deploy to confirm `MNG` series exists and 21% VAT is present.

---

## Phase 2 — Auto-issue on online payment (~0.5 day)

> **Built 2026-07-17.** Implementation differs from the sketch below (which
> predates the two-document model): issuance lives in `smartbillIssueSafe`
> (`index.js`), wired at four points — `createPayment` (proforma, every order,
> skipped when a voucher covers the full amount), `netopiaCallback` (fiscal
> invoice on IPN success — new bookings, repays at `repayAmount`, credit packs),
> `adminCreateLongtermBooking` (proforma, non-broker; broker money never passes
> through us), `grantCreditsForCash` (proforma). Items are one line at the
> VAT-inclusive charged total (`Parcare termen lung N zile — PLATE` /
> `Credite parcare ManGO — N credite`), issueDate is the Europe/Bucharest date,
> and both pinned series must resolve or nothing is issued. Stored shape (see
> §1.3): `smartbill.{proforma,invoice,status,lastError}` via dot-path updates.
> `creditTokens` now returns `{ balanceDocId, txId }` so credit documents stamp
> onto the `tokenTransactions` row. `sanitizeBilling` fix folded in: it dropped
> PJ `locality` (and `county`), which would have failed every PJ document
> against `checkBillingComplete`.

Original sketch (kept for reference):

`functions/src/index.js` → `createBookingFromOrder`:

After the booking doc is created (Netopia success path), call:

```js
try {
  const inv = await smartbill.issueInvoice(
    smartbill.buildInvoicePayload({
      billing: order.customerData.billing,
      items: itemsFromOrder(order),
      paymentMethod: 'Card online',
      paymentBase: 'OP',
    })
  );
  await bookingRef.update({
    smartbill: {
      series: inv.series, number: inv.number, pdfUrl: inv.url,
      status: 'issued', issuedAt: nowIso(), eFactura: null, lastError: null, attempts: 1,
    },
  });
} catch (err) {
  await bookingRef.update({
    smartbill: { status: 'failed', lastError: String(err.message), attempts: 1 },
  });
}
```

**Critical:** invoice failures must not break the booking flow. The customer paid; the doc must exist. Phase 7's retry queue picks failures up.

Same pattern for the credits branch (`tokenTransactions/{id}` after `creditTokens`).

---

## Phase 3 — Auto-issue on cash/admin flows (~0.5 day)

> **Superseded by decision 1a (2026-07-16).** Pay-at-location money gets a
> proforma up front and a **manually issued** fiscal invoice after collection —
> no auto factură/chitanță from `adminMarkOrderPaid`. The table below is kept in
> case the client later wants desk invoices automated after all.

| Source | `paymentMethod` | `paymentBase` |
|---|---|---|
| `adminMarkOrderPaid` with `paidBy: 'cash'` | `Numerar` | `Chitanta` (auto-pairs chitanță) |
| `adminMarkOrderPaid` with `paidBy: 'card'` | `Card` | `Bon fiscal` |
| `adminCreateLongtermBooking` (direct cash) | `Numerar` | `Chitanta` |
| `grantCreditsForCash` (direct cash) | `Numerar` | `Chitanta` |

Every call writes to the source doc's `smartbill` block. Card flows skip chitanță auto-pairing.

Cashbook entries get the invoice number stamped on `cashEntries.invoiceNumber` for the per-agent report (phase 5).

---

## Phase 4 — Cancellation → storno (~0.5 day)

`cancelBookingWithRefund`:

```js
const existing = bookingDoc.data().smartbill;
if (!existing || existing.status === 'failed') {
  // nothing to invalidate
} else if (existing.status === 'issued' && sameDay(existing.issuedAt)) {
  await smartbill.cancelInvoice({ seriesName: existing.series, number: existing.number });
  patch.smartbill = { ...existing, status: 'cancelled' };
} else if (existing.status === 'issued') {
  const cn = await smartbill.creditNote({ seriesName: existing.series, number: existing.number, items: existing.items });
  patch.smartbill = { ...existing, status: 'credit-noted', creditNoteNumber: cn.number };
}
```

If the original was e-Factura, the storno/cancel also needs to submit to ANAF. Same `submitEinvoice` call, marked with `isCancellation: true` flag in our doc to distinguish.

### 4b. Reprice (date/hour edits) → invoice adjustment (client-flagged 2026-07-16)

The client flagged: a paid booking whose dates/hours are edited changes total, and
the customer owes (or is owed) a difference. The **money side already exists**
server-side — `adminRepriceBooking` (admin edit modal on `/admin/checkins`)
re-derives the price authoritatively, then: unpaid → re-quote (booking +
pending-order amount rewritten); paid + extension → difference collected at the
desk (cash → cashbook, card → terminal) into `extensionPrice` + an `extension`
ledger row; paid + shortened → difference queued in Refunds
(`pendingRefundAmount`). What SmartBill adds on top once Phase 2/3 issue documents:

| Case | Document state | Action |
|---|---|---|
| Unpaid (pay-at-location) reprice | proforma only | delete old proforma + issue new one at the new total (proformas delete cleanly) |
| Paid + extension (difference > 0) | fiscal invoice issued | issue a **second fiscal invoice for the difference** (line: "Extindere rezervare {code}"), paired chitanță if cash — do NOT storno+reissue (keeps trail simple, mirrors the existing `extension` ledger row) |
| Paid + shortened (difference < 0) | fiscal invoice issued | **partial storno** for the difference — needs API verification: SmartBill's `/invoice/reverse` reverses a whole invoice; the partial variant is issuing an invoice with negative quantities/amounts (community convention, VERIFY in sandbox) |

Wire-up point: `adminRepriceBooking` (and `adminChargeOverstay`, same shape —
an overstay is an extension collected at checkout). Both already write ledger
rows; the invoice call rides the same branch. Customer-initiated online payment
of a difference (a `repayOrder`-style Netopia link for the delta) does **not
exist** and is out of scope for v1.2 — differences are settled at the desk.

---

## Phase 5 — Customer + admin PDF access (~0.5 day)

- `src/pages/account/BookingHistory.js` — each row: `Descarcă factura` link if `smartbill.pdfUrl`. Falls back to `—` when missing or failed.
- `src/pages/admin/AdminCheckIns.js` + `AdminTransactions.js`:
  - Same download link.
  - `Re-emite factura` button (admin/agent) when `smartbill.status === 'failed'` — calls new callable `adminReissueInvoice({ collection, docId })`.
- `src/pages/admin/AdminCashbook.js` — entry rows + report tables get an Invoice column (number, links to PDF). Sourced from `cashEntries.invoiceNumber` + `cashEntries.invoiceUrl`.

---

## Phase 6 — Email attachment via Brevo (~0.25 day)

- Brevo templates `booking-longterm-confirm-ro/en` and `credit-purchase-ro/en` already render via the `mail` collection.
- Pass `params.invoiceUrl` and `params.invoiceNumber` when writing the `mail` doc.
- Update Brevo templates to render a `Descarcă factura PDF` button below the main CTA.
- SmartBill's public PDF URL is the link target — no upload to our storage, no signed URLs to manage. Caveat: anyone with the URL can fetch it (SmartBill design, not ours).

---

## Phase 7 — Retry queue + reconciliation (~0.5 day)

`functions/src/scheduled.js` → new `retryFailedInvoices` (every 30 min, `europe-west1`):

```js
const stuck = await db.collectionGroup('bookings')
  .where('smartbill.status', '==', 'failed')
  .where('smartbill.attempts', '<', 3)
  .get();
// + same for pendingOrders + tokenTransactions
```

For each: retry `issueInvoice`, increment `attempts`, update status. After 3 failures, leave it for manual admin intervention.

Admin dashboard (`/admin/dashboard`):
- New tile "Facturi neemise" with count and a link to a filtered view.
- Manual `Re-emite` button per row.

Firestore indexes: composite indexes on `(smartbill.status, smartbill.attempts)` for each of the three collections.

---

## Phase 8 — e-Factura (B2B mandate) (~0.5 day)

- After every issue where `billing.type === 'PJ'` AND `billing.isVatPayer === true` (set by `lookupCui` at booking time): call `smartbill.submitEinvoice({ seriesName, number })`.
- Store `uploadId` on `smartbill.eFactura`.
- New scheduled function `pollEinvoiceStatus` (every 1h):
  - Query for docs where `smartbill.eFactura.status == 'IN_PROGRESS'`.
  - Call `einvoiceStatus(uploadId)`. If terminal (`OK` or `NOK`), update doc.
  - `NOK` surfaces in the admin retry banner with `statusText`.
- Same flow for storno/cancel — the cancellation event must also be submitted to ANAF.

This phase is **mandatory for compliance** since 2024 — RO B2B e-Factura is enforced. Skipping it is a fiscal risk, not just a feature gap.

---

## File-level touch summary

**New files (~3):**
- `functions/src/smartbill.js` — REST wrapper + payload builders
- `functions/src/einvoice.js` (optional, kept separate so phase 8 is feature-flaggable)
- `src/services/invoiceService.js` — client wrappers for `reissue` / status queries

**Modified files (~10):**
- `functions/src/index.js` — issue calls in 4 paid-flow paths; storno in cancel path; new `adminReissueInvoice` + `smartbillHealthcheck` callables
- `functions/src/scheduled.js` — `retryFailedInvoices`, `pollEinvoiceStatus`
- `functions/src/emails.js` — pass invoice params into Brevo writes
- `firestore.rules` — `smartbill` field readable by staff + owning customer, write-only by server
- `firestore.indexes.json` — composite indexes for retry queries
- `src/pages/account/BookingHistory.js` — invoice download link
- `src/pages/admin/AdminCheckIns.js`, `AdminTransactions.js` — invoice column + retry button
- `src/pages/admin/AdminCashbook.js` — invoice column on entries + reports
- `src/pages/admin/AdminDashboard.js` — failed-invoices banner
- `src/i18n/ro.js` + `en.js` — `invoice.*` keys (`download`, `reissue`, `failed`, `pending`, `efacturaStatus`, …)

---

## Verification checkpoints

Run after each phase, not just at the end.

### Phase 1
- `smartbillHealthcheck` returns `ready: true` — `Mango` resolves among the invoice (`f`) series, `MANGO` among the proforma (`p`) series, and a 21% VAT rate is present.
- Hand-write a payload via Node REPL → invoice appears in SmartBill dashboard with expected client + product lines.

### Phase 2
- Pay a sandbox Netopia order. Within ~5s, `bookings/{id}.smartbill.pdfUrl` populated; opening it shows the correct booking dates, plate, amount, VAT 21%.
- Force a failure (revoke token temporarily) → `smartbill.status === 'failed'`, booking doc still created.

### Phase 3
- Cash mark-paid on an unpaid booking → factură + chitanță visible in SmartBill (auto-paired).
- Card mark-paid → factură only, `paymentMethod: 'Card'`.
- Cashbook page shows the invoice number column populated.

### Phase 4
- Same-day cancel → SmartBill shows the invoice cancelled (no second doc).
- Prior-day cancel → SmartBill shows a credit note paired with the original; both PDFs accessible.

### Phase 5
- Customer's `BookingHistory` row shows "Descarcă factura" → opens correct PDF.
- Admin force-fails an invoice → "Re-emite" button appears; clicking it retries and clears the banner.

### Phase 6
- Booking confirmation email arrives with "Descarcă factura PDF" button → opens correct PDF.

### Phase 7
- Manually write `smartbill: { status: 'failed', attempts: 1 }` on a booking → next scheduled tick retries; if mock continues failing, after 3 attempts the row appears in the admin failed-invoices tile.

### Phase 8
- Book as PJ with real CUI (VAT payer) → `smartbill.eFactura.uploadId` set; polling completes within an hour with `status: 'OK'`.
- Book as PF → `smartbill.eFactura === null` (correctly skipped).

### Cross-cutting (before declaring done)
- Issue 10 sandbox invoices across all 4 paid-flow paths — verify SmartBill admin shows correct numbering, no gaps.
- Cancel + storno test for each — confirm correct fiscal trail.
- `npm run build` clean.
- 375px viewport check on the BookingHistory invoice link tap target.
- Run audit: every new i18n key exists in both RO and EN.
- Deploy to staging Firebase project; run end-to-end with SmartBill sandbox account before prod.

---

## Estimated effort

| Phase | Days |
|---|---|
| 1 — Foundations | 0.5 |
| 2 — Online auto-issue | 0.5 |
| 3 — Cash/admin auto-issue | 0.5 |
| 4 — Cancel / storno | 0.5 |
| 5 — Customer + admin PDF | 0.5 |
| 6 — Email attachment | 0.25 |
| 7 — Retry + reconciliation | 0.5 |
| 8 — e-Factura | 0.5 |
| **Total** | **~3.75 days** |

Phases 1 → 2 → 3 are linear (each builds on the SmartBill wrapper). Phases 4–8 can interleave or run in parallel once the wrapper exists.

---

## Reconciliation against the live API (checked 2026-07-16)

Spot-checked the plan against the official docs (<https://ws.smartbill.ro/SBORO/api>,
SmartBill help, and community SDKs). Confirmed: base URL `ws.smartbill.ro/SBORO/api`,
HTTP Basic auth (email + token), and the `POST /invoice` → `{ series, number, url }`
issue flow with the HTTP-200-plus-`errorText` failure convention. **Still to verify
against the sandbox in Phase 1 before writing the storno branch** — SmartBill exposes
invoice invalidation as four distinct operations that don't map one-to-one onto this
plan's "same-day cancel vs prior-day credit note":

- **cancel** — marks an *already-issued* invoice as cancelled (anulare) without deleting
  it; works for any past invoice, keeps the number in the fiscal trail.
- **delete** — removes only the *last* issued invoice from the database.
- **reverse** (stornare) — issues a reversing invoice against any active past invoice.
  This, not a `/invoice/creditnote` path, is SmartBill's storno primitive; §Phase 4's
  endpoint name is provisional.
- **restore** — un-cancels.

Phase 1 (the "hand-write a payload via Node REPL" checkpoint) should pin the exact
paths, HTTP methods, and query-vs-body parameter passing for cancel/delete/reverse
before Phase 4 is coded — the fiscal correctness of cancellations depends on picking
the right one.

## Caveats and follow-ups

- **SmartBill public PDF URLs don't expire.** Anyone with the link can fetch the invoice. SmartBill design choice. Acceptable for our use case (link is only shared with the buyer + admins) but worth flagging if a customer asks.
- **VAT rate is hardcoded to 21%.** If RO changes the rate again, update one constant in `smartbill.js`. The 19% legacy invoices stay at 19% — we never rewrite history.
- **Storno on prior-day cancellations is mandatory under RO fiscal rules** — can't just delete. Phase 4's branching is non-negotiable.
- **e-Factura rejections (`NOK`)** usually mean bad CUI / regCom data. The admin banner needs to show the `statusText` so staff know what to fix.
- **No invoice on free actions** (token use at the lot, walk-in check-in without payment, refunds where we already storno'd). Sanity-check this in phase 3 — only money-in events trigger an issue.
- **Out of scope for v1.2:** invoice PDF localization in EN (SmartBill issues RO only), recurring/subscription invoices (no subscriptions in this product), proforma issuance (no quote/estimate flow).
