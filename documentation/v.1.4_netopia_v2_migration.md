# Mango Parking v1.4 — Netopia v1.x → v2 REST Migration

## Why

Our current payment flow uses Netopia's **legacy mobilpay v1.x XML stack**:

- `createPayment` builds an XML payload, encrypts it with RSA + AES, and returns three form fields that the browser POSTs to `secure.mobilpay.ro`.
- `netopiaCallback` receives an encrypted XML IPN, decrypts it, parses it, replies with `<crc>success</crc>`.
- Refunds: **none available programmatically**. v1.x has no automated refund endpoint. Refunds are admin-panel only.

Netopia's **v2 REST API** is the modern alternative:

- JSON request/response, `Authorization: <api_key>` header — no crypto on our side.
- Issues automated refunds via `POST /operation/credit { ntpID, amount }`.
- Issues voids (same-day cancellations, no banking impact) via `POST /operation/void { ntpID }`.
- Same callback/IPN concept but cleaner JSON payload.
- Netopia has signaled v1.x is on a long deprecation runway; v2 is the recommended target.

Going to v2 unlocks the operational improvements we've already prepared for: automatic refunds at cancel time, void within the same day (no bank settlement delay), and a clean `ntpID` we can store and audit against.

## Scope

Replace the v1.x integration end-to-end. Out of scope: changing the customer-facing payment experience (still a hosted Netopia card page), changing pricing logic, changing booking flow.

---

## Decisions to lock before starting

| # | Question | Default |
|---|---|---|
| 1 | Cutover strategy: hard switch or dual-write (both endpoints active during transition)? | Hard switch — dual-write doubles the risk surface and v2 is well-documented |
| 2 | Old bookings paid via v1.x — do we backfill `ntpID` for them? | No — they stay on the manual refund queue (v1.4 still ships the admin queue from v1.3) |
| 3 | Sandbox testing duration before flipping live | Minimum 48h of sandbox traffic + 5 successful test charge+refund cycles |
| 4 | Same callback URL or new function? | New function `netopiaV2Callback` so we can run both side-by-side during testing |
| 5 | What happens if Netopia v2 has an outage during cutover? | Keep v1.x code in tree (commented out / behind a feature flag) so we can flip back in one secret change |

---

## What we know about v2

Endpoints (per Netopia OpenAPI spec at `https://secure.sandbox.netopia-payments.com/spec`):

| Action | Method | Path | Body |
|---|---|---|---|
| Start a payment | POST | `/payment/card/start` | order details + customer + amount + return/notify URLs |
| Refund | POST | `/operation/credit` | `{ ntpID, amount, split? }` |
| Void (same-day cancel) | POST | `/operation/void` | `{ ntpID }` |

Servers:
- Sandbox: `https://secure.sandbox.netopia-payments.com`
- Live: `https://secure.mobilpay.ro/pay`

Auth: `Authorization: <api_key>` header (raw key, not Bearer). API key generated in Netopia admin console at `https://admin.netopia-payments.com/`.

`ntpID` is Netopia's internal transaction ID — returned in the `/payment/card/start` response and echoed on every IPN. It's the **key** we need to capture and store on `pendingOrders` + `bookings` so refunds work.

---

## Phase 1 — Foundation (~0.5 day)

### 1.1 Secrets

`NETOPIA_API_KEY` already exists in `defineSecret` (currently set to a placeholder per `NETOPIA_SETUP.md`). Replace with the real live API key.

Generation: client logs into `https://admin.netopia-payments.com/` → Account → API keys → Generate. Live and sandbox are separate keys.

### 1.2 New module `functions/src/netopiaV2.js`

Replaces the XML/crypto helpers in `netopia.js`. Exports:

```js
export const NETOPIA_V2_ENDPOINTS = {
  sandbox: 'https://secure.sandbox.netopia-payments.com',
  live:    'https://secure.mobilpay.ro/pay',
};

export async function v2StartPayment({ orderId, amount, currency = 'RON', customer, returnUrl, notifyUrl, env = 'sandbox', apiKey }) { ... }
export async function v2Refund({ ntpID, amount, env, apiKey }) { ... }
export async function v2Void({ ntpID, env, apiKey }) { ... }
export function v2VerifyCallback({ rawBody, headers, apiKey }) { ... }  // signature verification
```

Each is a thin `fetch` wrapper. No `node-forge`, no XML — pure JSON.

### 1.3 Doc-shape additions

`pendingOrders/{orderId}` + `bookings/{id}` both grow a `netopiaV2` block:

```js
netopiaV2: {
  ntpID: 'NTP-...',
  startedAt: ISO,
  capturedAt: ISO | null,
  voidedAt: ISO | null,
  refundedAt: ISO | null,
  refundAmount: number | null,
  lastError: string | null,
}
```

