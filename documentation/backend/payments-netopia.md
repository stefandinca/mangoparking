# Payments — Netopia Mobilpay

> Status: ✅ Shipped (legacy crypto-envelope flow) · Last verified: 2026-07-09

The online-card payment path runs on Netopia's **legacy mobilpay v1.x stack**: an
RSA + AES-encrypted XML request envelope POSTed to a hosted card page, and an
encrypted XML IPN that confirms the payment server-to-server. It is live and the
only way `pendingOrders` reach `paid` for online payments.

**Refunds are manual** — there is no programmatic refund/void here. Cancellations
route into an admin refund queue and staff process the refund by hand (Netopia
panel for card, cash-back at the lot). The JSON-REST rewrite that would automate
refunds/voids is planned, not built — see
[../roadmap/v.1.4_netopia_v2_migration.md](../roadmap/v.1.4_netopia_v2_migration.md).

Related: [./email-brevo.md](./email-brevo.md) (confirmation / refund emails) ·
[./integrations.md](./integrations.md) (ANAF CUI, flight status) ·
runbook [../../functions/NETOPIA_SETUP.md](../../functions/NETOPIA_SETUP.md) ·
[../../functions/README.md](../../functions/README.md).

---

## Moving parts

| Piece | File | Role |
|---|---|---|
| Crypto helpers | `functions/src/netopia.js` | Encrypt request, decrypt IPN, build XML, CRC replies |
| `createPayment` (HTTP) | `functions/src/index.js:310` | Validate + price + persist order, return encrypted envelope |
| `netopiaCallback` (HTTP IPN) | `functions/src/index.js:705` | Decrypt + verify, credit tokens / create booking, `<crc>success</crc>` |
| `repayOrder` (HTTP) | `functions/src/index.js:3662` | Self-service online repay of an unpaid pay-at-pickup order |
| Client handoff | `src/services/netopiaService.js` | POST to `createPayment`, auto-submit hidden form to Netopia |
| Repay client | `src/pages/public/PayOrder.js:127` | POST to `repayOrder`, submit handoff |
| Endpoints | `src/utils/constants.js:12` | `CREATE_PAYMENT_URL`, `REPAY_ORDER_URL` (per-function Cloud Run URLs) |

All functions are Gen 2, Node 22, `europe-west1` (`setGlobalOptions`,
`functions/src/index.js:67`). Each Gen 2 function is its own Cloud Run service with
its own hostname, so the callback URL can't be derived from the request host — it's
pinned in `CALLBACK_URL` (`functions/src/index.js:79`, override via
`NETOPIA_CALLBACK_URL`). `SITE_URL` (`index.js:75`) drives return URLs.

---

## The crypto envelope — `functions/src/netopia.js`

