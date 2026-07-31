# Cloud Functions

> Status: ✅ Shipped · Last verified: 2026-07-31

All functions are **Gen 2, Node 22, region `europe-west1`** (`setGlobalOptions`
in `functions/src/index.js:97`, `maxInstances: 10`). Secrets bind via
`firebase functions:secrets:set` and are declared with `defineSecret`:
`NETOPIA_SIGNATURE`, `NETOPIA_PUBLIC_KEY`, `NETOPIA_PRIVATE_KEY`, `NETOPIA_ENV`,
`NETOPIA_API_KEY` [reserved], `BREVO_API_KEY`, the SmartBill trio
(`SMARTBILL_USERNAME` / `SMARTBILL_TOKEN` / `SMARTBILL_CIF`, grouped as
`SMARTBILL_SECRETS` in `smartbill.js:23`) and the ParkVia pair
(`PARKVIA_SUBSCRIPTION_KEY` / `PARKVIA_OPERATOR_KEY`, `PARKVIA_SECRETS`).
Deploy with `cd functions && firebase deploy --only functions` (Blaze plan
required).

> **Line numbers** below were re-verified 2026-07-31 against `index.js` (5,394
> lines). They drift with every edit — grep the symbol rather than jumping to
> the line if a reference looks wrong.

Sibling docs: [data-model.md](./data-model.md) · [security-rules.md](./security-rules.md).

## Auth gates (`functions/src/index.js`)

Roles: **admin > agent** (legacy `staff`) **> driver > customer**. Each gate reads
`users/{uid}.role`.

| Helper | Line | Accepts |
|---|---|---|
| `assertStaff` | 1768 | admin, agent, staff, driver — on-lot ops (check-in/out) |
| `assertAgent` | 1781 | admin, agent, staff — money-bearing ops (drivers excluded) |
| `assertAdmin` | 4329 | admin only — config/user management |

`onCall` functions receive `request.auth` from the Firebase SDK; the two `onRequest`
payment endpoints verify a Bearer ID token manually (only to gate vouchers) and are
otherwise public.

---

## HTTP endpoints (`onRequest`)

### `createPayment` — `index.js:697`
- **Trigger:** `POST` (CORS on). Body: `{ orderType:'credits'|'longTerm', customerData, ... }`.
  Optional `Authorization: Bearer <idToken>` to apply a voucher.
- **Does:** the payment entrypoint. **Server-authoritatively re-prices** the order
  (`computeAuthoritativeLongTermTotal` / `computeAuthoritativePackPrice`) and rejects any
  tampered `totalPrice`/`packPrice` (0-RON tolerance). Applies the online-discount, then
  resolves + atomically redeems a voucher (`resolveVoucher`), writes `pendingOrders/{orderId}`
  from an **explicit field whitelist** (sanitized `customerData`/billing, authoritative day
  count) — the raw body is never spread into the order, so server-owned fields like
  `bookingId`/`repayAmount` cannot be injected by the caller.
  Branches: **online** → returns an encrypted Netopia handoff envelope; **pay-at-pickup**
  → creates the longTerm booking now (unpaid) and returns a `redirectUrl`; **free order**
  (days voucher covers 100%) → fulfils immediately (`paidBy:'voucher'`) and returns `{ free:true }`.
- **Auth:** public (Bearer token optional, verified for vouchers only).
- **Outputs:** `{ action, env_key, data, cipher, iv, orderId }` (online) · `{ orderId,
  paymentMethod, redirectUrl }` (pickup) · `{ orderId, free, redirectUrl }` (free).
- **Writes:** `pendingOrders`, `voucherRedemptions` + `promoVouchers.redeemedCount` +
  `voucherDayBalances` (tx), and on free/pickup path `bookings`, `spots`, `users.billing`.
- **Secrets:** `NETOPIA_SIGNATURE`, `NETOPIA_PUBLIC_KEY`, `NETOPIA_ENV`.

### `netopiaCallback` — `index.js:1143`
- **Trigger:** `POST` server-to-server IPN from Netopia (CORS off). Form fields:
  `env_key, data, cipher, iv`.
- **Does:** decrypts the envelope with the merchant private key, parses the XML. On
  `action ∈ {confirmed, paid}` with `error_code 0` it fulfils: credits tokens
  (`creditTokens`) for credit orders, or creates/patches the longTerm booking (handling the
  repay case where the booking pre-exists), reserves a spot, consumes the legacy signup
  voucher, and flips `pendingOrders.status='paid'`. **Idempotent** (short-circuits when the
  order is already `paid`). Non-success outcomes are recorded but still ack'd to stop retries.
  This is the **only** place online orders become paid.
