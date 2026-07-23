# ParkVia (ParkCloud) auto-import — v1.x

> **Status: 🟡 Credentials LIVE, bookings endpoint pending (2026-07-23).**
> ParkCloud access arrived: both keys are set in Secret Manager
> (`PARKVIA_SUBSCRIPTION_KEY` = Azure APIM primary, `PARKVIA_OPERATOR_KEY` =
> the ParkCloud UUID key), the `defineSecret` bindings are enabled, and
> `functions/.env.mango-parking` carries `PARKVIA_PARKING_ID=15777` (our
> Operator Id, verified) + the gateway base URL. **Confirmed live against the
> API:** gateway `https://parkcloud.azure-api.net`, service prefix
> `/rest/operator/v1.svc`, auth = subscription key header + operator key as
> the `key` query param, and the `GET /operators` endpoint (healthcheck now
> probes it and verifies operator 15777 is visible). **Still unknown:** the
> reservations-list endpoint + XML schema (portal operation list needed) —
> the mapper stays quarantined in `mapParkviaBookingToImport` until then.
> Not yet deployed.

## Goal

Reservations booked through **ParkVia** should appear as bookings in `/admin`
automatically, instead of being re-typed at the desk (today's manual path: the
"Broker / prepaid" sub-mode of the New Transaction modal → `adminCreateLongtermBooking`
with `paidBy:'broker'`, `brokerName:'ParkVia'`).

## The integration model

ParkVia's operator technology is the **ParkCloud Operator API** — a REST/**XML**
service on **Azure API Management**, **API-key auth** (an `Ocp-Apim-Subscription-Key`
plus an operator key), documented as **pull/poll** (we fetch bookings by Parking ID;
no confirmed push webhook). The exact endpoints, the reservation XML schema, the
datetime format/timezone, the operator-key header, and the cancellation/amendment
status signal are **partner-gated** (behind ParkCloud's developer portal) and unknown
until we onboard.

So the scaffold is **poll-based** and **dormant-until-configured** (same shape as the
flight-status integration): a scheduled job pulls new/changed reservations, imports new
ones as broker bookings, and reconciles cancellations; an admin "Sync now" button runs
the same pass on demand.

## What was built (all shipped, dormant)

| Piece | Where |
|---|---|
| REST/XML client, dormant gate, **provisional mapper** | `functions/src/parkvia.js` |
| Shared broker-booking primitive (manual desk + import both route through it) | `functions/src/index.js` → `createBrokerBookingCore` |
| Import engine + cancellation/amendment reconcile | `functions/src/index.js` → `runParkviaSync` / `reconcileParkviaBooking` |
| Scheduled poller (`every 15 minutes`) | `functions/src/scheduled.js` → `pollParkviaBookings` |
| Admin callables (`assertAdmin`) | `functions/src/index.js` → `parkviaSyncNow`, `parkviaHealthcheck` |
| Client wrappers | `src/services/parkviaService.js` |
| Admin card ("Check connection" / "Sync now") | `src/pages/admin/AdminPricing.js` |
| Server-only collections + `parkvia` field guard | `firestore.rules` |
| i18n | `src/i18n/{ro,en}.js` → `parkvia.*` |
| Mapper unit tests | `functions/test/parkvia.mapper.test.js` (`cd functions && npm test`) |

### Data model
- **`bookings.parkvia`** `{ ref, importedAt, lastStatus }` — server-written import trail
  (rules block client writes, alongside `smartbill`). `lastStatus ∈ 'active' | 'cancelled'
  | 'amended' | 'cancelled-needs-review'`.
- **`parkviaImports/{ref}`** — the **authoritative dedup ledger**, one doc per ParkVia
  booking reference: `{ ref, bookingId, importedAt, lastStatus, lastSeenAt, lastRaw }`.
  Claimed transactionally before a booking is created, so the poller and a concurrent
  "Sync now" can't double-import. Staff read; server-written only.
- **`parkviaSync/state`** — the poll cursor: `{ lastSyncAt, lastRunAt, lastResult, lastError }`.
  Staff read; server-written only. (A dedicated collection, not `settings/*`, because the
  shared `settings/{doc}` rule allows admin client writes — a server cursor must not.)

### Booking shape
Imported reservations are ordinary **broker** bookings: `source:'broker'`,
`paidBy:'broker'`, `paymentMethod:'broker'`, `paymentStatus:'paid'`, `billing:null`,
**no cashbook entry, no SmartBill document** (ParkVia bills the customer; `totalPrice` is
their customer price, not our net). The `onBookingCreated` trigger + `adminNotifyBookingCreated`
fire automatically on create — the importer sends no email of its own.

### Reconciliation (safe-by-default)
- **Cancellation** — only a still-`upcoming` booking is auto-cancelled (status→`cancelled`,
  spot released to `available`). A car already `active`/`completed` is **flagged for manual
  review** (`parkvia.lastStatus:'cancelled-needs-review'` + audit), never silently released.
- **Amendment** — PROVISIONAL: only safe fields (dropoff/pickup dates → recompute `days`) are
  auto-applied, and only while `upcoming`; price/plate changes are left for manual review.

## Still PROVISIONAL — finalize from the portal's operation list
1. Every field path in `mapParkviaBookingToImport` + datetime format/timezone + price field.
2. The reservations endpoint path, the `since` cursor param, pagination, response envelope
   (`listParkviaBookings` / `getParkviaBookingStatus`) — guessed paths 404.
3. The cancellation/amendment status enum (`normalizeStatus`) the reconcile branch keys off.

~~Resolved 2026-07-23:~~ auth model (subscription key header + `key` query param — no
operator-key header), base URL (`parkcloud.azure-api.net`), service prefix
(`/rest/operator/v1.svc`), parking/operator id (**15777**), and `GET /operators`
(confirmed, now the healthcheck probe).

Update the fixture + assertions in `functions/test/parkvia.mapper.test.js` alongside (1).

## Onboarding / enable checklist
1. List the car park with ParkVia → get the **Operator API** enabled in ParkCloud.net.
2. Register on the ParkCloud developer portal (Azure APIM) → get the **Subscription Key**
   (ask the ParkVia account manager to approve the link).
3. Set config: `firebase functions:secrets:set PARKVIA_SUBSCRIPTION_KEY` and
   `PARKVIA_OPERATOR_KEY`; put `PARKVIA_PARKING_ID` / `PARKVIA_BASE_URL` in
   `functions/.env.mango-parking`.
4. In `functions/src/parkvia.js`: uncomment the `[SECRET]` lines (`defineSecret` +
   `PARKVIA_SECRETS`), and confirm the `secrets: PARKVIA_SECRETS` bindings on
   `pollParkviaBookings`, `parkviaSyncNow`, `parkviaHealthcheck`.
5. Finalize the 5 PROVISIONAL items against the real XML; update + re-run the mapper test.
6. `cd functions && firebase deploy --only functions`; run **Check connection** then one
   **Sync now** from `/admin/pricing`.

## Open questions to confirm with ParkCloud
- Push vs pull (is there any webhook/callback, or poll-only?).
- The reservation XML schema + plate/datetime field names & format.
- How cancellations & amendments are signalled (separate events vs re-poll status).
- Recommended poll frequency, rate limits, `since`/delta filtering, pagination.
- Sandbox/test environment + credentials.

## Out of scope (matches the existing broker path)
Partner **settlement/commission** — deferred (see `v.1.7_checkin_redesign.md`); and
broker bookings get **no invoice** (SmartBill) and **no cashbook** entry.