A direct port of Netopia's official Node.js proof-of-concept
(<https://github.com/mobilpay/Node.js>) — **not** an npm package. Hybrid encryption:
AES-256-CBC for the XML body, RSA-PKCS1 for the AES key.

- **`encryptRequest(publicKeyPem, xml)`** (`netopia.js:19`) — generates a random
  32-byte AES key + 16-byte IV, AES-256-CBC encrypts the XML (base64), then
  RSA-encrypts the AES key with the merchant **public** key
  (`crypto.publicEncrypt`, `RSA_PKCS1_PADDING`). Returns
  `{ env_key, data, iv, cipher: 'aes-256-cbc' }` — the fields the browser POSTs to
  the hosted page.
- **`decryptIpn(privateKeyPem, { env_key, data, cipher, iv })`** (`netopia.js:44`) —
  RSA-decrypts `env_key` with the merchant **private** key via `node-forge`
  (`RSAES-PKCS1-V1_5`, kept to match the official sample), then AES-decrypts `data`,
  and parses the result with `xml2js` (`parseStringPromise`, `explicitArray: false`).
- **`buildRequestXml({...})`** (`netopia.js:62`) — builds the `<order>` payload:
  `signature`, `url.return` / `url.confirm`, `invoice` (currency + amount + details),
  `contact_info.billing` / `shipping`, and `ipn_cipher: 'aes-256-cbc'`. Uses the
  `xml2js` `Builder` with `cdata: true`.
- **`crcSuccess()` / `crcError(code, msg)`** (`netopia.js:94`) — the XML replies the
  IPN must return. `<crc>success</crc>` tells Netopia the IPN was processed; anything
  else makes Netopia **retry** (it retries for ~3 days).
- **`NETOPIA_ENDPOINTS`** (`netopia.js:12`) — `sandbox:
  https://sandboxsecure.mobilpay.ro`, `live: https://secure.mobilpay.ro`.

---

## Secrets & the sandbox/live switch

Five secrets bound via `defineSecret()` (`functions/src/index.js:69`), stored in
Google Secret Manager, never in git. Set them with
`firebase functions:secrets:set <NAME>` (see the runbook for the exact commands and
the piped-PEM idiom for the key files).

| Secret | Used for |
|---|---|
| `NETOPIA_SIGNATURE` | Merchant POS signature string, placed in the XML `<signature>` |
| `NETOPIA_PUBLIC_KEY` | PEM — encrypts outgoing requests (`createPayment` / `repayOrder`) |
| `NETOPIA_PRIVATE_KEY` | PEM — decrypts incoming IPNs (`netopiaCallback`) |
| `NETOPIA_ENV` | `'sandbox'` or `'live'` — selects the endpoint |
| `NETOPIA_API_KEY` | **Reserved / unused** — placeholder for the future v2 REST API |

The environment switch is a single lookup: `NETOPIA_ENDPOINTS[NETOPIA_ENV]`,
defaulting to sandbox (`index.js:687`). Sandbox and live use **different** signature
+ key pairs. `createPayment` binds `[NETOPIA_SIGNATURE, NETOPIA_PUBLIC_KEY,
NETOPIA_ENV]`; `netopiaCallback` binds only `[NETOPIA_PRIVATE_KEY]`; `repayOrder`
binds the same three as `createPayment`.

Netopia's merchant panel must point its **IPN/confirm URL** at the `netopiaCallback`
Cloud Run URL and its **return URL** at `https://mangoparking.ro/booking/return`.

---

## `createPayment` — request build (`functions/src/index.js:310`)

`onRequest`, `cors: true`, POST only. Body shapes:

```
credits:  { orderType:'credits',  packId, quantity, packPrice, customerData, paymentMethod?, voucherCode?/voucherId? }
longTerm: { orderType:'longTerm', dropoffAt, pickupAt, days, totalPrice, customerData, paymentMethod?, voucherCode?/voucherId? }
customerData: { customerId?, licensePlate, name, email, phone, billing? }
```

Flow:

1. **Validate** `licensePlate` and the per-type required fields (`index.js:321`).
2. **Server-authoritative price recompute** — the client-sent total is never
   trusted. Long-term calls `computeAuthoritativeLongTermTotal` and credits calls
   `computeAuthoritativePackPrice` (both from `pricingValidate.js`); a mismatch
   returns `400 price mismatch` (`index.js:346`, `:372`). This is the anti-tamper
   gate — a doctored `totalPrice` is refused.
3. **Online discount** — for `paymentMethod: 'online'`, apply
   `settings/global.onlineDiscountPercent` (default 10) on top of the standard price
   (`index.js:398`). Pay-at-pickup is charged the standard price, no discount.
4. **Voucher resolution** (`index.js:419`) — supports the new `promoVouchers` code
   path (`resolveVoucher`) and the legacy `vouchers/{uid}` signup bonus; promo wins,
   vouchers don't combine. The caller's Firebase ID token (Authorization header) is
   verified so the discount can be tied to a real user. Promo redemptions are written
   in a Firestore transaction **before** the pending order so a stampede on one code
   can't double-redeem (`index.js:511`); a lost race returns `409`.
5. **Persist** `pendingOrders/{orderId}` (`ord_{ts}_{rand}`) with `status:'pending'`,
   `paymentMethod`, the computed `amount`, and voucher fields (`index.js:490`, written
   at `:652`).
6. **Short-circuits** (no Netopia handoff):
   - **Free order** (`amount <= 0`, a days-voucher covered the whole long-term total):
     create the booking as paid (`paidBy:'voucher'`), mark the order paid, return
     `{ orderId, free:true, redirectUrl }` (`index.js:604`).
   - **Pay-at-pickup**: for long-term, create the booking doc immediately (unpaid, so
     the reservation is confirmed) then return `{ orderId, paymentMethod,
     redirectUrl }` (`index.js:645`, `:657`). Credits aren't granted until cash is
     collected via `adminMarkOrderPaid`.
7. **Online handoff** — build the XML (`buildRequestXml`), encrypt it
   (`encryptRequest` with `NETOPIA_PUBLIC_KEY`), pick the endpoint by `NETOPIA_ENV`,
   and return `{ action, env_key, data, cipher, iv, orderId }` (`index.js:668`).
   `returnUrl` = `${SITE_URL}/booking/return?orderId=…`, `confirmUrl` = `CALLBACK_URL`.

---

## `netopiaCallback` — the IPN (`functions/src/index.js:705`)

`onRequest`, `cors: false`, POST only, `Content-Type: application/xml` replies. This
is **the only place online orders become `paid`.**

1. Read form fields `{ env_key, data, cipher, iv }`; `decryptIpn` with
   `NETOPIA_PRIVATE_KEY`. A decrypt failure returns `crcError('0x03','decrypt
   failed')` (`index.js:724`).
2. Parse the decoded XML: `action = order.mobilpay.action` (lowercased),
   `orderId = order.$.id`, `errorCode = mobilpay.error.$.code` (`index.js:733`).
3. Load `pendingOrders/{orderId}`; unknown order → `crcError('0x05')`.
   **Idempotency:** if `isFulfilledOrder(pending)` (`netopia.js`), return `crcSuccess()`
   immediately — IPN retries are safe. The guard requires *evidence the success branch
   ran* (`status === 'paid'` **and** one of `bookingId` / `balanceDocId` / `paidBy`),
   not the `status` label alone — see the incident note below. The same predicate
   guards the lease transaction in step 4.
4. **Success** (`action` is `confirmed`/`paid` **and** `errorCode === '0'`,
   `index.js:751`):
   - **longTerm** — if the order already has a `bookingId` (pay-at-pickup pre-created,
     now repaid online) update that booking to paid, reserve a spot, and reconcile
     `totalPrice`/`basePrice` down to `repayAmount` (`index.js:754`); otherwise
     `createBookingFromOrder` creates a fresh paid booking. Stamps the promo
     redemption's `bookingId`; sends `sendRepayPaidEmail` on the repay path.
   - **credits** — `creditTokens(...)` credits `tokenBalances` and appends a
     `tokenTransactions` purchase row (`index.js:826`).
   - Mark the order `paid` (`paidBy:'netopia'`) and consume any legacy voucher in a
     guarded transaction (`index.js:845`). Return `crcSuccess()`.
5. **Non-success** — record `status = failureStatusFor(action)` + `netopiaFailedAction`
   + the error code, but still return `crcSuccess()` so Netopia stops retrying.
   `failureStatusFor` keeps the informative actions (`canceled`, `credit`) and
   collapses `paid` / `confirmed` to `'failed'` so a failure can never write a status
   that impersonates fulfilment.

Every IPN logs one `Netopia IPN: {orderId, action, errorCode, orderStatus, bookingId}`
line — the 2026-08-12 incident took hours to reconstruct because this handler logged
nothing.

### Incident 2026-08-12 — a retried payment was swallowed

**Symptom:** a customer paid online, was charged, and no reservation existed on any
admin screen. They arrived at the lot two days later and had to be entered by hand
(booking `LT-783EF`, keyed `paidBy: 'broker'` because there was nothing to attach to).

**Root cause — a vocabulary collision.** Netopia's `action` field reports the
*attempted* action, so a **declined** card still reports `action = 'paid'` with the
refusal in `error.code`. The old non-success branch wrote `status: action || 'failed'`,
stamping `status: 'paid'` on a *failed* order. That is the exact sentinel the
idempotency guard read as "already fulfilled". Sequence for order
`ord_1786576684010_uuvq16` (plate PH28BFI, 124 RON):

| Time (UTC) | Event | Handler latency | Result |
|---|---|---|---|
| 23:18:04 | order created, SmartBill proforma `MANGO-0111` issued | — | `status: 'pending'` |
| 23:18:40 | IPN #1 — `action='paid'`, `error.code='39'` (declined) | 2.0 s | failure branch writes **`status: 'paid'`** |
| 23:29:19 | IPN #2 — the retry that succeeded | **0.115 s** | guard says "already paid" → `crcSuccess()`, **nothing created** |

The 0.115 s latency is the tell: a real fulfilment takes ~2 s (booking + invoice +
email). IPN #1 was acked with `crcSuccess()`, so Netopia had no reason to *retry* —
IPN #2 was a genuinely new transaction event (its payload was a different size), i.e.
the customer's second card attempt going through. The order's `_updateTime` never moved
past 23:18:42, and `netopiaAction` — which only the success branch writes — was never
set, proving the success branch never ran.

**Blast radius:** 6 orders since May 2026 carry the signature (`status: 'paid'` with no
`bookingId`/`balanceDocId`): 4× error 35 and 1× error 20 (mostly test plates), plus this
one. Query them with `status == 'paid' && bookingId == null && balanceDocId == null`.

**Fixed 2026-08-14** — `failureStatusFor()` + `isFulfilledOrder()` in `netopia.js`,
applied at the entry guard, the lease transaction and the failure branch; regression
suite `functions/test/netopia.ipn.test.js`. Deployed 2026-08-14.

**Reconciled 2026-08-14** — capture confirmed in the Netopia panel, then:
`scripts/reconcile-swallowed-ipn-order.mjs` moved booking `LT-783EF` off the desk's
broker shape onto the online-card shape (`paidBy: 'netopia'`, `paymentMethod: 'online'`,
`source: 'web'`, `paymentId` → the order), copied the order's billing onto the booking,
back-linked the order (`bookingId`, `paidAt` = the successful IPN's timestamp), stamped
the `MANGO1ZI` redemption, and wrote an `auditLog` row. Fiscal invoice **Mango 0157**
(124 lei) then issued via `scripts/backfill-smartbill-invoices.mjs` and mirrored onto
the order. Clearing all three of `source`/`paidBy`/`paymentMethod` matters —
`isBrokerBooking()` treats any one of them as proof of a broker sale.

The five older orders with this signature were left alone: four are May-2026 test
plates, and the July one (CL05AWN) self-resolved — that customer paid cash at the lot.

> **Consequence to watch for:** when this fires, the customer also gets no confirmation
> email (it hangs off the `bookings` create trigger), the SmartBill proforma is never
> converted to a fiscal invoice, and any promo voucher stays consumed with
> `voucherRedemptions.bookingId = null`. Reconciling a swallowed order means fixing all
> four, not just the booking.

`createBookingFromOrder` (`index.js:227`) writes the canonical `bookings` doc
(reservation code `LT-XXXXX`, `paymentStatus`, `paidBy`, contact/billing, spot
reservation for paid bookings). `creditTokens` (`index.js:126`) increments the
balance and logs the purchase transaction. Booking/credit confirmation emails fire
from Firestore triggers, not here — see [./email-brevo.md](./email-brevo.md).

---

## `repayOrder` — online repay of a pay-at-pickup order (`functions/src/index.js:3662`)

`onRequest`, POST `{ orderId }`. Lets a customer who chose "pay at the lot" later pay
online (link comes from their confirmation email → `/pay?orderId=…`, handled by
`PayOrder.js`).

- Refuses already-paid orders (`409 already_paid`) and non-pay-at-pickup orders
  (`400 not_repayable`) (`index.js:3678`).
- Recomputes the amount by applying the **live online discount** to the stored
  standard price — this is the incentive to pay online (`index.js:3688`).
- Stamps `repayInProgress: true` + `repayAmount` on the order (without flipping the
  payment method — an abandoned repay stays pay-at-pickup) (`index.js:3731`), then
  returns the same `{ action, env_key, data, cipher, iv, orderId }` handoff envelope.
- On IPN success the callback sees the existing `bookingId` and reconciles the booking
  to `repayAmount` rather than creating a duplicate (see step 4 above).

---

## Client handoff — `src/services/netopiaService.js`

`startNetopiaPayment(payload)` (`netopiaService.js:26`):

1. POST the payload to `CREATE_PAYMENT_URL`, attaching the Firebase ID token as a
   Bearer header when signed in (so the server can validate a voucher / customer).
   Anonymous callers still work; the voucher just won't apply.
2. Branch on the response:
   - `free` → navigate to `redirectUrl` (order already fulfilled server-side).
   - `paymentMethod === 'pay-at-pickup'` → navigate to `redirectUrl` (no Netopia).
   - otherwise → `submitNetopiaHandoff({ action, env_key, data, cipher, iv })`.
3. `submitNetopiaHandoff` (`netopiaService.js:71`) builds a hidden `<form
   method="POST" action="{action}">` with `env_key` / `data` / `cipher` / `iv` inputs
   and submits it — redirecting the browser to Netopia's hosted card page. After
   payment, Netopia redirects back to `/booking/return?orderId=…`, which polls
   `pendingOrders/{orderId}.status` until it flips to `paid` (the IPN did the work
   out-of-band).

`PayOrder.js` (`submitRepay`, `PayOrder.js:127`) does the same for repay, POSTing to
`REPAY_ORDER_URL` and reusing `submitNetopiaHandoff`.

Endpoint URLs are per-function Cloud Run hostnames in `src/utils/constants.js:12`
(`CREATE_PAYMENT_URL`, `REPAY_ORDER_URL`), overridable via
`VITE_CREATE_PAYMENT_URL` / `VITE_REPAY_ORDER_URL` for emulator/staging.

---

## Refunds are manual (no programmatic refund)

v1.x has **no automated refund endpoint**, so the code never calls Netopia to reverse
a charge. Instead:

1. **`cancelBookingWithRefund`** (callable, `functions/src/index.js:1687`) — customer
   or staff cancels an upcoming/active long-term booking. It flips `status` to
   `cancelled`, releases the reserved spot, and sets `paymentStatus` per how it was
   paid (`index.js:1777`):
   - paid via Netopia → `refund-pending` (`refundOutcome: 'netopia-pending'`)
   - paid via admin-cash/card → `refund-pending` (`refundOutcome: 'cash-pending'`)
   - unpaid pay-at-pickup → nothing to refund; just cancel.
   (A never-arrived booking >12h past drop-off is routed to `no-show`, which forfeits
   the fee — no refund flag, `index.js:1738`.) The change mirrors onto `pendingOrders`
   and writes an `auditLog` row.
2. A staff member processes the actual refund **out of band** — in the Netopia
   merchant panel for card payments, or cash-back at the lot — surfaced via the admin
   `/admin/refunds` queue (see
   [../admin-flows/03-cancellations-refunds-cashbook.md](../admin-flows/03-cancellations-refunds-cashbook.md)).
3. **`adminMarkRefunded`** (callable, `functions/src/index.js:1865`) — after the manual
   refund, staff flip the booking from `refund-pending` → `refunded`, stamping
   `refundedVia` (`netopia-panel` | `cash-returned` | `card-terminal`), `refundedBy`,
   `refundedAt`, and optional notes. It mirrors onto `pendingOrders`, audit-logs, and
   fires the customer refund email (`sendRefundIssuedEmail`). Idempotent.

Note: `adminMarkOrderUnpaid` (`index.js:1246`) explicitly **refuses** to reverse
Netopia-paid orders — that's a refund, not a misclick reversal.

---

## Planned v2 (not built): automated refunds/voids

[../roadmap/v.1.4_netopia_v2_migration.md](../roadmap/v.1.4_netopia_v2_migration.md)
is the plan to replace this whole XML/crypto stack with Netopia's **v2 JSON REST
API** (`Authorization: <api_key>` header, no client-side crypto). It would add
`POST /operation/credit` (refund) and `POST /operation/void` (same-day cancel),
storing an `ntpID` per order so `cancelBookingWithRefund` could refund
programmatically and fall back to the manual queue only on failure. As of the verify
date there is **no** `netopiaV2.js`, no `createPaymentV2`/`netopiaV2Callback`, and no
`ntpID`/`paymentVersion` fields — payments run entirely on the legacy flow described
above.

---

## Sandbox test loop (abridged)

Full runbook: [../../functions/NETOPIA_SETUP.md](../../functions/NETOPIA_SETUP.md).

1. `NETOPIA_ENV=sandbox` + sandbox signature/key pair; deploy functions.
2. Point the Netopia panel's IPN URL at the `netopiaCallback` URL and return URL at
   `/booking/return`.
3. From `/booking/long-term`, pay with the Netopia test card → redirected to
   `sandboxsecure.mobilpay.ro`.
4. Verify: `pendingOrders/{orderId}.status === 'paid'`, a `bookings/{id}` with
   `paymentId === orderId`, and a `<crc>success</crc>` in `firebase functions:log`.
5. Go live: swap to production signature/key pair + `NETOPIA_ENV=live`, redeploy,
   flip the POS mode in the panel.