- **Auth:** public (authenticity from the encrypted envelope, not auth headers).
- **Outputs:** `<crc>success</crc>` or `<crc error_type=... error_code=...>` XML.
- **Writes:** `pendingOrders`, `tokenBalances`, `tokenTransactions`, `bookings`, `spots`,
  `vouchers`, `voucherRedemptions`. May send `sendRepayPaidEmail`.
- **Secrets:** `NETOPIA_PRIVATE_KEY`. Callback URL is a fixed Cloud Run hostname
  (`CALLBACK_URL`, overridable via `NETOPIA_CALLBACK_URL`).

### `repayOrder` — `index.js:5303`
- **Trigger:** `POST` (CORS on). Body: `{ orderId }`. No auth — the orderId (from the
  confirmation email) is the secret.
- **Does:** self-service repay for an unpaid pay-at-pickup order. Recomputes the online-discounted
  amount, stamps `repayInProgress`/`repayAmount`, and returns a fresh Netopia handoff for the
  **same** orderId (the IPN then patches the existing booking rather than duplicating it).
- **Outputs:** `{ action, env_key, data, cipher, iv, orderId }` · errors `already_paid` (409),
  `not_repayable`, `bad_amount`.
- **Writes:** `pendingOrders`. **Secrets:** `NETOPIA_SIGNATURE`, `NETOPIA_PUBLIC_KEY`, `NETOPIA_ENV`.

---

## Callables (`onCall`)

Unless noted, callables are region `europe-west1`, CORS on, and throw `HttpsError` on
failure. "Idempotent" means a repeat call is a safe no-op.

### Orders & fulfilment
| Fn | Line | Auth | Does / side effects |
|---|---|---|---|
| `mergeGuestData` | 1446 | authed + **verified email** | Merges guest `plate_*` balances, transactions, and email-matched bookings into the user's uid; patches `users` vehicles/contact. Idempotent, email-scoped, **case-insensitive** (legacy docs stored emails as typed: bookings are matched via a `customerId == null` scan, plate balances via a `plate_*` doc-id range scan). Called from Login, Register **and FinishSignup** (invite completion). Returns zero counts until `email_verified` (unverified password accounts merge on first login after verification). Harvests plates for `users.vehicles` from **both** credit balances and bookings — including bookings already linked to the uid, so an existing profile fills in its plates on the next login without a migration. |
| `adminMarkOrderPaid` | 1800 | `assertStaff` | Flips a pay-at-pickup `pendingOrders` doc to paid; credits tokens (credits) or creates/patches + spot-reserves the booking (longTerm); records a **cash** `cashEntries` row (cash only); audit-logs. Idempotent. Requires `paidBy ∈ {cash,card}` + `payerDetails`. |
| `adminMarkOrderUnpaid` | 1948 | `assertStaff` | Misclick reversal of an admin cash/card mark-paid (refuses Netopia-paid). Releases the spot / claws back tokens (only if unused), deletes the **open** cash entry, audit-logs. |
| `cancelPendingCreditOrder` | 2088 | authed (owner or staff) | Customer self-cancel of an **unpaid** pay-at-pickup credit order. Refuses paid orders. |

### Cashbook
| Fn | Line | Auth | Does / side effects |
|---|---|---|---|
| `closeCashbook` | 2163 | `assertStaff` (no drivers) | Snapshots the caller's (or, admin-only, another agent's) open `cashEntries` into a `cashbookReports` doc, marks entries closed, folds in matching `cashHandovers`, audit-logs. |
| `recordCashHandover` | 2280 | `assertStaff` | Records one `cashHandovers` row (one per agent+day; admin may record for another agent). Audit-logs. |
| `cancelCashHandover` | 2345 | `assertStaff` (owner/admin) | Hard-deletes a handover; audit-logs. |

