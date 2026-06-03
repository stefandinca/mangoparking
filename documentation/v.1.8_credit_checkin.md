# Mango Parking v1.8 — Manual commuter check-in against existing credits

## Goal

Let a driver, agent, or admin check a commuter (navetist) in **using credits the
customer already holds** — no sale, no money movement. Until now the only
on-the-lot credit path in the walk-in modal *sold* new credits (cash/card) and
optionally consumed one on check-in (`grantCreditsForCash` + `autoCheckIn`).
There was no way to put a car on the lot by spending an existing balance, even
though customers buy credit packs online specifically to do exactly that.

This closes that gap inside the existing walk-in flow on `/admin/checkins`.

## Locked decisions

1. **Surface** — extend the shared `CreateTransactionModal` (the "Walk-in nou"
   CTA on `/admin/checkins`, also reachable from `/admin/transactions`). No new
   page or callable surface beyond one new Cloud Function.
2. **Credit sub-mode** — when the transaction type is *Credit pack*, a sub-toggle
   chooses between **Sell new credits** (existing behavior) and **Use existing
   credits** (new). The sub-toggle only renders when the modal is opened with
   `allowWalkIn` (the on-lot context).
3. **Credits per check-in is configurable, default 1** — `1 credit = one day`.
   The agent can deduct more than one in a single action; the field defaults to 1
   so the common case is a single click.
4. **Permissions** — drivers included. Spending an existing balance is a pure
   on-lot operation, so it goes through `assertStaff` (admin / agent / driver),
   matching `checkInBooking` / `checkOutBooking`, **not** the money-bearing
   `assertAgent` gate used by mark-paid / cashbook.
5. **Balance resolution order** — registered customer doc first, then the
   plate-keyed guest doc (`plate_{NORMALIZED}`), then a customer doc that merely
   lists the plate in its `plates` array. Mirrors the client `lookupByPlate`.

---

## What changed

### Server — `functions/src/index.js`

New callable **`checkInWithCredits({ plate, customerId?, credits = 1 })`**:

- `assertStaff` (driver allowed).
- Resolves the `tokenBalances` doc by the order in decision #5; throws
  `not-found / NO_BALANCE` if none.
- Refuses if the plate is already in `activeCheckIns`
  (`failed-precondition / ALREADY_CHECKED_IN`) — no double-charge.
- Deducts `credits` inside a Firestore transaction with a balance guard
  (`INSUFFICIENT_CREDITS` if `balance < credits`) so two agents can't overdraw.
- Best-effort spot assignment (first `available` spot → `occupied`); no free
  spot still allows check-in (same posture as the `grantCreditsForCash` walk-in
  branch).
- Writes `activeCheckIns/{plate}` (`source: 'manual'`), a `tokenTransactions`
  `use` row (`quantity: -credits`), and an `auditLog` `token_used` entry.

The resulting docs are shape-compatible with the existing client `useToken`
path, so the normal check-out (`checkOut(plate)`) and the credit-used / low-credit
email triggers continue to work unchanged.

### Client — `src/components/admin/CreateTransactionModal.js`

- Credit type now has a **sell / use** sub-mode toggle (gated by `allowWalkIn`).
- **Use existing** mode: hides the quantity/amount, paid-by, and walk-in
  auto-check-in controls (no money moves); shows a live **balance** readout and a
  **credits-to-use** input (default 1). The submit button relabels to "Check-in".
- Live balance lookup (debounced) resolves by matched customer then plate via
  `getBalance` / `lookupByPlate`, so the agent sees "(if they have any)" before
  acting. A monotonic token guards against out-of-order async results.
- Submit branch calls `checkInWithCredits` and maps the server error codes
  (`NO_BALANCE` / `INSUFFICIENT_CREDITS` / `ALREADY_CHECKED_IN`) to friendly
  strings. On success it closes and reports `{ checkedIn: true }` so the page
  jumps to the Check-out tab (same as the existing walk-in path).

### i18n — `src/i18n/ro.js` + `src/i18n/en.js`

New keys under `transactions.*`: `createCreditModeSell`, `createCreditModeUse`,
`createCreditsToUse`, `createBalanceLabel`, `createBalanceChecking`,
`createBalancePrompt`, `createBalanceCredits`, `createBalanceNone`,
`createCheckInSubmit`, `createCheckInSuccess`, `errorMissingCredits`,
`errorNoBalance`, `errorInsufficientCredits`, `errorAlreadyCheckedIn`.

---

## Files touched

**Modified (4):**
- `functions/src/index.js` — new `checkInWithCredits` callable
- `src/components/admin/CreateTransactionModal.js` — credit sub-mode + balance lookup + submit branch
- `src/i18n/ro.js`, `src/i18n/en.js` — `transactions.*` strings

No Firestore rules or index changes — all writes go through the admin-SDK
callable, and the collections touched (`tokenBalances`, `activeCheckIns`,
`tokenTransactions`, `spots`, `auditLog`) already have their rules.

**Deploy note:** ship with `firebase deploy --only functions` (the new callable)
plus a frontend rebuild/upload. No rules/indexes deploy required.

---

## Verification

- `node --check functions/src/index.js` — clean.
- `npm run build:vite` — clean (admin pages aren't prerendered).
- Existing customer with a balance: Walk-in → Credit → **Use existing** → pick
  client / enter plate → balance shows "N credits available" → Check-in →
  `tokenBalances` decremented, `activeCheckIns/{plate}` created, spot occupied,
  row appears on the Check-out tab.
- Plate already checked in → `ALREADY_CHECKED_IN` surfaced, no decrement.
- Balance below credits-to-use → `INSUFFICIENT_CREDITS`, no decrement.
- Plate/customer with no balance → balance shows "No credits available",
  submit surfaces `NO_BALANCE`.
- Driver role → allowed (matches check-in/check-out gating).
- Sell mode unchanged; `/admin/transactions` create flow unchanged.

---

## Reconciliation with earlier plans (reality snapshot, 2026-06)

Captured here because the v1.7 doc predates some of the as-built state:

- The walk-in **create-transaction modal still lives on `/admin/transactions`**
  as well as `/admin/checkins`. v1.7 §D proposed removing the create button from
  Transactions; in practice it was kept (the modal was extracted and shared, but
  the Transactions button was not removed). Both pages open the same modal with
  `allowWalkIn` on.
- The `/admin/checkins` "quick plate bar" referenced in the page header comment
  is a **search/filter** over the booking tabs, not a standalone check-in action.
  The new credit check-in is the walk-in modal path described above.
- Still **not built** as of this doc: SmartBill invoicing (v1.2), ANPR cameras
  (v1.3), the Netopia v2 REST migration (v1.4 — payments remain on the legacy
  XML/RSA-AES `createPayment` + `netopiaCallback`, refunds stay a manual admin
  queue). The cloud-account switch (`cloud-switch.md`) is still pending.

---

## Caveats and follow-ups

- **Multi-credit deduction is uncoupled from days.** Deducting N>1 credits puts
  one car on the lot for one `activeCheckIns` session; check-out doesn't refund
  or pro-rate. The default of 1 keeps the common case correct; agents deducting
  more should know it's a manual judgment, not a multi-day reservation.
- **No fiscal document** is produced (none is due — no money changes hands; the
  credits were already paid for at purchase time). When SmartBill (v1.2) lands,
  this path stays invoice-free by design.
- **Walk-in CTA copy** ("Walk-in nou") still reads as "new"; it now also covers a
  returning commuter spending existing credits. Rename deferred — low value.
