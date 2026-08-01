# Cashbook & Refunds

> Status: ✅ Shipped · Last verified: 2026-08-01

Two related back-office money surfaces: the **cashbook** (`/admin/cashbook`) — a
per-agent physical-cash drawer with shift close-out, printed report and
manager handovers — and the **refunds queue** (`/admin/refunds`) — a manual
work-list for cancelled/refund-pending bookings, since Netopia has no
programmatic refund. See also [`capacity.md`](./capacity.md) for the spot
release that happens on cancellation, and `../backend/cloud-functions.md` for
the full callable inventory.

## What it is

- **Cashbook** — every *cash* payment collected at the lot writes one ledger
  row (`cashEntries`). Card and online payments never enter the cashbook (ops
  decision: agents only reconcile physical cash). An agent views their own open
  rows grouped by day, records handovers to a manager, and **closes** their day
  — which snapshots the open rows into an immutable `cashbookReports` doc and
  produces a printable summary. Admins see every agent's drawer.
- **Refunds queue** — Netopia (and admin cash/card) refunds are **manual**.
  When a paid booking is cancelled it goes to `paymentStatus: 'refund-pending'`;
  the queue lists those rows, the admin issues the money out-of-band (Netopia
  panel / cash at the lot / POS void), then clicks **Mark refunded**, which
  flips the booking to `refunded`, emails the customer, and — for cash — writes
  the reversing cashbook entry.

## The refund amount (read this before touching a refund surface)

**Never refund `booking.totalPrice`.** It is the GROSS list price. What the
customer actually paid is `pendingOrders.amount` — already net of the online
discount and any voucher — plus anything collected afterwards through the
`extensionPrice` / `latePrice` accumulators (`adminRepriceBooking` deliberately
does *not* fold an extension back into `totalPrice`).

Until 2026-08-01 the queue, its confirm dialog, the dashboard tile and the
audit row each read `totalPrice`, so every discounted or voucher booking was
refunded for **more than was ever taken** — while the cancellation email,
which derived the charged amount correctly, quoted the customer a different
(right) number.

The rule now lives in exactly two places, and they agree:

| Side | Where | Notes |
|---|---|---|
| Server | `resolveChargedAmount(db, booking)` (`index.js`) | Authority. `cancelBookingWithRefund` pins the result on the booking as **`refundAmount`**; `adminMarkRefunded` pins what was returned as **`refundedAmount`**. |
| Client | `refundDueFrom(booking, order)` (`src/utils/refundAmount.js`) | Pure + unit-tested (`tests/refundAmount.test.mjs`). `attachRefundDue(bookings)` in `bookingService.js` wraps it with the order fetch and stamps `refundDue`. |

Both apply the same precedence: **pinned server figure → charged order amount →
the booking's own total** (desk sales never create an order). The derivation
only runs for bookings cancelled before the pinned fields shipped; the order
fetch is skipped entirely for rows that already carry one.

## How it works

### Cashbook

- **Write path (server).** `recordCashEntry(...)` in `functions/src/index.js`
  is the single helper that appends a `cashEntries` row. It's called from the
  cash branches of the booking/credit callables (mark-paid, direct long-term,
  direct credit grant, extension, overstay) **and from both refund paths**. It
  stamps `paidBy: 'cash'`, `paidAt`, `paidAtDay` (YYYY-MM-DD), the resolved
  `agentName`, and a `source` tag (`longterm-direct`, `longterm-markpaid`,
  `credits-direct`, `credits-markpaid`, `longterm-extension`, `overstay`,
  `refund`). Card payments skip it entirely.
- **Cash refunds reverse out of the drawer** (2026-08-01). Returning cash to a
  customer physically empties the till, so `adminMarkRefunded` and
  `adminResolvePendingRefund` write a **negative** `cashEntries` row
  (`source: 'refund'`, `amount: -refundAmount`) whenever
  `refundedVia === 'cash-returned'`. Before this the drawer and the printed
  report kept counting money that was no longer there, and the agent appeared
  to owe it.
  - Keyed on the refund **channel**, not on how the booking was paid: a
    card-paid booking refunded in cash still empties the till; a cash-paid
    booking refunded to a card does not.
  - A **reversing row, not a deletion** — deleting the original would erase the
    fact that cash was ever collected, and is impossible once the entry has
    been closed into a report. Every consumer sums with `+`, so negatives net
    out in day totals, close-outs and reports; the UI renders them red.
  - Negative amounts are **opt-in** (`allowNegative: true`). Other callers pass
    a collected amount and not all validate it upstream, so for them a negative
    is still dropped silently.
  - Best-effort: the money is already back in the customer's hand, so a failed
    ledger write never fails the refund. It is recorded on the audit row as
    `cashReversalFailed` with a null `cashEntryId`.
