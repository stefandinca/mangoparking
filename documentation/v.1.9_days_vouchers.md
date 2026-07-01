# Mango Parking v1.9 — Long-term "free days" vouchers

> **Status: ✅ SHIPPED.** Implemented on the current `main`. The `days` voucher
> type, the `voucherDayBalances` collection, the free-order short-circuit, and
> the splittable day-balance logic in `resolveVoucher` / `createPayment` are all
> live. See "Caveats / follow-ups" below for the deferred edges (redemption at
> pay-time, no re-credit on cancel).

## Goal

A third promo-voucher type alongside `fixed` and `percent`: **days**. A days
voucher is worth N free days of long-term parking, valued at the booking's
own (tier/seasonal-aware) daily rate. Admin creates them from
`/admin/vouchers`; customers redeem them with the existing voucher-code box
on `/booking/long-term`.

## Locked decisions

1. **Long-term only.** Days vouchers are refused on the credits funnel with
   a dedicated `longterm-only` error. (Credits already have their own
   per-day economics — 1 credit = 1 day.)
2. **Valued at the booking's daily rate.** A 2-day voucher on a 10-day
   booking at 39 lei/zi takes off 78 lei. The rate comes from the same
   server-authoritative recompute (`computeAuthoritativeLongTermTotal`)
   that validates the price, so seasonal periods and tier boundaries are
   respected automatically.
3. **Full coverage → free order, skip Netopia.** When the voucher covers
   every booked day, the total hits 0 and `createPayment` short-circuits:
   the booking is created immediately as `paymentStatus: 'paid'`,
   `paidBy: 'voucher'`, the pending order flips straight to `paid`, and the
   client is sent to `/booking/return` — no Netopia handoff (Netopia
   refuses zero-amount charges anyway). Fixed/percent keep their historic
   1-leu floor.
4. **Splittable day balance.** Each identity (uid, or `plate:X` for
   guests) holds a balance equal to the voucher value and can spend it
   across multiple bookings — a 7-day voucher covers a 3-day stay now and
   a 4-day stay later. Booking 5 days against a 3-day balance spends the
   3 remaining days and charges the other 2 via Netopia as usual.
5. **`maxRedemptionsTotal` counts distinct holders** for days vouchers
   (an identity's first redemption), not individual splits — a returning
   holder can keep spending their remaining days after the cap fills.

## Data model

- `promoVouchers/{CODE}` — `type` gains the `'days'` variant; `value` is
  the number of free days (integer ≥ 1).
- **New collection `voucherDayBalances/{CODE}_{identityKey}`** —
  `{ voucherCode, identityKey, daysUsed, updatedAt }`. Server-written only
  (rules: staff read, no client writes). Read+updated inside the
  `createPayment` redemption transaction, so concurrent splits get real
  doc-level locking and can't overdraw the balance.
- `voucherRedemptions` rows gain `daysUsed` (null for fixed/percent) —
  the audit ledger of each individual split.
- `pendingOrders` gains `voucherDaysUsed`; free orders carry
  `paidBy: 'voucher'`, `amount: 0`.
- `bookings.paidBy` gains the `'voucher'` variant (free orders only).
  Convention kept from the existing voucher flow: `bookings.totalPrice`
  stays the gross value; the actually-charged amount lives on
  `pendingOrders.amount`.

## Flow changes

- `resolveVoucher` (functions/src/pricingValidate.js) — accepts
  `{ orderType, days, perDay }`. For `'days'`: long-term gate, balance
  lookup, `discount = min(remaining, bookedDays) × perDay` (NOT capped at
  base−1). Returns `daysUsed` + `daysAvailable` alongside the discount.
- `createPayment` — passes the authoritative `days`/`perDay` into
  `resolveVoucher`; redemption transaction updates the balance doc and
  increments `redeemedCount` only on an identity's first use; free-order
  short-circuit returns `{ free: true, redirectUrl }`.
- `validateVoucherCode` (preview callable) — passes client-side
  `days`/`perDay` through (display only; pay time re-resolves) and returns
  the day-balance extras.
- Client `netopiaService.startNetopiaPayment` — handles `free: true` like
  the pay-at-pickup short-circuit (navigate, no form POST).
- `BookingLongTerm` — sends `days`/`perDay` with the preview; re-derives
  the days discount live when dates change; total may display 0; submit
  button relabels to "Confirmă rezervarea gratuită" when fully covered;
  applied-voucher line shows days used + days left on the voucher.
- `BookingReturn` success card now shows the actually-charged
  `order.amount` (0 lei for free orders) instead of the gross total.
- `AdminVouchers` — "Zile gratuite (termen lung)" type option, integer
  validation, contextual hint, `-N zile` table label. Same label added to
  `/account/vouchers` and `/promotions` cards.

## Files touched

**Modified (12):** `functions/src/pricingValidate.js`,
`functions/src/index.js`, `firestore.rules`,
`src/services/promoVoucherService.js`, `src/services/netopiaService.js`,
`src/pages/public/BookingLongTerm.js`, `src/pages/public/BookingReturn.js`,
`src/pages/admin/AdminVouchers.js`, `src/pages/account/Vouchers.js`,
`src/pages/public/Promotions.js`, `src/i18n/ro.js`, `src/i18n/en.js`.

**Deploy note:** `firebase deploy --only firestore:rules,functions`
(new `voucherDayBalances` rule + `createPayment`/`validateVoucherCode`
changes), then rebuild + upload `dist/`. No composite indexes needed
(balance docs are fetched by ID; the free-path redemption stamp queries a
single-field `orderId`).

## Verification

- `node --check` on both functions files — clean.
- `npm run build:vite` — clean.
- Manual (after deploy):
  - Create a `days: 2` voucher → apply on a 5-day booking → discount =
    2 × tier rate, Netopia charges the remainder; `voucherDayBalances`
    doc shows `daysUsed: 2`.
  - Split test with a `days: 7` voucher — 3-day stay: applied line reads
    "3 zile gratuite … mai rămân 4 zile", balance doc `daysUsed: 3`;
    second 4-day stay with the same code → full coverage → free order,
    balance doc `daysUsed: 7`; third attempt → `no-days-left`.
  - Voucher covering the whole booking → button reads "Confirmă
    rezervarea gratuită", no Netopia redirect, `/booking/return` shows
    0 lei success, booking `paidBy: 'voucher'`, confirmation email (paid
    branch) arrives.
  - Exhausted balance → `no-days-left` error; credits page → `longterm-only`.
  - Fixed/percent vouchers behave exactly as before (one-shot, 1-leu floor).

## Caveats / follow-ups

- **Redemption happens at `createPayment` time** (pre-payment), matching
  the existing one-shot voucher behavior: abandoning the Netopia page
  after submitting burns the split days. Same trade-off as before, now
  with day balances; if it bites, move redemption to the IPN callback.
- **Cancellation does not re-credit days.** Cancelling a (partly) voucher-
  paid booking follows the normal refund queue; the spent days stay spent.
  Re-crediting on cancel would be a small follow-up (decrement the balance
  doc inside `cancelBookingWithRefund`).
- **Free bookings in the refunds queue** — cancelling a fully-voucher-paid
  booking flips it to `refund-pending` like any paid booking; admins see
  `paidBy: 'voucher'` and should mark it refunded with no money movement.
- **Emails show the gross total** for voucher-discounted bookings (existing
  convention, unchanged) — a fully-free booking's confirm email still
  prints the gross value with the "paid" branch.
