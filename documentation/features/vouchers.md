# Vouchers

> Status: ✅ Shipped · Last verified: 2026-07-09

## What it is

Three distinct voucher systems coexist:

1. **Promo vouchers** (`promoVouchers/{CODE}`) — admin-created codes entered at
   checkout. Four `type`s: **percent**, **fixed** (RON off), **days** (free
   long-term days, splittable), **credits** (a gift card that grants parking
   credits). This is the primary, active system.
2. **Legacy signup vouchers** (`vouchers/{uid}`) — a one-per-user 20 RON
   sign-up bonus. Not issued to new sign-ups anymore; honoured for in-flight
   balances.
3. **Credit gift vouchers** — the `credits` promo-voucher type, redeemed
   standalone to top up a [credit](credits.md) balance (not a checkout
   discount).

Server-side validation is centralized in
`functions/src/pricingValidate.js → resolveVoucher`; the admin UI is
`src/pages/admin/AdminVouchers.js` (`/admin/vouchers`).

## How it works

### Preview → validate → redeem

- **Preview** — booking pages call `promoVoucherService.previewVoucher({ code,
  plate, baseAmount, orderType, days, perDay })`
  (`src/services/promoVoucherService.js:117`) → the stateless
  **`validateVoucherCode`** callable (`functions/src/index.js:1944`) → returns
  `{ ok, discountAmount, type, value, daysUsed, daysAvailable }`. No redemption,
  no counter change — purely to show the customer their discount before paying.
- **Redeem (discount)** — at pay time `createPayment` re-runs `resolveVoucher`
  with the **server-recomputed** `days`/`perDay`, then commits the redemption in
  a transaction *before* writing the pending order (`index.js:511`). A successful
  preview is **not** a binding promise: expiry, sold-out, or a lost race is
  caught here and surfaced as `voucher: <reason>` so the client drops the code.
- **Redeem (credit gift)** — the `credits` type uses a separate
  **`redeemCreditVoucher`** callable (below), not the checkout discount.

### `resolveVoucher` — the rules (`pricingValidate.js:145`)

Checks, in order: voucher exists + `active`; `credits` type is refused here
(points the customer at the gift-redeem box); today (Bucharest day) is within
`[startDate, endDate]`; private vouchers require `authedUid ∈ assignedUserIds`;
`days` vouchers require `orderType === 'longTerm'` + a valid `days`/`perDay`
context.

**Identity key** — `uid:{authedUid}` for logged-in customers, else
`plate:{NORMALIZED_PLATE}` for guests. No uid and no plate → refused
(`no-identity`).

**Redemption model** differs by type:
- **fixed / percent** — one-shot per identity, enforced by a deterministic
  `voucherRedemptions/{CODE}_{identityKey}` doc (`tx.create` collides on a
  second attempt).
- **days** — **splittable**: each identity holds a day balance in
  `voucherDayBalances/{CODE}_{identityKey}` (`daysUsed`), read+written inside the
  `createPayment` transaction so concurrent splits can't overdraw. A 7-day
  voucher can cover a 3-day stay now and a 4-day stay later.

**Discount math:**
- `fixed` → `min(value, base − 1)` (keeps order ≥ 1 RON).
- `percent` → `round(base × value/100)`, capped at `base − 1`.
- `days` → `min(remaining, bookedDays) × perDay` — free days valued at the
  booking's own tier/seasonal daily rate; **not** capped at `base − 1`, so it may
  cover the whole total.