Plus a top-level `paymentVersion: 'v1' | 'v2'` discriminator so admin tooling can branch correctly during migration.

---

## Phase 2 — Sandbox parallel (~0.5 day)

Run v2 in sandbox alongside live v1 so we never disrupt production.

- New Cloud Functions: `createPaymentV2`, `netopiaV2Callback`. Existing `createPayment` and `netopiaCallback` stay untouched.
- Feature flag in client: a hidden query param `?paymentVersion=v2` on the booking pages routes the request through `createPaymentV2`. Default stays v1.
- All Phase 1 + 2 testing happens on `?paymentVersion=v2` against the sandbox API key.

### 2.1 Tests

End-to-end with `?paymentVersion=v2`:

1. Long-term booking, sandbox card → success path → `pendingOrders.netopiaV2.ntpID` populated → booking created.
2. Same, then cancel within 5 min → `v2Void` called → Netopia sandbox shows the order voided → booking flips `paymentStatus: 'refunded'`.
3. Same, then cancel after a settled simulated day → `v2Refund` called → sandbox shows refund → booking flips to `refunded`.
4. Credit pack, sandbox card → tokens credited as today.
5. Repay flow (pay-at-pickup → online repay) → v2 path works.
6. IPN replay (POST the same IPN twice) → idempotent (one booking, one email).

48h soak in sandbox before going further.

---

## Phase 3 — Cancel/refund integration (~0.5 day)

`cancelBookingWithRefund` learns to branch:

```js
if (booking.paymentVersion === 'v2' && booking.netopiaV2?.ntpID && paid && paidVia === 'netopia') {
  const sameDay = isSameFiscalDay(booking.netopiaV2.capturedAt);
  const result = sameDay
    ? await v2Void({ ntpID: booking.netopiaV2.ntpID, ... })
    : await v2Refund({ ntpID: booking.netopiaV2.ntpID, amount: booking.totalPrice, ... });
  await bookingRef.update({
    paymentStatus: 'refunded',
    refundedAt: nowIso,
    refundedBy: callerUid,
    refundedVia: sameDay ? 'netopia-void' : 'netopia-refund',
    'netopiaV2.refundedAt': nowIso,
    'netopiaV2.refundAmount': booking.totalPrice,
  });
  // Trigger refund email automatically.
}
```

If the v2 call **fails**, fall through to the existing `refund-pending` path so the admin queue catches it. Never silently lose a refund.

Same path for credit-pack `pendingOrders` cancellations.

### 3.1 SmartBill interplay

When v1.4 ships, the SmartBill integration (v1.2) is presumably live too. Refund automation needs to also trigger:

- Same-day refund → `cancelInvoice` (clean cancel)
- Prior-day refund → `creditNote` (storno)
- Phase 4 of v1.2 already handles this — no extra work, but **order matters**: refund first, fiscal action second. If SmartBill fails, the refund still stands and the admin queue surfaces it for manual correction.

---

## Phase 4 — Cutover (~0.5 day + 48h sandbox + monitoring window)

Sequence:

1. **Sandbox soak complete** — all 6 tests pass, 48h with no errors.
2. **Set live API key**: `firebase functions:secrets:set NETOPIA_API_KEY` (live value).
3. **Deploy v2 functions**: `firebase deploy --only functions:createPaymentV2,functions:netopiaV2Callback --force`.
4. **Configure Netopia live admin**: set the live IPN URL to `https://netopiav2callback-<hash>.a.run.app`. Add the new IPN URL alongside the old one (admin panel supports multiple).
5. **Flip client default to v2** — remove the `?paymentVersion=v2` gate; v1 becomes the explicit opt-out (`?paymentVersion=v1`).
6. **Monitor 24h**: every failed call goes into the admin refund queue from v1.3 so nothing is lost. Watch `functions:log` for v2 errors.
7. **Decommission v1**: after 7 days of clean v2 operation, remove `createPayment` and `netopiaCallback`, remove `node-forge` dep, remove `netopia.js`. Update `NETOPIA_SETUP.md`.

### 4.1 Rollback plan

If v2 has problems during the monitoring window, flip the client default back to v1 via the feature flag. v1 code is still in tree and live. One commit + one deploy reverts; no data is at risk because v1 and v2 use separate fields (`paymentVersion` discriminator).

---

## Phase 5 — Backfill decisions (~0.25 day or 0)

For bookings paid via v1 that get cancelled after the cutover:

- They have **no `ntpID`** — automatic refund impossible.
- They flow into the **manual refund queue from v1.3** (admin clicks through to Netopia panel, processes refund there, marks refunded in our admin).
- We do **not** attempt to backfill `ntpID` from Netopia — the legacy IPN didn't carry it, and asking Netopia support for a bulk mapping is not worth it.
- After ~6 months when no upcoming bookings remain on v1, the manual queue dries up naturally. Keep the manual code path indefinitely as a safety net.

