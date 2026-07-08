# Firestore Data Model

> Status: ✅ Shipped · Last verified: 2026-07-09

Every Firestore collection in use, verified against `functions/src/index.js`,
`src/services/*.js`, `src/firebase/db.js`, [`firestore.rules`](../../firestore.rules),
and [`firestore.indexes.json`](../../firestore.indexes.json). Sibling docs:
[cloud-functions.md](./cloud-functions.md) · [security-rules.md](./security-rules.md).

## Conventions

- **Money math + privileged writes are server-only.** Clients cannot write
  `tokenTransactions` `use` rows, cash ledgers, booking paid-state, order
  fulfilment, audit rows, etc. Those go through admin-SDK Cloud Functions that
  bypass rules. See [security-rules.md](./security-rules.md).
- **Timestamps** are mostly ISO-8601 strings (`new Date().toISOString()`), not
  Firestore `Timestamp` objects. A few idempotency markers written by triggers
  use `serverTimestamp()`. The generic `db.js` helpers (`addDocument`,
  `updateDocument`) auto-stamp `createdAt` / `updatedAt` as `serverTimestamp()`.
- **Plates** are normalised everywhere as `UPPERCASE` with spaces and hyphens
  stripped: `String(p).toUpperCase().replace(/[\s-]/g, '')`.
- Collections are small; the client filters/sorts in memory to avoid composite
  indexes (only 5 composite indexes exist — see `firestore.indexes.json`).

---

## users

- **Purpose:** customer + staff profile. Drives role guards (server + rules).
- **ID:** `{uid}` (Firebase Auth uid).
- **Writer:** self (create/update except `role`) or admin; several server
  callables (`adminCreateUser`, `adminChangeUserRole`, `adminUpdateUserProfile`,
  `finishInviteSignup`, `mergeGuestData`) also write via the admin SDK.
- **Shape:**
  - `email` string · `displayName` string · `phone` string
  - `role` `'customer' | 'agent' | 'driver' | 'admin'` (legacy `'staff'` == agent)
  - `locale` `'ro' | 'en'`
  - `vehicles` array of `{ plate, make, model }`
  - `billing` object — cached PF/PJ invoice identity (see BillingFields), pre-filled on next checkout
  - `loyaltyPoints` number · `loyaltyTier` `'bronze'|'silver'|'gold'` (loyalty is a hidden feature)
  - `createdAt` ISO · `createdBy` uid|null (set for admin-created accounts)
  - Idempotency markers written by triggers: `welcomeEmailSentAt`, `adminNotifiedAt` (serverTimestamp)
- **Access:** owner + any staff read; owner-or-admin write (owner cannot change own `role`).

## bookings

- **Purpose:** the single lifecycle collection for **long-term reservations**
  (`type: 'longTerm'`) *and* **credit/commuter check-ins** (`type: 'credit'`).
  Powers the check-out tab, capacity map, reminders, no-show detection.
- **ID:** auto.
- **Writer:** authenticated client create; staff or owner update; several server
  callables create/patch it (`createBookingFromOrder`, `adminCreateLongtermBooking`,
  `createCreditCheckInBooking`, reprice/overstay/cancel/refund flows).