### Bookings, refunds & repricing
| Fn | Line | Auth | Does / side effects |
|---|---|---|---|
| `cancelBookingWithRefund` | 2392 | authed (owner) or `assertAgent` (staff) | Cancels an upcoming/active longTerm booking. Routes paid bookings to `refund-pending` (Netopia or cash), releases spot + `activeCheckIns`, mirrors onto `pendingOrders`, audit-logs, and **emails the customer a cancellation confirmation** (`sendBookingCancelledEmail`, best-effort — includes a "refund on its way" note when one was queued). Auto-routes to **no-show** (forfeit) when drop-off is >12h past and never arrived — the no-show path sends no email but **reports ParkVia-imported bookings back to ParkVia** (`reportParkviaNoShowSafe`). Binds `BREVO_API_KEY` + ParkVia secrets. |
| `adminMarkRefunded` | 2620 | `assertStaff` | `refund-pending` → `refunded`; stamps `refundedVia`, mirrors onto pendingOrders, audit-logs, sends the customer refund email. Idempotent. Secret: `BREVO_API_KEY`. |
| `adminResendRefundEmail` | 2901 | `assertStaff` | Re-sends the refund email for an already-refunded booking. Secret: `BREVO_API_KEY`. |
| `adminResendConfirmationEmail` | 2942 | `assertStaff` | Re-sends the longTerm confirmation email for an `upcoming` booking (reflects current paid state). Secret: `BREVO_API_KEY`. |
| `adminCreateLongtermBooking` | 3045 | `assertStaff` | Desk-created longTerm booking (cash/card/broker/pay-later) bypassing Netopia. Creates a paid (or pay-later + pendingOrder) booking, reserves a spot, records cash (cash only), optionally auto-checks-in (walk-in), audit-logs. When the UI didn't match a customer, resolves the (lowercased) payer email against Firebase Auth and stamps `customerId` if an account exists — so the reservation appears in that customer's profile. |
| `adminChargeOverstay` | 3788 | `assertAgent` | Adds a late-pickup charge to `latePrice`; writes a `lateFee` ledger row; records cash (cash only); audit-logs. |
| `previewBookingReprice` | 3875 | `assertStaff` | Read-only re-price of a longTerm booking to new dates; returns `{ days, perDay, newTotal, oldTotal, difference, paid }`. No writes. |
| `adminRepriceBooking` | 3923 | `assertAgent` | Moves a booking's dates and re-prices. Unpaid → re-quote (keeps pendingOrder in sync) **+ auto-emails the client the new total when it changed** (`sendBookingRequoteEmail`, best-effort, `emailed` in the response). Paid extension → collect the diff at the desk (`cash`/`card`) into `extensionPrice` + `extension` ledger row, **or `email` the client a payment request** (see below); shortening → `pendingRefundAmount`. Audit-logs. Binds `BREVO_API_KEY`. |
| `adminResolvePendingRefund` | 4234 | `assertAgent` | Clears a reprice-shortening partial refund on a booking (money movement is manual). Audit-logs. |

### Credits & vouchers
| Fn | Line | Auth | Does / side effects |
|---|---|---|---|
| `grantCreditsForCash` | 3307 | `assertStaff` | Grants credits to a plate/customer after collecting cash/card (`source='admin-cash'`); records cash (cash only); optional walk-in auto-check-in (decrement + `activeCheckIns` + credit booking); audit-logs. |
| `adminGrantCredits` | 3465 | `assertAgent` | Gifts free credits to a registered user (`paidBy='gift'`, no cash). Audit-logs. |
| `adminDeductCredits` | 3519 | `assertAgent` | Removes credits (floored at 0, transactional); writes an `adjustment` ledger row (no email); audit-logs. |
| `validateVoucherCode` | 2700 | public (uid optional) | Stateless preview of voucher eligibility/discount (`resolveVoucher`). No redemption. |
| `redeemCreditVoucher` | 2734 | public (uid optional) | Standalone redemption of a `credits` gift voucher — grants free credits to the holder's balance (one per identity, transactional), writes a `purchase` ledger row + `voucherRedemptions`, audit-logs. |
| `adminAssignVoucher` | 3578 | `assertAdmin` | Assigns/unassigns a private voucher to a user (`assignedUserIds` arrayUnion/Remove). Assigning re-fires the `onPromoVoucherAssigned` email. Audit-logs. |

### On-lot check-in
| Fn | Line | Auth | Does / side effects |
|---|---|---|---|
| `checkInWithCredits` | 3660 | `assertStaff` | Commuter check-in consuming **existing** credits (transactional decrement); assigns a spot, writes `activeCheckIns` + a credit `bookings` doc + a `use` ledger row; audit-logs. Errors: `NO_BALANCE`, `ALREADY_CHECKED_IN`, `INSUFFICIENT_CREDITS`. |

