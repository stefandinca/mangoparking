# Parkos auto-import

> Status: ✅ Shipped — **built and verified against the live API 2026-08-06** ·
> Last verified: 2026-08-06
>
> ⚠️ Not yet running in production: the poller stays inert until
> `PARKOS_CLIENT_SECRET` is set in Secret Manager and the functions are
> redeployed. See [Go-live](#go-live).

## What it is

Reservations booked through **Parkos** (parkos.com / parkos.ro — the Dutch
airport-parking aggregator) land in `/admin` automatically as
[broker bookings](long-term-bookings.md), instead of being re-typed at the desk.
A scheduled job polls the Parkos partner API every 15 minutes, imports new
reservations, and reconciles cancellations and amendments.

This is the **second** broker channel, alongside
[ParkVia](parkvia.md). The two are deliberately independent — separate
credentials, separate ledgers, separate schedulers, separate admin cards — so
one aggregator's outage or schema change can't stop the other from importing.
They converge on one primitive, `createBrokerBookingCore`, so a Parkos import,
a ParkVia import and a manual desk entry all produce **identical** booking docs.

The manual path still exists and is unchanged — the "Broker / prepaid" sub-mode
of the New-reservation modal, with `brokerName: 'Parkos'`, which is exactly what
staff have been typing until now.

> **Config-gated, not dormant.** `parkosConfig().configured` is false without
> the OAuth credentials, and then the poller is a logged no-op, the callables
> return `{ configured: false }` and the admin card reads "not configured."

## How it works

### Transport (`functions/src/parkos.js`)

REST/**JSON** over `https://api.parkos.com`, 12 s hard timeout.

- **Auth** — OAuth2 **client credentials** (Laravel Passport):
  `POST /oauth/token` with `grant_type=client_credentials` + `client_id` +
  `client_secret` → a Bearer JWT. The token is nominally valid for a **year**;
  we cache it in module memory only (never persisted — a bearer token for a live
  sales channel must not sit at rest in Firestore) and **re-mint it every 6 h**
  regardless, so a rotated secret can't keep working off a warm instance for
  months. A `401` on any call re-mints once and retries.
- **Rate limit** — the gateway advertises `X-RateLimit-Limit: 60` (per minute).
  A sync pass makes 1 token call + 1–2 list calls, so this is not a constraint.

| Endpoint | Verbs | Used for |
|---|---|---|
| `POST /oauth/token` | POST | The bearer token |
| `GET /v1/merchants` | GET,HEAD | Healthcheck probe — also verifies merchant **3079** is visible to these credentials |
| `GET /v1/reservations` | **GET,HEAD only** | **The poll** |
| `GET /v1/price_groups` | GET,HEAD | Not used yet — see [Discovered but not built](#discovered-but-not-built) |
| `GET/POST/PUT/DELETE /v1/prices` | | Not used yet |
| `GET/POST/DELETE /v1/availability` | | Not used yet |

`/v1/reservations` is **read-only**. Unlike ParkVia there is no no-show
report-back, no status push, and no way to tell Parkos anything at all.

### The reservations feed

`GET /v1/reservations[?page=N][&from=&till=&period_type=]`

- The three filter params are **all-or-nothing** — supplying `from` alone
  answers `404 "Period_type and Till parameters are required."`
- `period_type` accepts exactly `arrival | departure | created_at | updated_at |
  canceled_at | cancelled_at` (the service's own error text). We poll on
  **`updated_at`**, which gives proper modified-since semantics — a cancellation
  bumps `updated_at` too, so one query covers new, amended and cancelled rows.
- `from` / `till` are **date-granular and inclusive at both ends**. A time
  component is accepted but truncated, so an instant-precision cursor cannot be
  expressed — which is fine, because the poll is an overlapping window anyway.
- Page size is fixed at **100**; a `per_page` param is silently ignored. Follow
  `paginator.total_pages` with `page`.
- **An empty result set is HTTP 204 No Content**, not a 200 with an empty list.

### The sync pass (`runParkosSync`, `functions/src/index.js`)

1. Compute the window: `parkosWindowDays` — a **3-day rolling overlap**,
   stretched to cover poller downtime (gap since `lastSyncAt` + a day of
   margin), capped at 365 days; never synced → the full year. `parkosWindowRange`
   turns that into `from`/`till`, with **`till` a day past today** because
   `updated_at` is UTC while the service filters on its own calendar.
   The overlap is deliberate — see [Gotchas](#gotchas--edge-cases).
2. Fetch every page in the window (`period_type=updated_at`).
3. Map each row through `mapParkosReservationToImport`. An unmappable row is
   counted as an error and skipped, never aborting the batch.
4. **Triage from the `parkosImports/{code}` ledger** before doing any work: a
   ref that is already handled *and* whose `updated_at` hasn't moved since we
   last saw it skips cheaply, without a write and without touching the counters.
5. Two guards, then the action (see [The two guards](#the-two-guards)):
   a transactional triage on the ledger returns `import` (claim taken) /
   `record` (arrived already cancelled — ledger row only) / `busy` (another
   runner's claim is fresh) / `reconcile` (booking exists). A claim whose import
   died (`bookingId` still null) goes **stale after 10 min** and is re-claimed,
   so a failed import is retried rather than poisoned.
6. The summary (`{ imported, linked, skipped, cancelled, amended, errors }`)
   lands on `parkosSync/state.lastResult`.

### The two guards

The Parkos account **already holds the reservations staff have been entering by
hand**, so switching the importer on naively would duplicate them. Two guards
make it safe — and unlike ParkVia's one-shot prime, they do it without going
blind to reservations nobody typed in yet.

1. **Historical guard** — a reservation whose **stay has already ended** is
   recorded in the ledger and never imported. No retro-backfill, so no
   duplicates of the manual-desk era.
2. **Twin guard** — before creating anything, look for a booking staff already
   entered for the **same plate on the same Bucharest arrival day** that isn't
   cancelled and isn't claimed by a different Parkos reservation, and **adopt**
   it: stamp the `parkos` trail on it, point the ledger at it, and audit-log
   `parkos_linked`. Plate + arrival day is the only key available (the desk
   never records the Parkos code) and is strong enough — the same car arriving
   twice in one day is not a real scenario. This also covers the transition
   period, while staff still type some reservations by hand.

A `parkos.ref` self-heal runs first (a previous run created the booking but died
before linking the ledger), exactly as in the ParkVia importer.

The dry-run against the live account on 2026-08-06 predicted **5 historical,
3 linked, 1 imported, 0 errors** — the one import being a genuinely
un-entered upcoming reservation (see [History](#history)).

### Mapping (`mapParkosReservationToImport` — the isolated adapter)

Pure function, no I/O, unit-tested against a real captured record
(`functions/test/parkos.mapper.test.js`). Everything schema-specific lives here
so the rest of the pipeline stays generic. It **throws** when a load-bearing
field (code, plate, either date) is missing, so the pass counts an error and
skips rather than importing garbage.

- **Dates** — `arrival_date` + `arrival_time` (and the departure pair) arrive as
  **separate halves of naive wall-time** in the car park's zone. Read as
  **Europe/Bucharest** and resolved to real instants via `bucharestWallToIso`
  (shared with the ParkVia adapter in `functions/src/roTime.js`). Verified
  to the minute against desk-entered twins of three live reservations —
  e.g. `2026-07-31 23:00` ↔ `startDate 2026-07-31T20:00:00Z` (EEST, +03:00).
- **Days** — the feed's own `days` wins: it's the unit the customer was billed
  on. `deriveDays` (the app's 24 h + single 2 h grace rule) is the fallback.
  Spot-checked against every live record — the two agreed on all of them.
- **Price** — `total_price` is **Parkos's customer price, not our net**.
  `paid: false` means money the desk must still collect, surfaced in the booking
  notes (`Parkos: de încasat {amount} {currency} la sosire`).
- **Status** — there is no status enum. A non-null `cancelled_at` is the only
  cancellation signal there is.
- **No email.** Parkos sends name + phone + language only.
- Plate upper-cased + stripped, `persons` → passengers,
  `flight_departure_nr` / `flight_return_nr` → the flight-number fields
  ([trip-info](trip-info.md)), `car_brand_model` and any `products` / `fees`
  folded into the desk note.

### The imported booking

Imports call `createBrokerBookingCore`, so they are ordinary broker bookings:
`source: 'broker'`, `paymentMethod: 'broker'`, `paidBy: 'broker'`,
`paymentStatus: 'paid'`, `billing: null` — **no cashbook entry, no SmartBill
document** (Parkos bills the customer). A spot is reserved immediately and
`booking_created` is audit-logged.

The importer sends **no email of its own**: the `onBookingCreated` trigger and
`adminNotifyBookingCreated` fire off the doc create like any other booking.
Because Parkos supplies no email address, the **customer confirmation is skipped
for want of a recipient** while the rezervari@ ops alert still fires — the same
behaviour as an emailless ParkVia reservation.

### Reconciliation (safe-by-default)

Identical policy to [ParkVia's](parkvia.md#reconciliation-safe-by-default):

- **Cancellation** — only a still-`upcoming` booking is auto-cancelled (status →
  `cancelled`, spot released, `booking_cancelled` audit). A car already
  `active` / `completed` is **flagged for manual review**
  (`parkos.lastStatus: 'cancelled-needs-review'` + a
  `parkos_cancel_needs_review` audit row), never silently released.
- **Amendment** — only **safe fields** auto-apply, and only while `upcoming`:
  drop-off / pick-up and the recomputed `days`. Price and plate changes are left
  for manual review.
- A reservation that arrives already cancelled records a ledger row and creates
  no booking.

## Key files

| File | Role |
|---|---|
| `functions/src/parkos.js` | Transport, OAuth token cache, config gate, endpoints, the isolated mapper + pure helpers |
| `functions/src/roTime.js` | Europe/Bucharest wall-time + billing-days rules, **shared with the ParkVia adapter** |
| `functions/src/index.js` | `runParkosSync`, `findParkosTwinBooking`, `reconcileParkosBooking`, `createBrokerBookingCore`, the two callables |
| `functions/src/scheduled.js` | `pollParkosBookings` (`every 15 minutes`) — just the schedule |
| `src/services/parkosService.js` | Client wrappers for the two admin callables |
| `src/pages/admin/AdminPricing.js` · `AdminCheckIns.js` | The admin card / the combined broker Sync-now button |
| `functions/test/parkos.mapper.test.js` | Mapper + window unit tests — `cd functions && npm test` |
| `src/i18n/{ro,en}.js` | `parkos.*` and `brokerSync.*` keys |

## Data (Firestore)

- **`bookings.parkos`** — server-written import trail:
  `{ ref, importedAt, lastStatus }`, plus `linkedExisting: true` when the twin
  guard adopted a desk-entered booking rather than creating one.
  `lastStatus ∈ 'active' | 'cancelled' | 'amended' | 'cancelled-needs-review'`.
  Rules reject any client write touching `parkos` (alongside `parkvia` and
  `smartbill`).
- **`parkosImports/{code}`** — the authoritative **dedup ledger**, one doc per
  Parkos reservation code (doc id sanitized by `parkosRefDocId`):
  `{ ref, bookingId, importedAt, claimAt, lastStatus, lastSeenAt, lastUpdatedAt,
  lastRaw }`. Claimed transactionally before a booking is created, so the poller
  and a concurrent "Sync now" can't double-import; `claimAt` ages out (10 min)
  so a died-mid-import claim is retried; `lastUpdatedAt` is the feed's
  `updated_at` as last handled *for this ref* — the per-ref stamp the
  overlap-window triage compares against. `lastStatus: 'historical'` marks a
  row the historical guard declined. Staff read; server-written only.
- **`parkosSync/state`** — the poll state:
  `{ lastUpdatedAt, lastWindow, lastSyncAt, lastRunAt, lastResult, lastError }`.
  `lastUpdatedAt` is a diagnostics high-water mark, **not** a poll cutoff — the
  window is computed from `lastSyncAt`. Staff read; server-written only. A
  dedicated collection rather than `settings/*` because the shared
  `settings/{doc}` rule allows admin client writes — server state must not.

See [data-model.md](../backend/data-model.md) and
[security-rules.md](../backend/security-rules.md).

## Server (Cloud Functions)

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `pollParkosBookings` | scheduled (`every 15 minutes`) | — | Drives `runParkosSync('scheduled')` |
| `parkosSyncNow` | callable | `assertStaff` | One import pass on demand (takes no client input) |
| `parkosHealthcheck` | callable | `assertAdmin` | Config + `/v1/merchants` reachability + last sync result |

All three bind `PARKOS_SECRETS`.

## Where it surfaces

- **`/admin/checkins`** — the **Sync now** button next to the New-reservation
  CTA now runs **both** broker channels (ParkVia + Parkos) and reports one
  combined toast. Staff at the desk don't care which aggregator a reservation
  came through; each channel runs independently, and an unconfigured or failing
  one is folded into the summary instead of hiding the other's results.
- **`/admin/pricing`** — the Parkos card: **Check connection**
  (`parkosHealthcheck`, `assertAdmin`) and **Sync now**, beside the ParkVia card.
- Imported reservations then appear like any other broker booking on the
  check-in board, the capacity map and the transactions ledger.

## Go-live

The code is built, tested and dry-run against the live account, but the poller
stays inert until the secret is set:

1. `firebase functions:secrets:set PARKOS_CLIENT_SECRET` (the value is in the
   gitignored `documentation/Parkos.md`).
2. `cd functions && firebase deploy --only functions`
3. `firebase deploy --only firestore:rules` — the new `parkosImports` /
   `parkosSync` collection rules and the `parkos` field guard.
4. `/admin/pricing` → **Check connection** on the Parkos card. Green means live.

`PARKOS_CLIENT_ID=1610`, `PARKOS_MERCHANT_ID=3079` and `PARKOS_BASE_URL` are
already in `functions/.env.mango-parking` (non-secret config, same split as
`PARKVIA_*`).

## Gotchas / edge cases

- **An empty result is 204, not an empty 200.** `res.json()` on a quiet poll
  would throw; `parkosRequest` returns `null` for 204 and the envelope helper
  turns that into an empty list.
- **`data` is an object, not an array.** The envelope's `data` is a
  JSON-encoded PHP array — `{"0":{…},"1":{…}}`. `Object.values` is mandatory;
  treating it as an array silently yields nothing.
- **The filter trio is all-or-nothing** and `period_type` only accepts the six
  documented values — anything else is a 404 with the accepted list in the body.
- **`cancelled_at` is not in the same format as `created_at` / `updated_at`.**
  The latter two are UTC ISO (`2026-07-31T15:07:30.000000Z`); `cancelled_at` is
  a space-separated **local** time in the service's own zone
  (`2026-06-18 10:49:00` = `08:49Z`). The mapper therefore only ever reads it as
  a **boolean** — never parse it as an instant.
- **No no-show report-back, ever.** `/v1/reservations` is GET-only; there is
  nothing to call. A Parkos customer who never shows is handled entirely on our
  side (`markNoShows`), and Parkos is not told.
- **No customer email.** Those bookings skip the customer confirmation (no
  recipient) while the rezervari@ ops alert still fires. Don't assume an
  imported booking has a contact email.
- **Don't tighten the poll window.** It re-serves up to 3 days of rows on every
  run on purpose. The filter is date-granular so a precise cursor is impossible
  anyway, and the ParkVia PC90417080 incident (see
  [parkvia.md](parkvia.md#history)) is the standing lesson about strict cursors
  over feeds we don't control. Re-seen rows cost one ledger read each.
- **The historical guard is time-relative, not a one-shot prime.** There is no
  `primedAt` to protect: a reservation is skipped because its stay has *ended*,
  which stays true forever. Deleting `parkosSync/state` is therefore safe — it
  only widens the next window — unlike `parkviaSync/state`.
- **`total_price` is Parkos's customer price**, not our net revenue. Partner
  settlement / commission is out of scope (as with every broker path).
- **Broker bookings carry no billing** (`billing: null`) → no proforma, no
  invoice, no cashbook row.
- **`paid: false` means money to collect at the desk**; it lives in the booking
  notes, not in any money field.
- **`products` / `fees` shapes are unconfirmed** — both arrays were empty on
  every record captured so far. The note builder summarises them defensively and
  degrades to compact JSON rather than `[object Object]`.
- **The twin guard adopts a booking; it does not merge one.** The adopted
  booking keeps its own `code`, price and `brokerName` (which may be `null` if
  staff filed it as an ordinary admin entry). Only the `parkos` trail is added —
  after which Parkos cancellations and date amendments reconcile onto it like
  any import.

## History

- **2026-08-06 — built.** The client supplied only `client_id` / `client_secret`
  with no documentation, so the entire API surface was mapped live: the Passport
  token endpoint, the endpoint list and their allowed verbs (via `OPTIONS`), the
  filter trio and its accepted `period_type` values (from the service's own 404
  bodies), the 204-on-empty behaviour, the `data`-as-object envelope, and the
  reservation schema. The Bucharest wall-time convention was confirmed by
  matching three live reservations to the minute against the bookings staff had
  typed for them by hand.
- The dry-run also surfaced a real operational finding: **`B2MB6B33` (plate
  `AB06VIT`, arriving 2026-08-23)** existed in Parkos but had **never been
  entered into the system** — the first live sync imports it.

## Discovered but not built

The account's credentials also reach two **writable** resources, which is a
distinct feature (pushing our pricing and capacity out to a live sales channel)
and deliberately out of scope for the import:

- **`/v1/price_groups`** (GET) — Parkos-side seasonal groups, already mirroring
  our seasonal periods by name ("Default", "Vara 2026", "Toamna 2026",
  "Iarna 2026") with `from`/`until` dates and a `merchant_id`.
- **`/v1/prices?price_group_id=`** (GET/POST/PUT/DELETE) — the per-day-count
  tariff inside a group: `{ day, parking_type, location_type, price, currency }`,
  days 1–30. This is the same shape as our `settings/longTermRates` tiers, so
  syncing `/admin/pricing` → Parkos is mechanically straightforward.
- **`/v1/availability`** (GET/POST/DELETE) — currently empty (204). Presumably
  date-range closures / capacity caps.

Nothing writes to these today. Doing so means our admin becomes the source of
truth for a third party's live prices, so it needs an explicit decision, a
dry-run mode and an audit trail before it ships.

## Planned / not built

- **Price + availability push** — see above.
- **Partner settlement / commission tracking** — deferred, matching every other
  broker path.
- **Push / webhook delivery** — the API is poll-only as far as we know, so the
  15-minute cadence is the import latency.