- **Shape (long-term):**
  - `code` string — human reservation code, `LT-XXXXX` (see `src/utils/bookingCode.js`)
  - `type` `'longTerm' | 'credit'` (also legacy `'traveler'` from the old `bookingService.createBooking`)
  - `customerId` uid|null (null for guests)
  - `licensePlate` normalised string
  - `startDate` / `endDate` — date-only, legacy/back-compat
  - `dropoffAt` / `pickupAt` — **canonical** ISO datetimes
  - `days` number
  - `basePrice` / `latePrice` / `totalPrice` — RON (charged amount = online-discounted or standard)
  - `status` `'upcoming' | 'active' | 'completed' | 'cancelled' | 'no-show'`
  - `contact` `{ name, email, phone }` · `billing` PF/PJ object
  - `paymentId` — the `pendingOrders` orderId (null for admin direct bookings that skip pendingOrders)
  - `paymentMethod` `'online' | 'pay-at-pickup' | 'credit' | 'admin' | 'broker'`
  - `paymentStatus` `'unpaid' | 'paid' | 'refund-pending' | 'refunded'`
  - `paidAt` ISO|null · `paidBy` `'netopia' | 'admin-cash' | 'admin-card' | 'broker' | 'voucher' | 'credit' | null`
  - `spotId` string|null · `source` `'web' | 'admin' | 'broker' | 'walk-in'`
  - `checkinTimestamp` / `completedAt` / `checkoutTimestamp` ISO|null
  - Overstay/reprice: `overstayChargedAt/By`, `extensionPrice`, `extensionPaidBy`,
    `pendingRefundAmount`, `pendingRefundReason`, `checkoutRefundedAt/By/Via/Amount`
  - Refund: `refundRequestedAt`, `refundedAt/By/Via`, `refundNotes`, `refundEmail` block
  - No-show: `noShowAt`, `noShowDetectedBy` (`'scheduled' | 'admin-cancel'`)
  - `brokerName` string|null · `notes` string|null · `createdBy` uid
  - Idempotency: `confirmEmailSentAt`, `reminderCheckinSentAt`, `reminderCheckoutSentAt`,
    `adminNotifiedAt`, `adminCancelNotifiedAt`, `adminRefundNotifiedAt`
- **Access:** staff read all; customer reads own (`customerId`). Delete admin-only.

## tokenBalances

- **Purpose:** credit (day-token) balance per registered user or per guest plate.
- **ID:** `{uid}` (logged-in) **or** `plate_{NORMALIZED_PLATE}` (guest).
- **Writer:** owner/guest client create+update; staff full access; server credits
  it via `creditTokens` (IPN, cash grants, gift-voucher redemption).
- **Shape:**
  - `balance` number (credits remaining) · `totalPurchased` number (lifetime)
  - `plates` array of normalised plates tracked on this balance
  - `email` / `displayName` / `phone` — contact snapshot (used by `resolveRecipient` for emails)
- **Access:** staff, the owning uid, or any `plate_*` doc read/write; delete admin-only.
  The `plate_*` clause deliberately allows guest checkout without auth.

## tokenTransactions

- **Purpose:** append-only credit ledger + the trigger source for credit emails.
- **ID:** auto.
- **Writer:** client may create **any type except `'use'`**; server writes `use`,
  `adjustment`, `lateFee`, `extension` rows (bypassing rules via admin SDK).
- **Shape:**
  - `customerId` uid|null · `licensePlate` normalised|null
  - `type` `'purchase' | 'use' | 'checkout' | 'refund' | 'adjustment' | 'lateFee' | 'extension'`
  - `quantity` number (signed: `use` = `-1`, `adjustment` = `-removed`)
  - `amount` RON (for `purchase` / `lateFee` / `extension`) · `packId` string|null
  - `spotId` / `bookingId` string|null
  - `timestamp` ISO · `source` (`'netopia' | 'admin-cash' | 'admin-gift' | 'manual' | 'walk-in' | 'gift-voucher' | 'overstay' | 'reprice' | 'admin-adjust'`)
  - `paidBy` · `grantedBy` uid|null · `billing` object · `voucherCode` (gift redemptions)
  - Idempotency: `emailSentAt`, `adminNotifiedAt`
- **Access:** staff read all; customer reads own (`customerId`). No update/delete.
- **Index:** composite `(customerId ASC, timestamp DESC)`.
- Clients are blocked from writing `use` rows specifically so they can't spam the
  `credit-used` email trigger.

## pendingOrders

- **Purpose:** order staging between "start payment" and fulfilment. The IPN
  callback replays online orders; `adminMarkOrderPaid` replays pay-at-pickup.