### Users, invites & auth
| Fn | Line | Auth | Does / side effects |
|---|---|---|---|
| `requestPasswordReset` | 4278 | public | Mints a Firebase password-reset link and sends the branded Brevo email; alerts staff (only fires for real accounts — never leaks existence). Secret: `BREVO_API_KEY`. |
| `adminCreateUser` | 4957 | `assertAdmin` | Creates an Auth user + `users/{uid}` doc with a chosen role. Audit-logs. |
| `adminDeleteUser` | 5014 | `assertAdmin` | Deletes the Auth user + `users` doc (historical data left intact). Guards: can't delete self or the last admin. Audit-logs. |
| `adminChangeUserRole` | 5065 | `assertAdmin` | Changes another user's role. Guards: not self, not the last admin. Audit-logs. |
| `adminUpdateUserProfile` | 5117 | `assertAgent` | Edits a customer's displayName/phone/billing/vehicles (never role/email). Audit-logs. |
| `adminSendInvite` | 5170 | `assertAdmin` | Magic-link signup invite: mints the link, stashes role in `pendingInvites`, sends the `admin-invite` email, audit-logs. Secret: `BREVO_API_KEY`. |
| `finishInviteSignup` | 5243 | authed | After the magic-link handshake, stamps `users/{uid}` with the invited role/name and deletes the `pendingInvites` doc. Idempotent. |

### External lookups (re-exported)
| Fn | File | Auth | Does |
|---|---|---|---|
| `lookupCui` | `cui.js:58` | public | ANAF CUI → company record, with a 24h `lookupCache` cache. Uses raw `https` (forced HTTP/1.1 + relaxed TLS) because ANAF resets `fetch`. |
| `lookupFlightStatuses` | `flightStatus.js:141` | `assertStaff` | Batch flight-status lookup with a 15-min `flightStatusCache`. **Dormant** — returns `{ configured:false }` until `FLIGHT_API_KEY`/`FLIGHT_API_PROVIDER` are set. Providers: `aerodatabox`, `aviationstack`. |
| `smartbillHealthcheck` | `index.js:4359` (helpers in `smartbill.js`) | `assertAdmin` | Lists invoice + proforma series and taxes; `ready` requires the pinned `Mango` (type f) / `MANGO` (type p) series plus 21% VAT. See [../roadmap/v.1.2_smartbill.md](../roadmap/v.1.2_smartbill.md). |
| `smartbillTestIssue` | `index.js:4413` | `assertAdmin` | Payload checkpoint: issues + deletes a PF proforma, a PJ proforma and a draft fiscal invoice. Number-less draft strays are flagged `STRAY` (delete manually: Facturi → Ciorne). |

**SmartBill issuance on the paid flows (v1.2 Phase 2)** — via `smartbillIssueSafe`
in `index.js` (never throws: a SmartBill failure stamps `smartbill.status='failed'`
+ `lastError`; the money flow always completes). `createPayment` issues a
**proforma** on every order (skipped when a voucher covers the full amount);
`netopiaCallback` issues the **fiscal invoice** on IPN success (new bookings,
repays, credit packs); `adminCreateLongtermBooking` (non-broker) and
`grantCreditsForCash` issue proformas for desk sales. Pay-at-location fiscal
invoices stay **manual** in the SmartBill UI (locked decision) —
`adminMarkOrderPaid` issues nothing. Outcomes land under
`smartbill.{proforma,invoice,status,lastError}` on `pendingOrders` / `bookings` /
`tokenTransactions`; the field is server-written only (rules reject client writes).

**SmartBill documents are NOT surfaced** (client decision 2026-07-17) — no UI
links, no email links, no PDF proxy: customers don't need the documents and
staff consult SmartBill directly. (A brief Phase 5/6 implementation was
reverted; see the roadmap doc for what existed.)

