# Mango Parking v1.10 — Credit gift vouchers + direct credit grants

> **Status: ✅ SHIPPED.** Implemented on the current `main`. The `credits`
> voucher type, the `redeemCreditVoucher` and `adminGrantCredits` callables, the
> shared `GiftCodeRedeem` widget, and the user-detail "Grant credits" action are
> live. **Brevo follow-up:** the dedicated `credit-voucher-assigned-{ro,en}`
> templates must be pasted into Brevo and their IDs set in `emailTemplates.js`;
> until then that email falls back to the discount-framed `voucher-assigned`.

## Goal

Two ways to give a commuter free parking credits:

1. **Credits gift voucher** — a fourth `promoVouchers` type, `credits`,
   alongside `fixed` / `percent` / `days`. Admin creates a code worth N
   credits; the customer redeems it (no purchase) and the N credits land
   straight in their balance. A gift card, not a discount.
2. **Direct admin grant** — admin grants free credits to a specific
   registered user from the user-detail modal, no code and no cash.

## Locked decisions

1. **Gift voucher = free credits, not a discount.** Redemption is a
   standalone action, decoupled from any purchase. `resolveVoucher`
   (the checkout discount resolver) refuses `type: 'credits'` with a
   `gift-only` error so a gift code pasted into the purchase voucher box
   tells the customer to use the redeem box instead.
2. **Redeemable in two places** — the public credits page
   (`/booking/credits`) and the account vouchers page (`/account/vouchers`),
   via a shared `GiftCodeRedeem` widget.
3. **One redemption per identity.** uid for logged-in customers,
   normalized plate for guests — enforced with a deterministic
   `voucherRedemptions/{CODE}_{identityKey}` doc read + written inside the
   grant transaction (no double-spend under races). `maxRedemptionsTotal`
   counts redemptions as usual.
4. **Guests redeem by plate** (public vouchers only); the plate keys their
   `tokenBalances/plate_{PLATE}` doc. Private (assigned) vouchers require
   the logged-in assigned uid, same as other private vouchers.
5. **Direct grant is agent/admin only** (`assertAgent`), credits the
   uid-keyed balance, derives the (informational) plate from the user's
   first saved vehicle, and writes no cashbook entry (it's free).

## Data model

- `promoVouchers/{CODE}` — `type` gains the `'credits'` variant; `value`
  is the number of free credits (integer ≥ 1). No new fields.
- `voucherRedemptions` rows for a credits redemption carry
  `type: 'credits'`, `creditsGranted: N`, `amount: 0`, `daysUsed: null`.
- `tokenTransactions` — both flows write a `type: 'purchase'` row with
  `amount: 0`. Gift voucher: `source: 'gift-voucher'`, `paidBy: 'voucher'`,
  `voucherCode`. Direct grant: `source: 'admin-gift'`, `paidBy: 'gift'`,
  `grantedBy: <uid>`.
- **No new collection, no rules change, no index** — both callables write
  via the Admin SDK, and the only client read (assigned promo vouchers on
  `/account/vouchers`) was already permitted.

## Flow changes

- `functions/src/index.js`
  - `creditTokens` — hardened to skip empty plates in the `plates` array
    (an account-only grant may have none).
  - **`redeemCreditVoucher`** (new callable) — validates the code
    (active, window, `type==='credits'`, visibility/assignment), resolves
    identity + balance target, then grants credits + stamps the one-shot
    redemption + bumps `redeemedCount` + writes the ledger row, all in one
    transaction. Returns `{ ok, credits, balance, balanceDocId }` or
    `{ ok: false, error }`.
  - **`adminGrantCredits`** (new callable) — `assertAgent`; grants N free
    credits to a user via `creditTokens` (`source: 'admin-gift'`), audit
    log, no cashbook.
- `functions/src/pricingValidate.js` — `resolveVoucher` returns
  `gift-only` for `type: 'credits'`.
- `src/services/promoVoucherService.js` — `redeemCreditVoucher` wrapper.
- `src/components/widgets/GiftCodeRedeem.js` (new) — shared redeem card
  (code + optional guest plate → callable → result line + toast).
- `BookingCredits.js` / `account/Vouchers.js` — mount the redeem card
  (guest plate input on the public page; account page derives the plate).
- `AdminVouchers.js` — `credits` type option, contextual hint, integer
  validation, `+N credits` table label.
- `UserDetailModal.js` — "Grant credits" action in the balance card
  (agent/admin, real account only) + `credits` voucher value label.
- `Promotions.js` / `account/Vouchers.js` — `credits` value headline.
- `functions/src/emails.js` — `onPromoVoucherAssigned` (the email sent when
  a private voucher is assigned) now routes `credits` vouchers to a dedicated
  **`credit-voucher-assigned`** template with gift copy (free credits, redeem
  CTA) instead of the discount-framed `voucher-assigned`. `voucherValueText`
  gains a `credits` branch ("N credite gratuite" / "N free credits"), so even
  the fallback shows the right unit. New `email-templates/credit-voucher-
  assigned-{ro,en}.html`; IDs `null` in `emailTemplates.js` until pasted into
  Brevo, with a graceful fallback to `voucher-assigned` meanwhile.

## Files touched

**Modified (10):** `functions/src/index.js`,
`functions/src/pricingValidate.js`, `src/services/promoVoucherService.js`,
`src/pages/admin/AdminVouchers.js`, `src/components/admin/UserDetailModal.js`,
`src/pages/account/Vouchers.js`, `src/pages/public/BookingCredits.js`,
`src/pages/public/Promotions.js`, `src/i18n/ro.js`, `src/i18n/en.js`.
**New (2):** `src/components/widgets/GiftCodeRedeem.js`,
this doc.

**Deploy note:** `firebase deploy --only functions` (two new callables +
the `creditTokens` / `resolveVoucher` tweaks + the voucher-assignment email
routing). No rules/index changes, then the usual Vercel build on push.
**Brevo:** paste `email-templates/credit-voucher-assigned-{ro,en}.html` into
Brevo and drop the two numeric IDs into `emailTemplates.js` to switch the
credit-gift assignment email off the fallback onto its dedicated template.

## Verification

- `node --check` on `functions/src/index.js` + `pricingValidate.js` — clean.
- `npm run build:vite` — clean.
- Manual (after deploy):
  - Create a `credits: 10` public voucher → redeem on `/booking/credits`
    as a guest (with a plate) → balance shows +10; `voucherRedemptions`
    has the row; second redeem with the same plate → `already-used`.
  - Redeem the same code while logged in (account page) → +10 on the uid
    balance, plate derived from profile.
  - Paste a credits code into the purchase voucher box → `gift-only` error.
  - Private credits voucher → guest redeem → `must-be-logged-in`; assigned
    user redeems once.
  - User-detail modal → Grant credits (e.g. 5) → balance updates, audit row
    `admin_credits_gifted`, no cashbook entry.

## Caveats / follow-ups

- **Confirmation email reuses the credit-purchase template** (shows
  `0 lei`, "paid" branch) for both flows, and the rezervari@ admin
  notification fires too. Functional; a dedicated "gift received" wording
  is a small follow-up in `emails.js handlePurchase` (branch on
  `source === 'gift-voucher' || 'admin-gift'`).
- **Deleting a credits voucher orphans its `voucherRedemptions` rows**
  (same pre-existing behavior as fixed/percent — see admin-flows/05 Bug 6);
  reusing the code would deny prior redeemers.
- **Cancellation does not claw back gifted credits** — credits, once
  granted, stay on the balance.