- **ID:** `ord_{Date.now()}_{rand}` (e.g. `ord_1720000000000_a1b2c3`).
- **Writer:** **server-only** (all client writes denied by rules).
- **Shape:** carries the whole submitted order body plus:
  - `orderType` `'credits' | 'longTerm'`
  - `customerData` `{ customerId, licensePlate, name, email, phone, billing, passengers?, flightNumberDropoff?, flightNumberPickup? }`
  - credits: `packId`, `quantity`; longTerm: `startDate/endDate`, `dropoffAt/pickupAt`, `days`, `totalPrice`
  - `amount` RON (authoritative, method-correct: online = discounted − voucher, pickup = standard − voucher)
  - `voucherId` / `voucherAmount` / `promoVoucherCode` / `voucherDaysUsed`
  - `paymentMethod` `'online' | 'pay-at-pickup'` · `paymentStatus` `'unpaid' | 'paid' | 'refund-pending' | 'refunded'`
  - `status` `'pending' | 'paid' | 'cancelled' | 'expired' | <netopia action>`
  - `paidAt` / `paidBy` / `bookingId` / `balanceDocId` (set on fulfilment)
  - `netopiaAction` / `netopiaErrorCode` · repay: `repayInProgress`, `repayAmount`, `repayStartedAt`
  - `collectedByUid`, `payerDetails`, `reversedAt/By`, `cancelledAt/By`, `expiredAt`
- **Access:** **public read by orderId** (the `/booking/return` poller); writes denied to all clients.
- **Index:** composite `(paymentStatus ASC, createdAt ASC)`.

## activeCheckIns

- **Purpose:** real-time "cars currently in the lot" tracker; blocks double check-in.
- **ID:** normalised license plate (spaces + hyphens stripped).
- **Writer:** staff (client) and server (walk-in / credit check-in callables).
- **Shape:** `licensePlate`, `balanceDocId`|null, `bookingId`, `spotId`|null,
  `customerId`|null, `type` (`'longTerm'` for walk-in bookings), `checkinTime` (ISO),
  `source` (`'walk-in' | 'manual'`), `reminderCommuterSentAt` (idempotency marker).
- **Access:** staff read/write only.
- Must be deleted with the **exact** normalised plate at check-out/cancel or the
  row goes stale and blocks the plate forever.

## cashEntries

- **Purpose:** per-payment cash-drawer ledger powering `/admin/cashbook`. **Cash
  only** — card payments never enter the cashbook.
- **ID:** auto.
- **Writer:** **server-only** (`recordCashEntry` helper; `closeCashbook` flips closed fields).
- **Shape:** `agentUid`, `agentName`, `amount` RON, `paidBy: 'cash'`, `paidAt` ISO,
  `paidAtDay` (`YYYY-MM-DD`), `source` (`'credits-markpaid' | 'longterm-markpaid' |
  'credits-direct' | 'longterm-direct' | 'longterm-extension' | 'overstay'`), `plate`,
  `payerName`, `bookingId`, `orderId`, `tokenBalanceDocId`, `closedAt`/`closedBy`/`closedReportId`.
- **Access:** admin reads all; agent reads own (`agentUid == uid`). No client writes.
- **Index:** composite `(agentUid ASC, closedAt ASC)`.

## cashbookReports

- **Purpose:** immutable snapshot generated when an agent closes their open cash entries.
- **ID:** auto.
- **Writer:** **server-only** (`closeCashbook`).
- **Shape:** `agentUid`, `agentName`, `generatedAt`, `generatedBy`, `rangeFromIso`,
  `rangeToIso`, `totalAmount`, `entryCount`, `entries[]` (flattened snapshots), `handovers[]`.
- **Access:** admin all; agent own. Immutable.
- **Index:** composite `(agentUid ASC, generatedAt DESC)`.

## cashHandovers

- **Purpose:** logbook of agent-to-manager cash handovers (no double-entry / no reversal beyond delete).
- **ID:** auto (one per `(forAgentUid, day)`, enforced server-side).
- **Writer:** **server-only** (`recordCashHandover` / `cancelCashHandover`).
- **Shape:** `day` (`YYYY-MM-DD`), `amount` RON, `handedTo` (manager name), `notes`|null,
  `forAgentUid` (cash owner), `handedBy` (actual actor), `handedAt` ISO.