---

## File-level touch summary

**New files (~3):**
- `functions/src/netopiaV2.js` — v2 REST wrappers
- (Optional) `functions/src/netopiaV2Callback.js` — IPN handler kept separate from createPaymentV2 for clarity

**Modified files (~7):**
- `functions/src/index.js` — `createPaymentV2`, `netopiaV2Callback`, branched `cancelBookingWithRefund`, branched `repayOrder`
- `firestore.rules` — no rule changes needed (`netopiaV2` block is server-written, already covered by existing booking rules)
- `firestore.indexes.json` — composite index on `bookings(paymentVersion, paymentStatus)` if the refund queue branches by version
- `src/services/paymentService.js` (or wherever `createPayment` is called) — branch on `paymentVersion` flag
- `src/pages/public/BookingLongTerm.js`, `BookingCredits.js` — read `paymentVersion` from query/feature-flag config
- `src/pages/account/BookingHistory.js` — show refund status; auto-refunded bookings get `Rambursat automat` label
- `src/i18n/ro.js` + `en.js` — `payment.v2*` keys

**Decommission later (~Phase 4 step 7):**
- `functions/src/netopia.js`
- `functions/src/index.js` — remove `createPayment`, `netopiaCallback`, remove `node-forge` import, remove `NETOPIA_PUBLIC_KEY` / `NETOPIA_PRIVATE_KEY` / `NETOPIA_SIGNATURE` references
- `functions/package.json` — drop `node-forge`, drop `xml2js` if unused elsewhere
- `NETOPIA_SETUP.md` — full rewrite for v2

---

## Verification per phase

### Phase 1
- `v2StartPayment` mock unit test: builds expected JSON body, sets Authorization header.
- Hand-call `/operation/credit` from a Node REPL with a sandbox ntpID → returns success.

### Phase 2
- The 6 sandbox tests above all pass.
- IPN replay: same payload posted twice → only one mutation.
- Sandbox dashboard shows the orders in the expected states (paid, voided, refunded).

### Phase 3
- Same-day cancel → Netopia sandbox shows `void`, our doc shows `refundedVia: 'netopia-void'`.
- Prior-day cancel → Netopia sandbox shows `credit`, our doc shows `refundedVia: 'netopia-refund'`.
- API error simulated (wrong api key) → falls through to refund-pending queue, no data loss.

### Phase 4
- Real customer test: small live booking → cancel within an hour → refund lands on the card within bank settlement window.
- 24h monitoring: zero errors in `functions:log`.
- Manual queue from v1.3 stays small (only v1 leftovers + edge failures).

### Cross-cutting
- All booking/credit emails still arrive (the email triggers are decoupled from the payment version).
- SmartBill invoices issued + credit-noted correctly when v1.2 is also live.
- `firebase deploy --only functions` clean.
- Sandbox + live both end-to-end working before declaring done.

---

## Estimated effort

| Phase | Days |
|---|---|
| 1 — Foundation (secrets, helpers) | 0.5 |
| 2 — Sandbox parallel + 48h soak | 0.5 (code) + 2 (soak) |
| 3 — Cancel/refund integration | 0.5 |
| 4 — Cutover + 7-day monitoring | 0.5 (code) + 7 (monitoring) |
| 5 — Backfill decisions (deferred) | 0 |
| **Total active dev** | **~2 days code, ~10 days calendar** |

The calendar time is dominated by sandbox soak + post-cutover monitoring. Active development is light. The right time to ship this is during a low-volume booking window so the monitoring period catches problems before customer impact.

---

## Caveats and follow-ups

- **API key rotation** — Netopia lets you regenerate the API key from admin. We should rotate it on a schedule (every 6 months) — make it a calendar event, not a code change.
- **Webhook signature verification** — v2 IPNs are signed. Verify the signature using the API key in `v2VerifyCallback`. Without verification, anyone who knows our function URL can spoof payment confirmations. Don't ship Phase 2 without this.
- **No support for partial refunds** in v1.3's admin queue. v2 supports them via the `amount` field on `/operation/credit`. If we ever need them, the wiring is trivial — pass a smaller amount.
- **`ntpID` is the new sacred ID.** Index it. Audit-log every mutation that touches it. If we ever need to dispute a charge with Netopia or reconcile against their reports, `ntpID` is what they search by.
- **Old XML-encrypted IPNs** may still arrive for ~6 months after cutover (delayed delivery from Netopia's queue). The old `netopiaCallback` must stay deployed during that window — it's idempotent and harmless if the order is already paid.
- **Out of scope for v1.4**: subscriptions, recurring payments, 3DS challenge UI customization, Apple/Google Pay (separate Netopia products).
