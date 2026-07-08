# Credits (daily-parking tokens)

> Status: ✅ Shipped · Last verified: 2026-07-09

## What it is

The **credit** system sells daily-parking tokens: **1 credit = 1 day of parking**.
Customers buy credits online in admin-configured *packs*; staff spend one credit
per parking day at the lot via a plate lookup. Credits are date-flexible (not
tied to a reservation), which is why they suit commuters / frequent travellers.

It runs side by side with [long-term bookings](long-term-bookings.md). Shared
concerns live in [pricing](pricing.md) (pack prices + online discount),
[vouchers](vouchers.md) (credit-gift vouchers) and [billing](billing.md)
(invoice identity on a sale).

## How it works

There are four ways credits move; all of them funnel money-and-balance writes
through **server code** (`functions/src/index.js`), never the browser:

1. **Buy online** — `src/pages/public/BookingCredits.js` → `createPayment`
   (Netopia) → IPN `netopiaCallback` → `creditTokens()` grants the balance.
2. **Sell at the lot** — `grantCreditsForCash` callable (cash/card walk-in),
   optionally auto-checking-in the car.
3. **Check in against an existing balance** — `checkInWithCredits` callable
   (spends credits the customer already holds; no money).
4. **Grant / gift** — `adminGrantCredits` (free grant) and `redeemCreditVoucher`
   (a `credits`-type gift voucher — see [vouchers](vouchers.md)).

### Buy-online data flow

`BookingCredits.js` is an accordion: **pack → vehicle/contact → billing →
voucher**, with a sticky summary + terms/privacy consents + pay button. On
submit it calls `startNetopiaPayment({ orderType: 'credits', paymentMethod,
packId, quantity, packPrice, voucherCode, customerData })`
(`BookingCredits.js:804`). It always sends the **standard** pack price; the
server applies the online discount and any voucher on top.

`createPayment` (`functions/src/index.js:310`):
- Recomputes the authoritative pack price with
  `computeAuthoritativePackPrice({ packId, quantity })`
  (`functions/src/pricingValidate.js:273`) and **rejects** any submitted price
  that doesn't match — a tampered `packPrice` can't buy a premium pack cheaply.
- For `online`, subtracts `settings/global.onlineDiscountPercent`
  (`index.js:398`). Pay-at-pickup is charged the standard price.
- Resolves a promo voucher via `resolveVoucher` and subtracts it.
- Writes a `pendingOrders/{ord_…}` doc, then either short-circuits
  (pay-at-pickup) or returns the encrypted Netopia envelope.

`netopiaCallback` (`index.js:705`) is the **only** place an online credit order
becomes `paid`. On a `confirmed` IPN it calls `creditTokens(...)` (`index.js:827`)
and stamps the order `status: 'paid'`. It's idempotent (`status === 'paid'`
short-circuits) so Netopia retries don't double-credit. The `/booking/return`
page polls the order status.

> **Pay-at-pickup credits are NOT credited at order time.** The balance is only
> granted when staff collect cash and flip the order via `adminMarkOrderPaid`.

### `creditTokens()` — the shared grant path

`creditTokens({ packId, quantity, amount, customerData, source, paidBy,
grantedBy })` (`index.js:126`) is reused by the IPN, the cash sale, gifts and
gift-voucher redemption so every resulting doc is shape-identical.

- **Balance doc id** = `customerData.customerId` (logged-in uid) **or**
  `plate_{NORMALIZED_PLATE}` (guest). This is the guest-vs-logged-in keying
  rule, `balanceDocId()`.
- Inside a Firestore transaction: increments `balance` + `totalPurchased`, adds
  the plate to `plates[]` (skips empty plates), and back-fills missing
  `email` / `displayName` / `phone` (so a guest plate doc that later signs up
  becomes reachable).
- Appends a `tokenTransactions` row (`type: 'purchase'`, `amount`, `source`,
  `paidBy`, `grantedBy`, `billing`). That row fires the credit-purchase email
  and admin notification.
- Caches `customerData.billing` onto `users/{uid}` for future prefill.

### Spending a credit at the lot