- **Access:** agent read (drivers excluded — they don't handle money). No client writes.
- **Index:** composite `(forAgentUid ASC, day ASC)`.

## transfers

- **Purpose:** door-to-airport private transfer reservations recorded by staff.
  **No money fields** (`price` is a free-text note), so client-written like reviews.
- **ID:** auto.
- **Writer:** staff (client), gated by rules.
- **Shape:** `contactName`, `phone`, `email`, `pickupAddress`, `pickupAt` ISO,
  `transferType` `'oneway' | 'roundtrip'`, `flightNumber`, `adults` (≥1), `children`,
  `infantsInArms`, `holdLuggage`, `cabinLuggage`, `returnAt`, `returnFlightNumber`,
  `returnTo`, `price` (free text), `groupNotes`, `status` / `returnStatus`
  (`'scheduled' | 'completed' | 'cancelled'` per leg), `createdBy`.
- **Access:** any staff read/create/update; delete restricted to admin/agent (drivers can't delete).

## promoVouchers

- **Purpose:** admin-managed discount / gift codes entered at checkout.
- **ID:** the uppercased code (`BLACK50`) — doc-ID collision enforces uniqueness.
- **Writer:** admin (client). `redeemedCount` + assignment mutated server-side.
- **Shape:** `code`, `name`, `active` bool, `type` `'fixed' | 'percent' | 'days' | 'credits'`,
  `value` (RON for fixed / 1–100 for percent / free days / credits granted), `startDate`
  / `endDate` (`YYYY-MM-DD` inclusive), `visibility` `'public' | 'private'`,
  `assignedUserIds[]` (required for private), `maxRedemptionsTotal` null|number,
  `redeemedCount` (server-incremented), `description`, `featured` bool,
  `voucherEmailSentTo[]` (idempotency), `createdBy/At`, `updatedAt`.
- **Access:** public vouchers anonymously readable; admin reads all; private vouchers
  readable only by an assigned uid. Admin-only writes.
- `credits`-type vouchers are gift cards redeemed standalone (`redeemCreditVoucher`),
  not a checkout discount; `resolveVoucher` refuses them at checkout with `gift-only`.

## voucherRedemptions

- **Purpose:** redemption ledger — enforces one-per-identity for fixed/percent and
  records every days/credits redemption.
- **ID:** deterministic `${CODE}_${identityKey}` for one-shot (fixed/percent/credits),
  or auto for splittable days redemptions. `identityKey` is `uid:{uid}` or `plate:{PLATE}`.
- **Writer:** **server-only** (`createPayment` transaction, `redeemCreditVoucher`).
- **Shape:** `voucherCode`, `identityKey`, `userId`, `plate`, `orderId`, `bookingId`
  (patched on fulfilment), `amount` RON, `type`, `value`, `daysUsed`, `creditsGranted`, `redeemedAt`.
- **Access:** staff read + owning user (`userId`) read own. No client writes.

## voucherDayBalances

- **Purpose:** per-identity remaining-days balance for **splittable** days vouchers
  (a 7-day voucher spent across several bookings).
- **ID:** `${CODE}_${identityKey}`.
- **Writer:** **server-only** (transactional in `createPayment`).
- **Shape:** `voucherCode`, `identityKey`, `daysUsed` (cumulative), `updatedAt`.
- **Access:** staff read only. No client writes.

## vouchers (legacy signup bonus)

- **Purpose:** the old one-per-account 20-RON signup-incentive voucher. Not issued
  to new signups but honoured for in-flight balances.
- **ID:** `{uid}` — the doc-ID == uid enforces one voucher per account.
- **Writer:** client may **create only** with `amount == 20`, `source == 'signup-incentive'`,
  `status == 'unused'`, `userId == uid`. The IPN callback (admin SDK) flips `status` to `'redeemed'`.
- **Shape:** `userId`, `amount` (20), `currency` `'RON'`, `status` `'unused' | 'redeemed' | 'expired'`,
  `source` `'signup-incentive'`, `createdAt`, `redeemedAt`, `redeemedOn` (orderId).
- **Access:** owner + admin read; client create-only; no update/delete.

## reviews

- **Purpose:** admin-curated customer reviews shown on the homepage.
- **ID:** auto.
- **Writer:** admin (client).
- **Shape:** `name`, `rating` (1–5), `comment`, `date` (`YYYY-MM-DD`), `photoUrl`|null,
  `published` bool, `sortOrder` number, `type` `'traveler' | 'commuter'`.
- **Access:** public read; admin write.

## tokenPacks

- **Purpose:** buyable credit packs (config surface). Authoritative for credit pricing —
  `computeAuthoritativePackPrice` re-derives the charge from this doc.
- **ID:** auto (`packId`).
- **Writer:** admin (client).
- **Shape:** `price` RON, `quantity` (credits granted), `active` bool, `sortOrder`,
  plus display fields (name/label). `active === false` hides it and blocks purchase.
- **Access:** public read; admin write.

## pricingTiers

- **Purpose:** long-term per-day tier table used by `pricingService.calculatePrice`
  for **display**. Shape `{ type, minDays, maxDays, pricePerDay, order }`.
- **ID:** auto (or seeded `tier-N`).
- **Writer:** admin (client).
- **Access:** public read; admin write.
- ⚠️ **Not the authoritative long-term pricer.** `createPayment` prices from
  `settings/longTermRates` (`perDay`, not `pricePerDay`) + `seasonalPricing`. Keep the
  two in step, or treat `pricingTiers` as the informational/marketing table.

## addOns

- **Purpose:** optional booking add-ons (car wash, covered spot, EV charging).
- **ID:** auto (or seeded `addon-*`).
- **Writer:** admin (client).
- **Shape:** `name`, `nameRo`, `price` RON, `type` `'one_time' | 'per_day'`.
- **Access:** public read; admin write.

## seasonalPricing

- **Purpose:** admin-defined date windows that override the default long-term tiers.
- **ID:** auto.
- **Writer:** admin (client). Read server-side by `computeAuthoritativeLongTermTotal`.
- **Shape:** `name`, `startDate` / `endDate` (`YYYY-MM-DD` inclusive), `active` bool,
  `tiers` array of `{ minDays, maxDays|null, perDay }`, `createdAt/updatedAt/updatedBy`.
- **Rules of the game:** the **pick-up day** picks the period for the whole booking;
  each period carries its own full tier table; overlapping active periods rejected at save.
- **Access:** public read (booking page applies client-side); admin write.

## settings

Keyed config docs (public read, admin write). Money-relevant docs are also read
server-side.

- **`settings/global`** — `onlineDiscountPercent` (default 10), `openingHours`
  (`{ mon..sun: { open, close, closed } }` — front-desk hours, not the 24/7 lot),
  `occupiedSpots` / `totalCapacity` (legacy counter, superseded by aggregating `spots`),
  `commuterMonthlyRate`.
- **`settings/longTermRates`** — **authoritative** long-term pricing:
  `{ tiers: [{ minDays, maxDays|null, perDay }] }`.
- **`settings/commuterPolicy`** — `{ latePickupDailyRate }` (overstay daily rate).
- **Access:** public read; admin write.

## spots

- **Purpose:** per-spot occupancy — the single source of truth for capacity
  (aggregated client-side; the `settings/global.occupiedSpots` counter can drift).
- **ID:** auto (or seeded spot id).
- **Writer:** staff (client) + server (spot reservation/occupancy during fulfilment).
- **Shape:** `status` `'available' | 'occupied' | 'reserved' | 'maintenance'`,
  `currentBookingId` string|null (+ zone/label display fields).
- **Access:** public read; staff write.

## auditLog

- **Purpose:** immutable admin/staff action trail.
- **ID:** auto.
- **Writer:** any authenticated create; server writes many rows. No update/delete.
- **Shape:** two overlapping shapes — client (`auditService.auditLog`) writes
  `action`, `entityType`, `entityId`, `oldValue`, `newValue`, `userId`, `userEmail`,
  `timestamp`; server writes `action`, `entityType`, `entityId`, `actorUid`,
  `payload`, `timestamp`.
- **Access:** staff read; append-only.
- **Index:** composite `(entityType ASC, timestamp DESC)`.

## contactMessages

- **Purpose:** contact-form submissions (homepage + `/contact`). Trigger emails rezervari@.
- **ID:** auto.
- **Writer:** public create; staff read/update; admin delete.
- **Shape:** `name`, `email`, `subject`, `message`, `status` `'new'`, `notifiedAt` (idempotency).
- **Access:** public create; staff read.

## galleryImages

- **Purpose:** homepage "Our facility" photos (files live in Storage under `gallery/`).
- **ID:** auto.
- **Writer:** admin (client).
- **Shape:** `url` (public download URL), `path` (Storage path, kept for deletes),
  `caption`, `sortOrder`.
- **Access:** public read; admin write.

## siteContent

- **Purpose:** CMS bodies for admin-editable marketing pages (currently only `promotions`).
- **ID:** slug (`promotions`).
- **Writer:** admin (client).
- **Shape (`promotions`):** `heroImage`, `ro`/`en` `{ title, intro, body }` (body is
  Quill HTML; legacy markdown auto-upgraded on render), `updatedAt`.
- **Access:** public read; admin write.

## legalPages

- **Purpose:** CMS bodies for the ANPC/Netopia legal routes; falls back to shipped i18n defaults.
- **ID:** slug ∈ `['terms','privacy','gdpr','delivery','cancellation']`.
- **Writer:** admin (client).
- **Shape:** `slug`, `ro`/`en` `{ title, intro, sections:[{heading,body}], lastUpdatedISO }`, `updatedAt`.
- **Access:** public read; admin write.

## shuttleSchedule / trainSchedule

- **Purpose:** departure schedules shown on `/shuttle` (mock fallbacks exist in code).
- **ID:** auto.
- **Writer:** staff (client).
- **Shape (shuttle):** `route` (`parking_to_airport` etc.), `departureTime` (`HH:MM`),
  `dayOfWeek` (`all` | `weekday`), `status` (`scheduled` | `cancelled`).
- **Shape (train):** `direction` (`to_bucharest` / `from_bucharest`), `departureTime` (`HH:MM`).
- **Access:** public read; staff write.

## pendingInvites

- **Purpose:** stashes the assigned role/name for a magic-link invite until the
  invitee completes signup.
- **ID:** `email` (lowercased).
- **Writer:** **server-only** (`adminSendInvite` creates, `finishInviteSignup` deletes;
  `onUserCreated` reads it to suppress the double welcome email).
- **Shape:** `email`, `displayName`, `role`, `invitedBy`, `invitedAt`, `locale`.
- **Access:** all client read/write denied (admin SDK only).

## lookupCache

- **Purpose:** 24h cache of ANAF CUI → company-record lookups (dodges CORS + rate limits).
- **ID:** `cui_{NORMALIZED_CUI}` (e.g. `cui_14186770`).
- **Writer:** **server-only** (`lookupCui` callable).
- **Shape:** `payload` `{ companyName, address, regCom, vatPayer, cui }`, `cachedAt`, `expiresAt`.
- **Access:** all client read/write denied (admin SDK only).

## flightStatusCache

- **Purpose:** 15-min cache of flight-status lookups so the admin board doesn't re-bill
  the flight API. Feature is **dormant** until a provider key is configured.
- **ID:** `{provider}_{FLIGHTNO}_{DATE}` (e.g. `aerodatabox_RO371_2026-07-09`).
- **Writer:** **server-only** (`lookupFlightStatuses` callable).
- **Shape:** `status` (normalized `{ found, cancelled, diverted, status, departureDelayMinutes,
  arrivalDelayMinutes, departureScheduled, arrivalScheduled }` — cached hits *and* misses),
  `fetchedAt` ISO.
- **Access:** not covered by an explicit rule (default-deny to clients); admin SDK only.

## subscriptions (hidden)

- **Purpose:** monthly-subscription commuter product — code preserved, routes commented out.
- **ID:** auto.
- **Writer:** authenticated client create; staff/owner update; admin delete.
- **Access:** staff read all; customer reads own (`customerId`).

---

## Recently added fields

- **`bookings.passengers`** (1–10) — number of people travelling, for the shuttle.
  Sanitised server-side (`sanitizePassengers`); older bookings stay unset (null).
- **`bookings.flightNumberDropoff` / `bookings.flightNumberPickup`** — optional flight
  numbers (departure / return). Sanitised (`sanitizeFlight`: upper-cased, collapsed,
  ≤12 chars); feed the (dormant) `lookupFlightStatuses` flow. Also carried on
  `pendingOrders.customerData`.
- **`promoVouchers.featured`** — admin toggle to feature one voucher on the promotions page.
- **`promoVouchers` type `'credits'`** (v1.10) — gift-card vouchers redeemed via
  `redeemCreditVoucher`, plus the `credit-voucher-assigned` email template.
