# 03 — Cancellations, Refunds & Cashbook

**Pages:** `/admin/refunds` (`AdminRefunds.js`), `/admin/cashbook`
(`AdminCashbook.js`), plus the admin cancel path on `/admin/checkins`.
**Permissions:** `perm:refunds`, `perm:cashbook` (admin, agent).
**Server:** `cancelBookingWithRefund`, `adminMarkRefunded`, `recordCashEntry`,
`closeCashbook` in `functions/src/index.js`.

## In plain words

- This covers **cancelling bookings and giving money back**, plus the **daily
  cash drawer**.
- Staff can **cancel** a reservation. If the customer already paid, it goes into a
  **"to be refunded" list**.
- An admin opens that list, **actually sends the refund** (through Netopia, cash,
  or card terminal — done outside the app), then clicks **"Mark refunded"**, which
  emails the customer.
- The **cashbook** tracks cash each staff member took in during the day. They can
  **hand money over** to a supervisor and **close out** the till, which prints a
  report for accounting.
- **The serious catches (see bugs):** the refund list can show the **wrong amount**
  for bookings that used a voucher (it shows the full price, not what was actually
  charged — risk of refunding too much). And **cash refunds aren't subtracted from
  the till**, so the cash report ends up overstating how much money is on hand.

---

## Flows

### Flow 1 — Cancel a booking (admin)
See doc 01, Flow 8. Net result: `cancelled` or `no-show`; a paid Netopia/admin
booking becomes `refund-pending` and enters the Refunds queue.

### Flow 2 — Process a refund end-to-end
**Entry:** booking `paymentStatus:'refund-pending'`.
1. Admin opens `/admin/refunds`. Two server queries: `paymentStatus=='refund-pending'`
   (queue) and `=='refunded'` (history, then client-filtered to 90 days). The queue
   is further filtered to `paidBy` ∈ {netopia, admin-cash, admin-card} — only
   captured payments can be refunded, so unpaid "cash on arrival" (pay-at-pickup)
   rows never appear (and any legacy refund-pending row without a real payment is
   hidden). Header shows "Total de rambursat" summed from `totalPrice`.
2. Each pending row: Code · Plate · Customer · Cancelled-at · Paid-via · Amount
   (`totalPrice`) · actions. Netopia rows get an "Open in Netopia" link; all rows
   get a green "Marchează rambursat". The **Code is clickable** — it opens the
   reservation's full record on Istoric (`/admin/transactions?booking=<id>`,
   via `reservationCodeHtml` / `wireReservationLinks` — the one destination for
   every reservation code across the admin). Applies to the pending, partial,
   and history tables.
3. Admin issues the refund **out of band** (Netopia panel / cash at lot / POS
   void), then clicks **Marchează rambursat**.
4. Dialog opens pre-selecting a channel via `suggestedVia(paidBy)`: radio
   (netopia-panel / cash / card-terminal), optional notes, hint "trimite e-mail
   clientului și nu poate fi anulată".
5. Submit → `adminMarkRefunded`: guards `refund-pending` (idempotent), stamps
   `refunded` + `refundedAt/By/Via` + notes, mirrors to `pendingOrders`, audit
   `booking_refunded`, best-effort `sendRefundIssuedEmail`.
6. Toast; page reloads after 600 ms.
**End state:** booking `refunded`; appears in history with an email-status badge.

### Flow 3 — Resend / inspect refund email
History rows show an email badge (sent/failed/unknown). "Retrimite email" →
`adminResendRefundEmail` (guards `refunded`), disables button, reloads after
800 ms. Failed-email rows get a highlighted button + a red "X failed emails" pill.

### Flow 4 — Cashbook recording & reconciliation
1. Cash entries are written **server-side** by `recordCashEntry` whenever cash is
   collected (mark-order-paid cash, walk-in-longterm cash, sell-credits cash).
   **Card never enters the cashbook.**
2. `/admin/cashbook`: admins see all agents' open entries; agents see their own.
   Per-agent → day cards grouped by `paidAt.slice(0,10)`, each with day sum,
   outstanding-to-hand-over, entries table, handovers list.
3. **Predă banii** → handover dialog (amount pre-filled = outstanding, handed-to,
   notes) → `recordCashHandover`. Handovers can be cancelled (danger confirm →
   `cancelCashHandover`, hard delete).
4. **Închide casieria** → confirm → `closeCashbook(agentUid?)`: snapshots open
   entries into `cashbookReports/{id}`, batch-marks entries closed, opens a
   printable report, reloads.
**End state:** closed report retained for accounting; entries leave the open list.

### Flow 5 — Pay-at-pickup orders that never arrived
- Unpaid **credit pack**: customer self-cancel → `cancelPendingCreditOrder` flips
  the `pendingOrders` doc (no booking exists for credit packs).
- Pay-at-pickup **long-term**: a paid order creates a booking immediately
  (`unpaid`, no spot). No-show handled only by hourly `markNoShows` / the 12h
  branch in `cancelBookingWithRefund`.