**Check-in against existing credits** — `checkInWithCredits({ plate,
customerId?, credits = 1 })` (`index.js:2823`, `assertStaff` — **drivers
allowed**, it's a pure on-lot op):
- Resolves the balance doc in the order: registered `customerId` → `plate_{…}`
  guest doc → a customer doc whose `plates[]` contains the plate (mirrors the
  client `lookupByPlate`). Throws `NO_BALANCE` if none.
- Refuses `ALREADY_CHECKED_IN` if the plate is in `activeCheckIns`.
- Deducts `credits` inside a transaction guarded by `INSUFFICIENT_CREDITS`
  (`balance < credits`) so two agents can't overdraw.
- Best-effort assigns the first `available` spot → `occupied`, writes
  `activeCheckIns/{plate}` (`source: 'manual'`), a `use` transaction
  (`quantity: -credits`), and a `bookings` doc via `createCreditCheckInBooking`
  so the car reaches check-out + the capacity map.

**Walk-in sell + auto-check-in** — `grantCreditsForCash({ plate, quantity,
amount, paidBy, autoCheckIn, billing, … })` (`index.js:2483`, `assertStaff`):
sells credits (cash/card) via `creditTokens` (`source: 'admin-cash'`,
`paidBy: 'admin-cash'|'admin-card'`), records a cashbook entry for cash, and if
`autoCheckIn` consumes one credit + writes the same `activeCheckIns` /
`bookings` / `use`-transaction trio.

Both surfaces are the shared `CreateTransactionModal` (the "Walk-in nou" CTA on
`/admin/checkins`, also on `/admin/transactions`); the credit type has a
**sell / use** sub-toggle. See [v.1.8](../v.1.8_credit_checkin.md).

### Credit check-in bookings

`createCreditCheckInBooking(db, { plate, customerId, contact, spotId, source })`
(`index.js:2779`) writes a `bookings` doc with `type: 'credit'`,
`paymentMethod: 'credit'`, `paidBy: 'credit'`, `status: 'active'`, and a
**pick-up of that day's 20:00 Bucharest cutoff** (commuters must leave by 8 PM),
not the drop-off time. Check-out then runs the normal booking check-out.

## Key files

| File | Role |
|---|---|
| `src/services/tokenService.js` | Client helpers: `getTokenPacks`, `getBalance`, `getBalanceByPlate`, `lookupByPlate`, `isCheckedIn`, admin pack CRUD. Also legacy client-side `purchaseTokens` / `useToken` / `checkOut` / `refundToken` (see gotcha). |
| `src/pages/public/BookingCredits.js` | Public buy-credits accordion + Netopia handoff. |
| `src/components/admin/CreateTransactionModal.js` | Walk-in sell / use-existing modal (`grantCreditsForCash`, `checkInWithCredits`). |
| `functions/src/index.js` | `creditTokens`, `createPayment`, `netopiaCallback`, `grantCreditsForCash`, `checkInWithCredits`, `adminGrantCredits`, `redeemCreditVoucher`, `createCreditCheckInBooking`. |
| `functions/src/pricingValidate.js` | `computeAuthoritativePackPrice` — server price guard. |

## Data (Firestore)

**`tokenBalances/{docId}`** — `docId` is the uid (logged-in) or
`plate_{NORMALIZED_PLATE}` (guest).
```
balance          // int — spendable credits
totalPurchased   // int — lifetime credits granted
plates: []       // normalized plates tracked on this balance
email, displayName, phone
```
Rules (`firestore.rules:101`): staff read/write; an authed owner reads/writes
their own uid doc; **any client** may create/update a `plate_*` doc (guest
checkout). Delete is admin-only.

**`tokenTransactions/{auto}`** — append-only ledger.
```
customerId | null, licensePlate, type: 'purchase'|'use'|'checkout'|'refund'|'lateFee',
quantity  // +N purchase, -N use, 0 checkout
amount, packId, spotId, bookingId, timestamp,
source    // 'netopia'|'admin-cash'|'admin-gift'|'gift-voucher'|'walk-in'|'manual'
paidBy, grantedBy, billing, voucherCode
```
Rules (`:113`): clients may create **only non-`use`** rows; `use` rows are
server-written (admin SDK) so they don't spam the credit-used email trigger.
No client update/delete.

**`tokenPacks/{auto}`** — admin-managed packs (edited at `/admin/pricing`):
`quantity`, `price` (the **standard** on-site price), `name` / `nameRo`,
`sortOrder`, `active`. Public read, admin write.

**`activeCheckIns/{normalizedPlate}`** — cars currently on the lot (staff-only).
Written by the check-in callables; removed at check-out.

## Server (Cloud Functions)

All in `europe-west1`. See [long-term bookings](long-term-bookings.md) for the
shared Netopia/booking plumbing.

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `createPayment` | HTTP | public | Price-guard + envelope for a credit order |
| `netopiaCallback` | HTTP (IPN) | Netopia | Only place online credits are granted (`creditTokens`) |
| `grantCreditsForCash` | callable | `assertStaff` | Sell credits at lot (cash/card) + optional auto-check-in |
| `checkInWithCredits` | callable | `assertStaff` (drivers) | Spend an existing balance to check a car in |
| `adminGrantCredits` | callable | `assertAgent` | Free gift/comp grant (`source: 'admin-gift'`, `paidBy: 'gift'`) |
| `redeemCreditVoucher` | callable | public/owner | Redeem a `credits`-type gift voucher — see [vouchers](vouchers.md) |

## Gotchas / edge cases

- **Legacy client token writes.** `tokenService.js` still exports
  `purchaseTokens` / `useToken` / `checkOut` / `refundToken` that write
  `tokenBalances` / `tokenTransactions` directly. The shipped money paths are
  the server functions above — the admin check-in/out pages no longer import
  `useToken` / `checkOut` (they use booking callables + `checkInWithCredits`).
  Treat the client mutators as legacy.
- **Guest `plate_*` balances are client-writable** by rule (needed for guest
  checkout), so the plate-keyed doc is the trust boundary — a guest could seed a
  `plate_*` doc, but they can't grant themselves a paid balance because the
  purchase grant runs server-side after payment.
- **Multi-credit deduction is uncoupled from days.** `checkInWithCredits` with
  `credits > 1` still creates a single one-day `activeCheckIns` session;
  check-out neither refunds nor pro-rates. Default is 1. (v1.8 caveat.)
- **No invoice for a credit check-in** — no money changes hands (the credits
  were paid for at purchase). See [billing](billing.md).
- **Credit check-in pick-up is the same-day 20:00 cutoff**, not 24h — commuters
  are expected to leave by 8 PM.

## Planned / not built

- **SmartBill invoicing** for credit sales — billing identity is captured but no
  invoice is issued. See [billing](billing.md) and
  [roadmap/v.1.2_smartbill.md](../roadmap/v.1.2_smartbill.md).
- **ANPR auto check-in/out** by plate — [roadmap/v.1.3_anpr.md](../roadmap/v.1.3_anpr.md).