**`maxRedemptionsTotal`** caps total redemptions; for `days` vouchers it counts
**distinct holders** (an identity's first use), so a returning holder keeps
splitting their remaining balance after the cap fills.

### Days vouchers & the free-order short-circuit

When a `days` voucher covers the entire total, `createPayment` drives
`amount ≤ 0` and **skips Netopia** (`index.js:604`): it creates the booking
immediately as `paymentStatus: 'paid'`, `paidBy: 'voucher'`, flips the pending
order to `paid`, and returns `{ free: true, redirectUrl }`. The client
(`netopiaService.startNetopiaPayment`) navigates without a form POST. Netopia
refuses zero-amount charges, hence the short-circuit. Fixed/percent keep the
1-leu floor. Full design: [v.1.9_days_vouchers.md](../v.1.9_days_vouchers.md).

### Credit gift vouchers (`redeemCreditVoucher`)

`redeemCreditVoucher({ code, plate })` (`index.js:1978`) grants
`value` free credits straight to the holder's balance — uid-keyed for logged-in
customers, `plate_{…}` for guests (plate required for guests). One redemption per
identity (`voucherRedemptions/{CODE}_{identityKey}`), guarded inside the grant
transaction; caps and validity window enforced. Writes a `tokenTransactions`
`purchase` row (`source: 'gift-voucher'`, `paidBy: 'voucher'`) which fires the
credit-confirmation email. Surfaced through the gift-redeem card on
`/booking/credits`. See [credits](credits.md) and
[v.1.10_credit_vouchers.md](../v.1.10_credit_vouchers.md).

### Legacy signup vouchers

`vouchers/{uid}` (doc id = uid enforces one-per-user). `voucherService.js`:
`getMyVoucher`, `ensureSignupVoucher` (idempotent, 20 RON, `status: 'unused'`).
Applied **online-only** in `createPayment` (`index.js:468`) when the amount
exceeds the voucher, and consumed (`status: 'redeemed'`) in the IPN callback
(`index.js:845`). Promo codes **win** over the signup voucher when both are
present; vouchers never combine.

### Admin: create / edit / feature (`AdminVouchers.js`)

The modal captures `code` (uppercased, `[A-Z0-9]{3,24}`, doc-id-unique), `name`,
`type`, `value`, `startDate`/`endDate`, `visibility` (public/private),
`assignedUserIds` (required for private — checkbox picker over users),
`maxRedemptionsTotal`, `active`, and **`showOnPromotions`**. The
`showOnPromotions` toggle features the voucher on the public `/promotions` page
and is **forced off for private codes** (`AdminVouchers.js:380`); featured rows
show a badge in the admin table. `saveVoucher` (`promoVoucherService.js:73`)
re-reads the live `redeemedCount` before overwriting the doc so a stale admin
snapshot can't roll the server-owned counter back. See [commit `5dbdb22`].

## Key files

| File | Role |
|---|---|
| `src/services/promoVoucherService.js` | Promo CRUD, `previewVoucher`, `redeemCreditVoucher`, `normalizeCode`. |
| `src/services/voucherService.js` | Legacy signup voucher (`getMyVoucher`, `ensureSignupVoucher`). |
| `src/pages/admin/AdminVouchers.js` | Admin create/edit/delete + feature toggle. |
| `functions/src/pricingValidate.js` | `resolveVoucher` — all promo validation + discount math. |
| `functions/src/index.js` | `validateVoucherCode`, `redeemCreditVoucher`, and the redemption transaction inside `createPayment`. |

## Data (Firestore)

**`promoVouchers/{CODE}`** (doc id = uppercased code):
```
code, name, active,
type: 'fixed'|'percent'|'days'|'credits',
value,                       // RON | 1-100 % | free days | free credits
startDate, endDate,          // inclusive YYYY-MM-DD
visibility: 'public'|'private',
assignedUserIds: [],         // required for private
maxRedemptionsTotal: null|int,
redeemedCount: 0,            // server-incremented only
showOnPromotions,            // feature on /promotions (public only)
createdBy, createdAt, updatedAt
```
Rules (`firestore.rules:71`): public vouchers anonymously readable, admins read
all, private readable only by assigned uids; admin-only write.

**`voucherRedemptions/{…}`** — ledger. Deterministic id
`{CODE}_{identityKey}` for one-shot (fixed/percent/credits); auto-id for `days`
splits. Fields: `voucherCode`, `identityKey`, `userId`, `plate`, `orderId`,
`bookingId`, `amount`, `type`, `value`, `daysUsed`, `creditsGranted`,
`redeemedAt`. **Server-written only** (`firestore.rules:87`).

**`voucherDayBalances/{CODE}_{identityKey}`** — `{ voucherCode, identityKey,
daysUsed, updatedAt }`. Server-written; staff read (`firestore.rules:95`).

**`vouchers/{uid}`** — legacy signup: `{ userId, amount: 20, currency,
status, source: 'signup-incentive', createdAt, redeemedAt, redeemedOn }`. Client
may only create the exact 20 RON `unused` doc; the IPN flips it to `redeemed`
(`firestore.rules:130`).

## Server (Cloud Functions)

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `validateVoucherCode` | callable | public | Stateless eligibility preview (`resolveVoucher`) |
| `redeemCreditVoucher` | callable | public/owner | Grant a `credits` gift voucher to a balance |
| (redemption tx) | inside `createPayment` | — | Atomic redeem + counter/balance update at pay time |

## Gotchas / edge cases

- **Redemption happens at `createPayment` (pre-payment).** Abandoning the
  Netopia page after submitting burns a one-shot redemption / spends split days.
  Same trade-off across all types.
- **Cancellation does not re-credit days** — spent days stay spent; a fully-
  voucher-paid booking still enters the refund queue (mark refunded, no money).
- **`credits` type is refused by `resolveVoucher`** — it's a gift grant, not a
  discount, so the checkout box rejects it and points at the gift-redeem card.
- **Days vouchers are long-term only** (`longterm-only` error on the credits
  funnel).
- **Preview vs pay authority** — preview uses client-supplied `days`/`perDay`;
  pay time always re-resolves with server-recomputed values, so a preview can
  succeed and pay still (correctly) refuse.
- **Emails show the gross total** for voucher-discounted bookings; the actually-
  charged amount lives on `pendingOrders.amount`.

## Planned / not built

- **Re-crediting days on cancel** — a noted follow-up (decrement the balance doc
  inside the cancel flow).
- **Combining vouchers** — explicitly unsupported; only one applies per order.