- Stale unpaid `pendingOrders` > 14 days → `expireStaleHolds` → `expired` (does
  not touch the booking).

---

## Bugs & inconsistencies

1. **[HIGH] Over-refund on voucher-discounted bookings.** The queue, the confirm
   dialog (`:279`), the dashboard banner (`AdminDashboard.js:214`) and the audit
   log (`index.js:1802`) all use `booking.totalPrice` — the **gross**, pre-voucher
   online total (`createBookingFromOrder` sets `totalPrice: order.totalPrice`,
   `index.js:209`). The amount actually charged is the post-voucher
   `pendingOrders.amount` (`index.js:405`). When such a booking is cancelled it
   becomes `refund-pending` and the admin is told to refund the full gross —
   over-refunding by the discount. **Refund displays should read
   `pendingOrders.amount`, not `totalPrice`.**
2. **[HIGH] Cash refunds are never reconciled in the cashbook.** Marking an
   admin-cash booking refunded via `cash-returned` writes **no** reversing
   `cashEntries` row (verified: zero refund-related cashbook writes in
   `index.js`). The original positive entry stays in the agent's open day, so the
   cashbook and the printed report overstate cash on hand after every cash refund —
   the agent "owes" money the lot already returned.
3. **[HIGH→docs] Fully-voucher booking: spec ≠ code, and the page can't label it.**
   The v1.9 doc says a fully-voucher cancellation reaches the queue with
   `paidBy:'voucher'`. But `cancelBookingWithRefund` (`index.js:1661`) only sets
   `refund-pending` for `paidBy` ∈ {netopia, admin-cash, admin-card};
   `paidBy:'voucher'` falls through to `cancelled` and never reaches the queue
   (money-safe, but contradicts the doc). Worse, the refund page has **no**
   handling for it: `paidByLabel('voucher')` returns raw `"voucher"` (`:50`) and
   `suggestedVia('voucher')` defaults to `netopia-panel` (`:62`) — so if any
   voucher booking *did* reach the queue, the admin is told to refund N lei via
   Netopia with no hint there's no money to move. Pick one behavior and make doc,
   server, and page agree.
4. ~~**[HIGH] `{{ … }}` i18n keys render literally** in the refunds block~~ —
   **FIXED 2026-07-23**: `historySubtitle`, `failedCount`, `resendOk` rewritten
   to single-brace in both locales. See cross-cutting #1 / BUGS #1.
5. **[MED] No "No-show" surface, and detection can miss bookings.**
   `AdminCheckIns` has only checkin/checkout/overdue tabs — no No-show tab, so
   flagged no-shows vanish from the UI. `markNoShows` queries
   `.where('dropoffAt','<',cutoff)` (`scheduled.js:277`); bookings with
   `dropoffAt:null` (e.g. `createLongTermBooking` writes only `startDate/endDate`;
   `createBookingFromOrder` sets `dropoffAt: order.dropoffAt || null`) never match
   and stay `upcoming` forever.
6. **[MED] Cashbook day-bucketing uses UTC, not Europe/Bucharest.** `groupByDay`
   buckets on `paidAt.slice(0,10)` (UTC) and `recordCashEntry` stores
   `paidAtDay: nowIso.slice(0,10)` (UTC). A payment taken after local midnight
   (still previous UTC day until ~02:00–03:00) lands in the wrong day card and on
   the wrong line of the printed report. `formatDay` then renders it via
   `toLocaleDateString` with no `timeZone`, compounding the drift.
7. **[MED] Date columns ignore Europe/Bucharest** across all three money pages
   (`AdminRefunds` `:34`/`:44`, `AdminCashbook` `:37`/`:46`/`:55`) — viewer's
   browser TZ instead of lot-local.
8. **[MED] Swallowed-error → false "all clear".** `AdminRefunds.js:122` and
   `AdminCashbook.js:261` `.catch(() => [])`; a failed load renders "Nicio
   rambursare în așteptare ✓" / an empty cashbook — looks like a clean state.
9. **[LOW] Refund history queries are unbounded.** `where('paymentStatus','==',
   'refunded')` (`:124`) pulls every refunded booking ever, then client-filters to
   90 days. Grows without limit.
10. **[LOW] Row buttons have no re-entrancy guard.** The "Marchează rambursat"
    (`:240`) and cashbook handover (`:374`) row buttons aren't disabled on click,
    so rapid clicks stack modals. Server calls are idempotent and the dialog's own
    submit disables — impact is UI clutter only.
11. **[LOW] Dashboard refund banner has conflicting `block` + `flex` classes**
    (`AdminDashboard.js:245`) — harmless (last wins) but sloppy.

**Correct:** `escapeHtml` consistently applied on plate/name/email/notes/payer
fields here; refund + cash-close confirms exist and are danger-styled; the
mark-refunded dialog warns it's irreversible; `adminMarkRefunded`,
`adminMarkOrderPaid`, `closeCashbook`, `cancelBookingWithRefund` are idempotent;
`'refund-pending'` (hyphen) is used consistently — no `refundPending` drift.
