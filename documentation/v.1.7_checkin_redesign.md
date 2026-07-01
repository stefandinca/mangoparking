# Mango Parking v1.7 — Admin Check-in / Check-out redesign

> **Status: ✅ SHIPPED.** Implemented on the current `main` — this doc is the
> implementation record. The 3-tab `AdminCheckIns` (Check-in / Check-out /
> Overdue), the `markNoShows` scheduled detector, the shared
> `CreateTransactionModal`, and the `autoCheckIn` walk-in path are all live.
> (Post-ship reality notes were folded into [v.1.8](v.1.8_credit_checkin.md).)

## Goal

Replace the current `/admin/checkins` page with a workflow-driven 3-tab layout (Check-in · Check-out · Overdue), each tab purpose-built for the action it serves. Lift the walk-in "create transaction" modal in from `/admin/transactions` so all on-the-lot operations live on one screen. Add a scheduled NO-SHOW detector for bookings whose owners never arrived.

## Locked decisions

1. **NO-SHOW clock** — `status == 'upcoming'` AND `now > dropoffAt + 12h` AND no `activeCheckIns` row for the plate. Triggered server-side by a scheduled function.
2. **"Cancel reservation" is the one cancellation action** — it both cancels the booking AND handles the payment side in a single click. Behavior branches on payment status:
   - **Unpaid** (pay-at-pickup) → status flips to `'cancelled'`, no money movement, spot freed
   - **Paid** (Netopia / admin-cash / admin-card) → status flips to `'cancelled'`, `paymentStatus` flips to `'refund-pending'` (drops into the existing Refunds queue), spot freed
   - This is exactly what the existing `cancelBookingWithRefund` callable already does — no new server work needed for cancellation. Admin/agent only (drivers can't trigger refunds).
3. **Walk-in flow** — reuse the existing create-transaction modal in `/admin/transactions` verbatim. Supports long-term booking OR credit pack, for an existing user OR a new user (with invite email). Lifted into a shared component so both pages can mount it; the create button stays on AdminCheckIns going forward and is removed from AdminTransactions.

4. **Action-tab discipline** — actions are scoped to the tab they belong to:
   - **Check-in tab**: only the check-in action. No check-out buttons.
   - **Check-out tab**: only the check-out action. No check-in buttons.
   - **Overdue tab**: only check-out-shaped actions for cars in the lot past their time (Check-out now, Charge overstay).
   - Reservation management (Cancel reservation) and payment collection (Collect payment) are not strictly check-in or check-out actions and can appear where contextually useful — but never a "wrong direction" button on the wrong tab.

5. **NO-SHOW is fully automated** — the scheduled detector is the only path. No manual "Mark NO-SHOW" button anywhere in the UI. Customers who don't arrive get flagged 12h after their drop-off without staff intervention.

---

## Scope

**In:**
- Rewrite of `src/pages/admin/AdminCheckIns.js` (significant — current page is replaced)
- New scheduled function `markNoShows`
- New status value: `'no-show'`
- Extract the create-transaction modal into `src/components/admin/CreateTransactionModal.js`
- Remove the create button from `AdminTransactions.js`
- Auto-check-in option on the walk-in flow (new `autoCheckIn` param on the two existing callables)
- New i18n keys

**Out:**
- Partner/broker payment workflow — the `paidBy` field accepts `'broker'`/`'partner'` as values and renders a passive badge on rows, but the commission/settlement workflow is deferred until the client provides details.
- Customer-facing no-show emails — could be added as `E11` later via the Brevo trigger collection.
- Customer self-service indication of no-show on `/account/bookings` (existing booking history already shows status; cosmetic only).

---

## Phase A — Data model + rules (~0.25 day)

### A1. Booking status enum

`bookings.status` adds one new value:

- `'no-show'` — set by the scheduled detector or by the manual "Mark NO-SHOW" action

Existing values (`upcoming`, `active`, `completed`, `cancelled`) keep working unchanged. Cancellation always lands at `'cancelled'` regardless of paid-vs-unpaid (the payment side lives on `paymentStatus`).

### A2. New booking fields

```js
noShowAt:         ISO | null,
noShowDetectedBy: 'scheduled' | null,
```

`noShowDetectedBy` is kept as an enum (not a boolean) so future automated paths can stamp themselves distinctly — e.g., an ANPR-based "camera saw the lot empty at drop-off time" detection from the v1.3 plan would write `'camera'`. All written server-side only; no client-write surface.

### A3. `paidBy` field accepts new values

`'broker'` and `'partner'` join the existing `'netopia' | 'admin-cash' | 'admin-card'` set. No new workflow yet — display-only.

### A4. Firestore rules

No changes. `bookings` writes already require `isStaff()` and the new mutations all happen via Cloud Functions (admin SDK bypasses rules anyway).

---

## Phase B — Server (~0.5 day)

### B1. `functions/src/scheduled.js` — `markNoShows`

Hourly, `Europe/Bucharest`:

```js
const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
const stale = await db.collection('bookings')
  .where('status', '==', 'upcoming')
  .where('dropoffAt', '<', cutoff)
  .get();
```

For each result:
1. Re-verify no `activeCheckIns` record for the plate (defensive — fast guard against race with manual check-in)
2. Update doc: `status: 'no-show'`, `noShowAt: now`, `noShowDetectedBy: 'scheduled'`
3. Release the reserved spot (mirror the existing cancel logic — flip `spots/{id}.status` back to `available`, null out `currentBookingId`)
4. Append to `auditLog`

### B2. `cancelBookingWithRefund` — server-side change

The existing callable already does exactly what we need (cancel + refund-pending branch). Two small adjustments:

- **Allow cancelling an `'active'` booking** — currently it refuses if `status !== 'upcoming'`. The new Check-out tab and Overdue tab need to cancel active bookings (e.g. emergency abort). Relaxes the precondition to `status in ['upcoming', 'active']`.
- **Reject drivers** — add `if (role === 'driver') throw new HttpsError('permission-denied', ...)`. The client also hides the button for drivers (defense in depth).

No new callable needed for the cancel-and-refund path — one function, one button, branches internally.

### B3. `functions/src/index.js` — extend walk-in callables

`adminCreateLongtermBooking` and `grantCreditsForCash` both accept a new optional `autoCheckIn: boolean`:

- For `adminCreateLongtermBooking`: after the booking is created, immediately call the same `checkInBooking` path that `/admin/checkins` uses — assigns a spot, flips status to `'active'`, creates `activeCheckIns` row.
- For `grantCreditsForCash`: after `creditTokens` runs, also call `useToken(balanceDocId, plate)` to consume one token and create the `activeCheckIns` row (mirroring the customer-arrival flow).

Both are no-ops when `autoCheckIn: false` (or omitted) — backwards compatible with anything still calling them without the flag.

---

## Phase C — Client rewrite (~1.5 days)

### C1. Page chrome

Top of `/admin/checkins`:

```
┌────────────────────────────────────────────────────────────────────┐
│  Check-in / Check-out                          [+ Walk-in nou]    │
│                                                                    │
│  Caută după plăcuță... [_______________] [Check-in rapid]          │
│                                                                    │
│  [Check-in (12)] [Check-out (7)] [Overdue (2)]                    │
└────────────────────────────────────────────────────────────────────┘
```

- "Walk-in nou" CTA top-right → opens the extracted create-transaction modal
- Existing quick check-in plate bar stays (already a good UX)
- Tab buttons show counts so agents see at a glance where the load is
- Tab + date filter persist in URL (`?tab=checkin&window=today`) for refresh-safety

### C2. Tab 1 — Check-in

**Date selector** (3-pill segmented control above the table):

```
[Astăzi] [Săptămâna aceasta] [Luna aceasta]
```

**Filter**: `status == 'upcoming'` AND `dropoffAt` inside the selected window. Sort: `dropoffAt` ascending (earliest first).

**Columns** (desktop) / **card layout** (mobile <md):

| Drop-off / Pick-up | Client | Plate | Plată | Check-in | Acțiuni |
|---|---|---|---|---|---|

Cell details:
- **Drop-off / Pick-up**: two-line cell — `dropoffAt` on top, `→ pickupAt` below, both formatted as `dd.MM HH:mm`
- **Client**: name + email-on-hover (tooltip)
- **Plate**: mono font, uppercase
- **Plată**: badge — `Plătit` (leaf), `Neplătit` (red), `Refund pending` (mango), `Refundat` (gray). For partners, an extra `Broker` / `Partner` chip beside the status.
- **Check-in**: always `Așteaptă` for this tab
- **Acțiuni**: icon + label buttons (see below)

**Per-row actions** (compact icon+label):

| Action | Visibility | Conditional |
|---|---|---|
| **Check-in manual** | all staff | — |
| **Cancel reservation** | admin/agent only | hidden if already `cancelled` or `refund-pending`. Calls `cancelBookingWithRefund` — cancels the reservation AND triggers refund-pending for paid bookings in one click. |
| **Collect payment** | all staff | only if `paymentStatus == 'unpaid'` |

NO-SHOW status is stamped automatically by the scheduled detector 12h after drop-off — no manual button. Rows in `'no-show'` status drop off this tab on the next refresh (filter is `status == 'upcoming'`).

Mobile: actions collapse into a 3-dot menu to save horizontal space.

### C3. Tab 2 — Check-out

Same date selector. Filter: `status == 'active'` AND `pickupAt` inside window. Sort: `pickupAt` ascending.

Same columns; **Check-out** column shows `Activ` (leaf badge). Actions:

| Action | Visibility | Conditional |
|---|---|---|
| **Check-out manual** | all staff | — |
| **Cancel reservation** | admin/agent only | rare for active rows but supported (e.g. emergency abort). Server now accepts `status == 'active'` per Phase B2. |
| **Collect payment** | all staff | only if `paymentStatus == 'unpaid'` |

### C4. Tab 3 — Overdue

No date selector — always lists EVERY overdue regardless of when. Filter: `status == 'active'` AND `pickupAt < now - 2h`. Sort: hours-over descending (worst first).

**Row layout** — each row is a clickable accordion header:

```
┌─────────────────────────────────────────────────────────────┐
│ ▶  LT-AB7K2    B 123 ABC    Popescu Maria    +6h overdue   │
└─────────────────────────────────────────────────────────────┘
```

**Expanded panel** (click toggles):

```
┌─────────────────────────────────────────────────────────────┐
│ ▼  LT-AB7K2    B 123 ABC    Popescu Maria    +6h overdue   │
│ ─────────────────────────────────────────────────────────── │
│  Drop-off:     2026-05-25 14:30                            │
│  Pick-up:      2026-05-28 09:00     (now: 15:00, +6h)      │
│  Days booked:  3                                            │
│  Total:        135 lei  ·  Plătit (Netopia)                │
│  Email:        maria@example.ro  ·  +40 712 345 678        │
│  Spot:         A14                                          │
│  Voucher:      —                                            │
│                                                             │
│  [Check-out acum]  [Taxează depășire]  [Anulează rezervarea] │
└─────────────────────────────────────────────────────────────┘
```

Overdue rows are ALL active bookings (the car is in the lot, late to leave). Actions here are check-out-shaped, not check-in-shaped:

- **Check-out acum** — closes the booking. All staff.
- **Taxează depășire** — opens the existing `chargeOverstay` dialog (from v1.3 plan — if not yet built, this is a small addition: callable that records a `cashEntries` row + a `tokenTransactions` row of type `'overstay'`). All staff.
- **Anulează rezervarea** — emergency abort for the rare case where the car needs to leave without normal check-out. Admin/agent only. Same `cancelBookingWithRefund` behavior as elsewhere.

NO-SHOW is intentionally NOT here — a NO-SHOW means the customer never arrived (booking still `upcoming`). An overdue car IS in the lot, so the mutually exclusive state can't apply.

### C5. Walk-in flow

**Modal**: lifted from AdminTransactions verbatim into `src/components/admin/CreateTransactionModal.js`. Both `/admin/checkins` and (any future caller) can import + open it.

**New checkbox in the modal**:

```
[ ] Walk-in — fă check-in imediat
```

When checked:
- The callable receives `autoCheckIn: true`
- Server creates the booking AND immediately checks in the customer
- Confirmation toast: "Walk-in înregistrat și check-in efectuat"
- Page refreshes the Check-out tab (since the new customer is now `active`)

When unchecked (default):
- Same behavior as today — booking created with status `'upcoming'`, customer arrives later
- Page refreshes the Check-in tab

### C6. Permission gating (client-side)

Uses the existing `hasPermission(role, PERM.REFUNDS)` check:

- `Cancel reservation` button: hidden for `driver` (paid cancellations route to the Refunds queue — financially sensitive)
- All other actions (Check-in / Check-out / Collect payment / walk-in modal): visible to all staff roles
- The `PERM.CHECKINS` permission already grants page access (admin / agent / driver per v1.6's permission table)

### C7. Mobile layout

Below `md` (768px):
- Tabs render as a horizontally-scrollable strip
- Date selector stays full-width pill
- Each row collapses into a vertical card with the same fields
- Action buttons reduce to **icons only** with text labels below; the more rarely used ones (Cancel payment / Cancel reservation) move into a 3-dot menu

---

## Phase D — AdminTransactions cleanup (~0.1 day)

- Remove the `+ Create transaction` button from `AdminTransactions.js`
- Remove the modal HTML + handler code (now lives in `CreateTransactionModal.js`)
- Update the page subtitle to reflect its pure-ledger role: "Istoricul tuturor încasărilor și rezervărilor"
- No data shape changes

---

## Phase E — Verification (~0.25 day)

### A — Data model
- Hand-flip a `bookings.status` to `'no-show'` via the console → page filters react correctly
- Create a booking with `paidBy: 'broker'` → row renders with the badge

### B — Server
- Backdate a booking's `dropoffAt` to 13h ago, `status: 'upcoming'`, no `activeCheckIns` row → manually trigger `markNoShows` → status flips to `'no-show'`, audit row written, spot freed
- Create another with the SAME setup but ALSO an `activeCheckIns` row → manual trigger → no change (defensive check works)
- Call `cancelBookingWithRefund` on an unpaid booking → status flips to `'cancelled'`, spot freed, no refund row in queue
- Call `cancelBookingWithRefund` on a paid booking → status flips to `'cancelled'`, `paymentStatus: 'refund-pending'`, booking appears in Refunds queue
- Call `cancelBookingWithRefund` on an `active` booking (new) → still succeeds, spot freed
- Call `cancelBookingWithRefund` as a driver → 403 `permission-denied`

### C — Client
- All three tabs load with default `today` window selected
- Date pill switching: row count updates live, sort preserved
- Walk-in modal: create longterm + `autoCheckIn` checked → row appears in Check-out tab within seconds; uncheck → row appears in Check-in tab
- Overdue tab: accordion expand/collapse smooth; charge-overstay + check-out-now actions wire correctly
- Verify no "Mark NO-SHOW" button appears anywhere in the UI — the scheduled detector is the only path
- Permission gating: log in as driver → Cancel reservation button not visible anywhere
- Mobile (375px): tabs scroll, actions usable, accordion works
- URL persistence: `?tab=overdue` refreshes back to the Overdue tab

### Cross-cutting (before done)
- `npm run build` clean
- 30 prerendered routes unaffected (admin page is auth-gated, never prerendered)
- `firebase functions:log` clean during the no-show batch run
- i18n parity: every new key exists in both `ro.js` and `en.js`
- Drive a real reservation end-to-end: create → check-in → check-out → done

---

## File-level touches

**New (~2):**
- `src/components/admin/CreateTransactionModal.js` — extracted modal
- `functions/src/scheduled.js` → new export `markNoShows` (file already exists)

**Modified (~5):**
- `src/pages/admin/AdminCheckIns.js` — full rewrite, ~600 lines net
- `src/pages/admin/AdminTransactions.js` — remove button + modal code, import shared component for backwards safety
- `functions/src/index.js` — relax `cancelBookingWithRefund` to allow `active` status + reject drivers; optional `autoCheckIn` on `adminCreateLongtermBooking` + `grantCreditsForCash`
- `src/services/bookingService.js` — small helper `dateWindowFilter(rows, field, window)` reused across tabs
- `src/i18n/ro.js` + `en.js` — `checkins.tab*`, `checkins.action*`, `checkins.overdue*`, `checkins.noShow*`, `checkins.walkIn*`

**No changes:**
- `src/utils/permissions.js` — `PERM.REFUNDS` reused for Cancel-reservation gating; no new perm needed
- `firestore.rules` — no changes
- `firestore.indexes.json` — current indexes cover the new queries (`bookings(status, dropoffAt)` is a single-field combination that doesn't need a composite)

---

## Effort

| Phase | Days |
|---|---|
| A — Data model | 0.25 |
| B — Server (reduced — no new `cancelPayment` callable) | 0.3 |
| C — Client rewrite | 1.5 |
| D — Transactions cleanup | 0.1 |
| E — Verification | 0.25 |
| **Total** | **~2.4 days** |

Phases A and B can run in parallel with C since they're independent layers. The biggest risk is Phase C — the rewrite is substantial. Best done in a focused block with no parallel feature work.

---

## Caveats and future work

- **Partner/broker payment workflow** — placeholder `paidBy` values are accepted today but no commission, settlement, or fiscal handling is wired up. When the client provides details, the right places to add it: inside `cancelBookingWithRefund` (partner refunds may have a different settlement process, distinct from Netopia/cash refunds) and inside the "Collect payment" dialog (which should know whether to route funds through the partner's system or just record cash at the desk).
- **No-show emails** — customer doesn't get notified. Adding an `E11` template via the existing Brevo trigger collection would close this; ~0.25 day. Could be triggered straight from `markNoShows` via a `mail/{id}` write.
- **Overdue accumulation** — if the agent forgets to action overdue rows, the list grows. Consider a "Mark resolved" action that hides them without changing status (purely cosmetic). For v1.7 we trust ops to keep it clean.
- **Overstay charge** referenced in Overdue actions — depends on the v1.3 ANPR plan's `chargeOverstay` callable. If that's not built yet, add a small standalone callable in this phase instead of waiting on the ANPR work.
- **Quick check-in bar** — the existing top-of-page plate lookup stays; consider promoting it visually since it's the single fastest path for walk-ins who DO have a prior booking but the agent doesn't know which one.
- **Out of scope for v1.7**: bulk actions (check-in multiple at once), CSV export of overdue, SMS escalation for severely overdue customers.