**SmartBill invalidation (v1.2 Phase 4)** — `smartbillDeleteProformaSafe` +
`smartbillCancelInvoiceSafe` (index.js): every cancel path drops the non-fiscal
proforma (`smartbill.proformaDeleted`); an auto-issued invoice gets a **storno,
always** — client decision, no anulare even same-day — via `/invoice/reverse`
(stored under `smartbill.storno`, incl. SmartBill's public `documentViewUrl`).
Wired into
`cancelBookingWithRefund` (+ its no-show branch, unpaid only — paid no-shows
forfeit and keep their invoice), `cancelPendingCreditOrder`, and the scheduled
`markNoShows` / `expireStaleHolds`. Reprice (4b): `adminRepriceBooking` unpaid
re-quote replaces the proforma; paid extension and `adminChargeOverstay` append
a difference proforma (`smartbill.extraProformas`); paid shortening appends a
**partial storno** (negative-line invoice, `smartbill.partialStornos`) when the
original was auto-issued. Statuses: `cancelled` | `storno` | `cancel-failed`.

**Extension "email the client" flow** — a paid booking extended via
`adminRepriceBooking` with `paidBy:'email'` applies the new dates immediately,
tracks the owed difference on the booking (`extensionOwed` + `extensionOrderId`),
and creates a **`pendingOrders` doc with `kind:'extension'`, `extensionOf:<bookingId>`,
`paymentMethod:'pay-at-pickup'`** (so `repayOrder`/IPN engage) for the difference,
plus a proforma and a `booking-repriced` email offering pay-online (discounted, via
`/pay?orderId=`) or pay-at-arrival. Both settle paths route through the shared
**`applyExtensionSettlement(bookingRef, booking, order, {chargedAmount, paidBy, via})`**
(index.js): the IPN (`netopiaCallback`, extension branch before `isRepay`) settles at
the online-discounted `repayAmount` and issues a fiscal invoice for the difference
(`smartbill.extraInvoices`); `adminMarkOrderPaid` (extension branch) settles at the
standard amount (cash → cashbook `longterm-extension`). Neither re-marks the booking
paid / reserves a spot / rewrites `totalPrice` — it only accrues `extensionPrice` +
an `extension` ledger row and clears the owed flags (idempotent). Re-extending
supersedes the prior pending request (carries its owed forward, one live pay link);
shortening while a request is outstanding is blocked; cancelling the booking cancels
the extension order + drops its proforma.

---

## Firestore triggers

Customer-facing Brevo-template emails (`functions/src/emails.js`) and internal ops
alerts (`functions/src/adminNotifications.js`). All are `europe-west1`, secret `BREVO_API_KEY`,
and **swallow errors** (a failed email never retry-loops a customer flow). Each claims a
one-shot marker field to survive double-firing v2 triggers.

### Customer emails — `emails.js`
| Trigger | Line | On | Sends |
|---|---|---|---|
| `onUserCreated` | 136 | `users/{uid}` create | `signup-welcome` (skipped if a `pendingInvites` doc exists — invite path). Claim: `welcomeEmailSentAt`. |
| `onBookingCreated` | 187 | `bookings/{id}` create | `booking-longterm-confirm` (longTerm only; branches paid vs pay-at-pickup nudge). Claim: `confirmEmailSentAt`. |
| `onTokenTransactionCreated` | 570 | `tokenTransactions/{id}` create | `credit-purchase` (type `purchase`); `credit-used` + one-shot `low-credit-warning` when crossing 2 credits (type `use`). Claim: `emailSentAt`. |
| `onContactMessageCreated` | 702 | `contactMessages/{id}` create | Raw HTML alert to rezervari@ (`sendBrevoRaw`), Reply-To = customer. Claim: `notifiedAt`. |
| `onPromoVoucherAssigned` | 795 | `promoVouchers/{code}` write | For newly-assigned **private** vouchers: `voucher-assigned` (or `credit-voucher-assigned` for gift vouchers) to each new assignee. Claim: `voucherEmailSentTo[]`. |

Reusable senders exported from `emails.js`: `sendBookingConfirmationEmail`,
`sendRepayPaidEmail` (called from the IPN), `sendRefundIssuedEmail` (called from
`adminMarkRefunded` / resend).

### Ops alerts to rezervari@ — `adminNotifications.js`
Inline-HTML sends (`sendBrevoRaw`, no Brevo template) — scoped to **customer-initiated**
activity so staff aren't pinged for their own desk actions.
| Trigger | Line | On | Alerts |
|---|---|---|---|
| `adminNotifyUserCreated` | 112 | `users/{uid}` create | New account. Claim: `adminNotifiedAt`. |
| `adminNotifyBookingCreated` | 144 | `bookings/{id}` create | New longTerm reservation (web/walk-in/admin/broker). Claim: `adminNotifiedAt`. |
| `adminNotifyBookingCancelled` | 189 | `bookings/{id}` update | Status change → cancelled / refund-pending / no-show / refunded. Claims: `adminCancelNotifiedAt`, `adminRefundNotifiedAt`. |
| `adminNotifyCreditPurchase` | 251 | `tokenTransactions/{id}` create | Credit purchase (`type='purchase'`). Claim: `adminNotifiedAt`. |

`notifyAdminPasswordReset` (exported, not a trigger) is called from `requestPasswordReset`.

---

## Scheduled jobs (`onSchedule`, `functions/src/scheduled.js`)

All `europe-west1`, timezone `Europe/Bucharest`. Reminder jobs stamp a per-doc marker so a
re-run doesn't double-send. Secret `BREVO_API_KEY` where they email.

| Job | Line | Schedule | Does |
|---|---|---|---|
| `daily24hReminders` | 115 | `0 10 * * *` | Scans upcoming/active longTerm bookings; sends `reminder-checkin-24h` (24h before drop-off) and `reminder-checkout-24h` (24h before pick-up), ±1h window. Markers: `reminderCheckinSentAt`, `reminderCheckoutSentAt`. |
| `commuter7PMCheck` | 213 | `0 19 * * *` | Sends `reminder-commuter-7pm` (1h-before-cutoff nudge) to every commuter still in `activeCheckIns` today. Marker: `reminderCommuterSentAt`. |
| `markNoShows` | 296 | `every 60 minutes` | Flips upcoming longTerm bookings whose drop-off is >12h past with no `activeCheckIns` row → `no-show`; releases the spot; audit-logs; **reports ParkVia-imported bookings back to ParkVia** (`reportParkviaNoShowSafe`, best-effort, once per booking). In-memory drop-off filter (handles `dropoffAt: null` web bookings). Binds SmartBill + ParkVia secrets. |
| `expireStaleHolds` | 389 | `0 2 * * *` | Flips `pendingOrders` still `unpaid` after 14 days → `expired` (housekeeping; doesn't touch the booking). |
| `pollParkviaBookings` | 428 | `every 15 minutes` | **LIVE (2026-07-23)**. Drives `runParkviaSync` (`index.js:4770`+): pulls ParkCloud booking EVENTS over an **overlapping age window** (72h rolling, stretched over poller downtime, 720h max), imports new reservations as broker bookings via `createBrokerBookingCore`, reconciles cancellations/amendments. `lastEventId` is a high-water mark, **not** a cutoff — ParkCloud publishes events out of id order, so a strict `since/{id}` cursor silently lost reservations (fixed 2026-07-29). First run primed the cursor (no historical backfill). Binds `PARKVIA_SECRETS`. See [../features/parkvia.md](../features/parkvia.md). |

**ParkVia auto-import (live)** — `parkviaSyncNow` (`assertStaff` — the button lives on
`/admin/checkins` next to the New-reservation CTA, and on `/admin/pricing`) runs the same
`runParkviaSync` pass on demand; `parkviaHealthcheck` (`assertAdmin`, `/admin/pricing` only)
probes the confirmed `GET /operators` endpoint and verifies operator 15777 is visible.
The finalized XML→booking mapping lives in `functions/src/parkvia.js`
(`mapParkviaBookingToImport`, unit-tested against real captures).

---

## Notes

- **Refunds are manual.** No callable calls a Netopia refund API — `adminMarkRefunded`
  only records that a refund was processed out-of-band (Netopia panel / cash / card terminal).
  The JSON-REST "v2" migration that would automate this is planned, not built
  (see [../roadmap/v.1.4_netopia_v2_migration.md](../roadmap/v.1.4_netopia_v2_migration.md)).
- **SmartBill invoicing is live on the paid flows (Phases 2 + 4)** — proforma on
  every order, fiscal invoice on online payment confirm, **storno on cancel**;
  pay-at-location invoices stay manual in the SmartBill UI. Only the retry queue
  and e-Factura (Phase 7/8) remain planned, and documents are deliberately not
  surfaced in-app (see [../roadmap/v.1.2_smartbill.md](../roadmap/v.1.2_smartbill.md)).
  *(This note previously listed storno as planned, contradicting the Phase 4
  section above it — corrected 2026-07-31.)*
- **IPN replay lease:** `netopiaCallback` claims the order transactionally
  (`pendingOrders.ipnProcessingAt`, 5-min expiry, cleared on success/failure)
  before fulfilment — concurrent or redelivered IPNs can't double-create the
  booking/credits or mint a duplicate SmartBill invoice. SmartBill calls carry
  a hard 10s timeout so a hung request can't stall checkout or the IPN.
- **Netopia crypto:** the envelope build/encrypt/decrypt lives in `functions/src/netopia.js`
  (`NETOPIA_ENDPOINTS`, `encryptRequest`, `decryptIpn`, `buildRequestXml`, `crcSuccess/Error`).
  Sandbox vs live is chosen by `NETOPIA_ENV`.
- **Brevo template IDs** live in `functions/src/emailTemplates.js` (`templateId(name, locale)`,
  RO↔EN fallback). A missing ID makes the send skip gracefully rather than throw.
