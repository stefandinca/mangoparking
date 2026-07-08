# Auth & Customer Account

> Status: ✅ Shipped · Last verified: 2026-07-09

The sign-in / registration flow and the logged-in customer self-service area.
Auth pages are public (`guards: []`); the four `/account/*` pages sit behind the
`['auth']` guard in `src/router/routes.js` and share `accountLayout()` from
`src/components/account/AccountLayout.js`.

Related: [Public site](./public-site.md) · [Admin panel](./admin.md) ·
[i18n & permissions](../backend/i18n-and-permissions.md)

---

## The `['auth']` guard

Every `/account/*` route declares `guards: ['auth']`. `checkGuards`
(`src/router/guards.js:20-22`) redirects a signed-out visitor to
`localePath('/login')`. The router awaits `authReady` before the first dispatch,
so a hard refresh on an account page does **not** wrongly bounce a signed-in user
(`src/router/index.js:44-50`). These routes require only authentication — there
is no role check, so any signed-in `customer` (or staff) can view them.

## Account layout

`accountLayout(activePath, contentHtml)` renders a left sidebar (desktop) and a
collapsible dropdown (mobile) with four links — Dashboard, Bookings, Vouchers,
Vehicles (`AccountLayout.js:3-8`). Pages call `initAccountNav(pageEl)` after
mounting to wire the mobile toggle. Note: the `/account/subscription` and
`/account/loyalty` entries and their icons still exist in code but the routes are
commented out (hidden — see [admin doc](./admin.md#hidden--commented-out-routes)).

---

## Auth pages

### `/login` (`src/pages/auth/Login.js`)
Sign in with **email/password** (`loginWithEmail`) or **Google OAuth**
(`loginWithGoogle`). After either, it calls
`mergeGuestDataForCurrentUser()` (`userMergeService`) to reconcile any prior
guest activity (plate-keyed balances / bookings) into the account, then
redirects to `/account`. A collapsible **forgot-password** panel calls the
`requestPasswordReset` callable to send a reset magic link. Firebase error codes
are mapped to i18n messages and shown inline.

### `/register` (`src/pages/auth/Register.js`)
Create an account with display name, email, phone, and password
(`registerWithEmail`), or sign up with Google (`loginWithGoogle`). Client-side
validation covers phone (`isValidPhone`) and password match. On success it runs
the same guest-data merge and redirects to `/account`. New accounts are always
role `customer` (enforced by Firestore rules — see
[permissions](../backend/i18n-and-permissions.md#2-roles--permissions)).

### `/auth/finish-signup` (`src/pages/auth/FinishSignup.js`)
Completes an **admin-issued magic-link invite**. It verifies the email link
(`isSignInWithEmailLink`), signs the user in (`signInWithEmailLink`) — reading
the email from the query param or `localStorage['mango.invite.email']` — then
calls the `finishInviteSignup` callable to stamp the invited role + display name
from the `pendingInvites` doc, and prompts the user to set a permanent password
(`updatePassword`, 8-char minimum). Invalid/expired links render an error block
with a login link; the `finishInviteSignup` step is non-fatal. Redirects to
`/account` on success. (Invites are created from
the [admin users section](./admin.md).)

---

## Account pages

### `/account` — Dashboard (`src/pages/account/Dashboard.js`)
The account home. Shows a welcome greeting, an **editable profile card** (name /
email / phone / billing, saved via `updateDocument('users', uid, …)`), stat
cards (credit balance, total purchased, saved-vehicle count from
`getBalance()`), an **upcoming reservations** widget (long-term `bookings` with
status `upcoming`/`active`, plus active credit check-ins read per plate from
`activeCheckIns`), a promo-voucher hint card, an optional legacy signup-voucher
banner (`getMyVoucher()`), reserve CTAs into both funnels, and the last 5
transactions (`getTransactions(uid, 5)`). Usable promo count is derived from
`promoVouchers` assigned to the uid minus `voucherRedemptions`.

### `/account/bookings` — Booking history (`src/pages/account/BookingHistory.js`)
Tabbed **Upcoming / Past** view. Upcoming lists pending pay-at-pickup credit
orders (`pendingOrders` where `customerData.customerId == uid`) and upcoming
`bookings`; Past lists completed/cancelled bookings and all transactions
(`getTransactions(uid, 100)`). Self-service cancellation: `cancelBookingWithRefund`
for bookings (shows the refund outcome in a toast) and `cancelPendingCreditOrder`
for unpaid credit orders. The page reloads after a successful cancel.

### `/account/vouchers` — Vouchers (`src/pages/account/Vouchers.js`)
Grid of the customer's **promo vouchers** (admin-assigned `promoVouchers` where
`assignedUserIds` array-contains uid), each with a status badge (active /
upcoming / used / expired / inactive, derived from the active flag, date window,
and `voucherRedemptions` lookup) and copy-to-clipboard. Also shows the legacy
signup voucher (`vouchers/{uid}`) and embeds the **gift-code redeem** widget
(`giftCodeRedeemCard()` from `GiftCodeRedeem.js`), which reloads the page on a
successful redemption.

### `/account/vehicles` — Vehicles (`src/pages/account/Vehicles.js`)
Manage saved vehicles (license plate, make, model) stored on the user doc's
`vehicles[]` array. Add via a form and remove via a confirm modal; both mutate
the local array and persist with `updateDocument('users', uid, { vehicles })`,
re-rendering the list and toasting success/error. Saved vehicles prefill the
booking funnels' vehicle step.

---

## Notes / caveats
- Structural facts (routes, the `['auth']` guard, the shared layout) were verified
  directly in `src/router/{routes,guards}.js` and `AccountLayout.js`. Page-level
  service/callable names above come from reading the page modules; specific line
  numbers may drift — grep the named function.
- Sign-out lives in the public Navbar, not in the account layout.