- **Read path (client).** `src/services/cashbookService.js` reads the ledger.
  `listOpenEntriesForAgent(uid)` (agent's own, `closedAt == null`),
  `listAllOpenEntries()` (admin), `listReports(...)`, `listHandovers(...)`, plus
  pure helpers `groupByDay`, `groupByAgent`, `sumAmount`, `ownerOfHandover`.
- **Page.** `src/pages/admin/AdminCashbook.js` renders one section per agent
  (admin sees all, sorted with the caller first). Each section groups rows into
  day-cards showing per-day total, **outstanding cash** (day sum minus what was
  already handed over), and a handover row. The Firestore rules already enforce
  per-agent visibility; the page just matches the UI to the data.
- **Handovers.** A manager pickup is logged via the `recordCashHandover`
  callable. Simple logbook — no approval workflow, no double-entry, one handover
  per `(agent, day)`; correcting means `cancelCashHandover` then re-record.
  Admins may record on behalf of another agent (`forAgentUid`); the actual actor
  is kept in `handedBy`. `ownerOfHandover()` prefers `forAgentUid` and falls
  back to `handedBy` for legacy rows.
- **Close-out.** The **close** button calls the `closeCashbook` callable, which
  snapshots the open entries into `cashbookReports/{auto}`, batch-marks each
  entry `closedAt/closedBy/closedReportId`, pulls in the day's handovers, and
  audit-logs `cashbook_closed`. The fresh report opens immediately in a modal.
- **Printing.** `buildPrintDoc()` / `printReport()` in `AdminCashbook.js` build a
  fully inline-styled HTML document and print it inside a hidden iframe, so none
  of the SPA chrome (sidebar, modal overflow) bleeds into the printout — this
  fixed the clipped output that plain `window.print()` produced.

### Refunds

- `src/pages/admin/AdminRefunds.js` fetches three buckets in parallel:
  1. **Pending** — `bookings where paymentStatus == 'refund-pending'`, then
     client-filtered to `paidBy ∈ {netopia, admin-cash, admin-card}` (the
     `PAID_CHANNELS` set) so unpaid pay-at-pickup cancels never appear.
  2. **Partial** — `bookings where pendingRefundAmount > 0`. These come from
     *shortening* an active/completed booking's checkout date (a re-price), so
     they don't carry `refund-pending`; the amount owed is on the booking.
  3. **History** — `bookings where paymentStatus == 'refunded'`, last 90 days.
- `paymentStatus: 'refund-pending'` is set upstream by the
  `cancelBookingWithRefund` callable (`functions/src/index.js:1687`) when a paid
  booking is cancelled; that callable also releases the reserved spot.
- **Mark refunded** opens a dialog to pick the channel (`refundedVia`:
  `netopia-panel` / `cash-returned` / `card-terminal`, defaulted by `paidBy`),
  then calls `adminMarkRefunded`. The server sets `refunded` + `refundedAt/By/Via`
  + `refundNotes`, mirrors the state onto the `pendingOrders` doc, audit-logs
  `booking_refunded`, and (best-effort) sends the refund-issued Brevo email. The
  email status is stored on `booking.refundEmail`; **Resend email**
  (`adminResendRefundEmail`) re-fires it, highlighted when the prior send failed.
- **Partial resolve** calls `adminResolvePendingRefund`, which clears the
  `pendingRefund*` fields, stamps `checkoutRefunded*`, and audits
  `booking_checkout_refund_resolved`. Money movement is still manual.
- For Netopia rows the page also links out to the Netopia admin panel
  (`https://admin.netopia-payments.com/`) where the actual refund is issued.

## Key files

- `src/services/cashbookService.js` — cashbook reads + handover/close wrappers.
- `src/pages/admin/AdminCashbook.js` — cashbook UI, print report builder.
- `src/pages/admin/AdminRefunds.js` — refund queue, partial + history tables.
- `functions/src/index.js` — `recordCashEntry` (`:1039`), `closeCashbook`
  (`:1458`), `recordCashHandover` (`:1575`), `cancelCashHandover` (`:1640`),
  `cancelBookingWithRefund` (`:1687`), `adminMarkRefunded` (`:1865`),
  `adminResolvePendingRefund` (`:3204`), `adminResendRefundEmail` (`:2145`).
- `functions/src/emails.js` — `sendRefundIssuedEmail` (comment at `:314`).
- `firestore.rules` — `cashHandovers` (`:257`), `cashEntries` (`:265`),
  `cashbookReports` (`:272`).

## Data (Firestore)

- **`cashEntries/{auto}`** — one per cash movement. Fields: `agentUid`,
  `agentName`, `amount` (**negative on a `source: 'refund'` reversal**),
  `paidBy: 'cash'`, `paidAt` (ISO), `paidAtDay` (YYYY-MM-DD), `source`, `plate`,
  `payerName`, `bookingId`, `orderId`, `tokenBalanceDocId`, and close fields
  `closedAt` / `closedBy` / `closedReportId` (null while open).
- **`cashbookReports/{auto}`** — a closed shift. `agentUid`, `agentName`,
  `generatedAt`, `generatedBy`, `rangeFromIso`, `rangeToIso`, `totalAmount`,
  `entryCount`, embedded `entries[]` snapshot, embedded `handovers[]`. Immutable.
- **`cashHandovers/{auto}`** — `day` (YYYY-MM-DD), `amount`, `handedTo`,
  `notes`, `forAgentUid` (cash owner), `handedBy` (actor), `handedAt`.
- **`bookings`** (refund-relevant fields): `paymentStatus`
  (`paid`→`refund-pending`→`refunded`), `paidBy` (`netopia`/`admin-cash`/`admin-card`),
  `cancelledAt`, **`refundAmount`** (owed, pinned at cancel),
  **`refundedAmount`** (returned, pinned at mark-refunded), `refundedAt`,
  `refundedBy`, `refundedVia`, `refundNotes`,
  `refundEmail` `{ status, lastError }`; partial-refund fields
  `pendingRefundAmount`, `pendingRefundReason`, `pendingRefundCreatedAt` →
  cleared to `checkoutRefundedAt/By/Via/Amount` on resolve.

Access model (`firestore.rules`): all three cash collections are **server-write
only** (all client writes blocked). Reads: agents see rows where
`agentUid == request.auth.uid`; admins see all. Drivers are excluded from
`cashHandovers` reads (they don't handle money).

## Server (Cloud Functions)

All `onCall`, `europe-west1`. Gating: `closeCashbook`, `recordCashHandover`,
`cancelCashHandover` use `assertStaff` but explicitly reject drivers for cash;
only admins can act on another agent's cashbook/handover. `adminMarkRefunded`
uses `assertStaff`; `adminResolvePendingRefund` uses `assertAgent` (money op).
`closeCashbook` is the only writer of `cashbookReports`; `recordCashEntry` is a
private helper (not itself callable).

## Gotchas / edge cases

- **Cash only.** Card/terminal and online payments are intentionally invisible
  in the cashbook. `recordCashEntry` early-returns for non-positive/absent
  amounts, so a zero/voucher-covered order writes no row.
- **One handover per agent-day**, server-enforced (`already-exists`). To fix a
  miscount, cancel then re-record; the cancel hard-deletes but is audit-logged.
- **Unpaid cancels never reach the refund queue.** The `PAID_CHANNELS` filter
  also hides any legacy `refund-pending` rows with no captured payment.
- **Refund emails are best-effort** — a Brevo failure does not roll back the
  refund; the row stays in history with a `failed` badge and a Resend button.
- **Marking refunded is idempotent-ish**: an already-`refunded` booking returns
  `{ alreadyRefunded: true }`; a booking not in `refund-pending` is rejected.
- The `cashbookReports` doc embeds its `entries`/`handovers`, so a report stays
  printable even after the source rows age out of the read windows.

## Planned / not built

- **Automated Netopia refunds.** The v2 JSON-REST migration
  (`documentation/roadmap/v.1.4_netopia_v2_migration.md`) would issue refunds/
  voids at cancel time and retire this manual queue. Not built — payments remain
  on the legacy XML/RSA-AES envelope.
