# ParkVia (ParkCloud) auto-import

> Status: ✅ Shipped — **live in production since 2026-07-23** · Last verified: 2026-07-27

## What it is

Reservations booked through **ParkVia** land in `/admin` automatically as
[broker bookings](long-term-bookings.md), instead of being re-typed at the desk.
A scheduled job polls ParkVia's **ParkCloud Operator API** every 15 minutes,
imports new reservations, reconciles cancellations and amendments, and reports
no-shows back to ParkVia.

The manual path still exists and is unchanged — the "Broker / prepaid" sub-mode
of the New-reservation modal — and both routes produce **identical** booking docs
because they share one primitive (`createBrokerBookingCore`).

> **Config-gated, not dormant.** `parkviaConfig().configured` is false without
> ParkCloud credentials, and then the poller is a logged no-op, the callables
> return `{ configured: false }` and the admin card reads "not configured". That
> gate is what made the scaffold safe to deploy before onboarding; **production
> is configured** (secrets `PARKVIA_SUBSCRIPTION_KEY` + `PARKVIA_OPERATOR_KEY` in
> Secret Manager, `PARKVIA_PARKING_ID=15777` + `PARKVIA_BASE_URL` in
> `functions/.env.mango-parking`). Onboarding history:
> [parkvia-setup-steps.md](../parkvia-setup-steps.md).

## How it works

### Transport (`functions/src/parkvia.js`)

REST/**XML** over Azure API Management, 12 s hard timeout, `xml2js` with
`stripPrefix` (ParkCloud namespaces child elements) and nil-aware text
extraction (`xmlText` — `<Field i:nil="true"/>` must read as `''`, not
`"[object Object]"`).

- **Auth** — the APIM subscription key goes in the `Ocp-Apim-Subscription-Key`
  header; the ParkCloud operator key is the **`key` query parameter**. There is
  no operator-key header.
- **Base** — `https://parkcloud.azure-api.net` + `/rest/operator/v1.svc`.

| Endpoint | Used for |
|---|---|
| `GET /operators` | Healthcheck probe — also verifies operator **15777** is visible to these credentials |
| `GET /operator/{id}/bookings/events/since/{eventId}` | The poll cursor — booking-change events |
| `GET /operator/{id}/bookings/events/age/{hours}` | First-run window (720 h, verified live) |
| `GET /operator/{id}/booking/{reference}` | Full current state of one booking — what the mapper consumes |
| `PUT /operator/{id}/booking/{reference}/NoShow` | Register No Show (verb probed live; needs an explicit empty body so IIS gets a `Content-Length`) |

### The sync pass (`runParkviaSync`, `functions/src/index.js`)

ParkCloud is **event-based**, not modified-since: `NEW` / `AMEND` / `CANCEL` /
`NOSHOW` rows with monotonically increasing ids. `parkviaSync/state.lastEventId`
is the cursor.

1. **First run primes and imports nothing** (go-live decision 2026-07-23): the
   account already held ~3 weeks of reservations staff had entered by hand, so a
   backfill would have duplicated them. The pass records the newest event id +
   `primedAt` and stops. Production's prime returned
   `{"configured":true,"primed":true,"seenEvents":41,"imported":0,"errors":0}`.
2. Fetch events since the cursor. Several events for the same reference
   **collapse to one details fetch** — Get Booking Details always returns the
   current state, so replaying intermediate events would be redundant.
3. Per reference: fetch details → `mapParkviaBookingToImport` → skip `ENQUIRY`
   **without claiming the ledger** (a later CONFIRMED event can still import it)
   → transactionally claim `parkviaImports/{ref}` → import or reconcile.
4. The cursor advances over the whole batch and the summary
   (`{ imported, skipped, cancelled, amended, errors }`) lands on
   `parkviaSync/state.lastResult`.

### Mapping (`mapParkviaBookingToImport` — the isolated adapter)

Pure function, no I/O, unit-tested against a real-shaped fixture. Everything
schema-specific lives here so the rest of the pipeline stays generic. It
**throws** when a load-bearing field (reference, plate, either date) is missing,
so the pass counts an error and skips rather than importing garbage.

- **Dates** — `ArrivalDate` / `DepartureDate` arrive as naive wall-time
  (`2026-07-20T11:00:00`, no offset). `parkcloudLocalToIso` reads them as
  **Europe/Bucharest** and resolves the EET/EEST offset for that date, matching
  the app-wide timezone convention.
- **Days** — `deriveDays` mirrors the app's billing-days rule (24 h + a single
  2 h grace, minimum 1).
- **Price** — `totalPrice = AmountPaid + AmountDue`. This is **ParkVia's customer
  price, not our net**. `AmountDue > 0` is pay-on-arrival money the desk must
  still collect, surfaced in the booking notes
  (`ParkVia: de încasat {amount} {currency} la sosire`).
- Plate upper-cased + stripped, contact email lower-cased, passengers =
  `Passengers + PassengersChild + PassengersInfant`, `OutboundFlight` /
  `ReturnFlight` → the flight-number fields ([trip-info](trip-info.md)).

### The imported booking

Imports call `createBrokerBookingCore`, so they are ordinary broker bookings:
`source: 'broker'`, `paymentMethod: 'broker'`, `paidBy: 'broker'`,
`paymentStatus: 'paid'`, `billing: null` — **no cashbook entry, no SmartBill
document** (ParkVia bills the customer). A spot is reserved immediately, the
plate is added to the customer's profile when the contact email resolves to an
account, and `booking_created` is audit-logged.

The importer sends **no email of its own**: the `onBookingCreated` trigger
(customer confirmation) and `adminNotifyBookingCreated` (rezervari@ ops alert)
fire off the doc create like any other booking.

### Reconciliation (safe-by-default)

- **Cancellation** — only a still-`upcoming` booking is auto-cancelled (status →
  `cancelled`, spot released to `available`, `booking_cancelled` audit). A car
  already `active` / `completed` is **flagged for manual review**
  (`parkvia.lastStatus: 'cancelled-needs-review'` + a
  `parkvia_cancel_needs_review` audit row), never silently released.
- **Amendment** — only **safe fields** auto-apply, and only while `upcoming`:
  drop-off / pick-up dates and the recomputed `days`. Price and plate changes
  are left for manual review. (ParkCloud's amendment signalling is the one
  provisional area left — see [Gotchas](#gotchas--edge-cases).)
- A reservation that arrives already cancelled records a ledger row and creates
  no booking.

### No-show report-back

`reportParkviaNoShowSafe` (`index.js`) calls Register No Show for
ParkVia-imported bookings from **both** no-show paths — the hourly `markNoShows`
detector and `cancelBookingWithRefund`'s no-show conversion. Best-effort and
once per booking: success stamps `parkvia.noShowReportedAt` + a
`parkvia_noshow_reported` audit row, failure stamps `parkvia.noShowReportError`.
The `NOSHOW` event ParkCloud then emits is a harmless echo — the next sync
re-fetches details and reconciles to `unchanged` (Status stays `CONFIRMED`, only
`IsNoShow` flips).

### Where it surfaces

- **`/admin/checkins`** — a **Sync now** button next to the New-reservation CTA
  (`parkviaSyncNow`, `assertStaff` — agents and drivers man this board).
- **`/admin/pricing`** — the ParkVia card: **Check connection**
  (`parkviaHealthcheck`, `assertAdmin` — config + reachability + last sync) and
  **Sync now**.
- Imported reservations then appear like any other broker booking on the
  check-in board, the capacity map and the transactions ledger.

## Key files

| File | Role |
|---|---|
| `functions/src/parkvia.js` | Transport, config gate, endpoints, the isolated mapper + pure helpers |
| `functions/src/index.js` | `runParkviaSync`, `reconcileParkviaBooking`, `reportParkviaNoShowSafe`, `createBrokerBookingCore`, the two callables |
| `functions/src/scheduled.js` | `pollParkviaBookings` (`every 15 minutes`) — just the schedule |
| `src/services/parkviaService.js` | Client wrappers for the two admin callables |
| `src/pages/admin/AdminPricing.js` · `AdminCheckIns.js` | The admin card / the Sync-now button |
| `functions/test/parkvia.mapper.test.js` | Mapper unit tests — `cd functions && npm test` |
| `src/i18n/{ro,en}.js` | `parkvia.*` keys |

## Data (Firestore)

- **`bookings.parkvia`** — server-written import trail on imported bookings:
  `{ ref, importedAt, lastStatus }` plus `noShowReportedAt` /
  `noShowReportError` once a no-show is reported. `lastStatus ∈ 'active' |
  'cancelled' | 'amended' | 'cancelled-needs-review'`. Rules reject any client
  write touching `parkvia` (alongside `smartbill`).
- **`parkviaImports/{ref}`** — the authoritative **dedup ledger**, one doc per
  ParkVia booking reference (doc id sanitized by `parkviaRefDocId`):
  `{ ref, bookingId, importedAt, lastStatus, lastSeenAt, lastRaw }`. Claimed
  transactionally before a booking is created, so the poller and a concurrent
  "Sync now" can't double-import. Staff read; server-written only.
- **`parkviaSync/state`** — the poll cursor and run state:
  `{ lastEventId, primedAt, lastSyncAt, lastRunAt, lastResult, lastError }`.
  Staff read; server-written only. A dedicated collection rather than
  `settings/*` because the shared `settings/{doc}` rule allows admin client
  writes — a server cursor must not.

See [data-model.md](../backend/data-model.md) and
[security-rules.md](../backend/security-rules.md).

## Server (Cloud Functions)

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `pollParkviaBookings` | scheduled (`every 15 minutes`) | — | Drives `runParkviaSync('scheduled')` |
| `parkviaSyncNow` | callable | `assertStaff` | One import pass on demand (takes no client input) |
| `parkviaHealthcheck` | callable | `assertAdmin` | Config + `/operators` reachability + last sync result |

All three bind `PARKVIA_SECRETS`; `markNoShows` and `cancelBookingWithRefund`
bind them too, for the no-show report-back.

## Gotchas / edge cases

- **No historical backfill.** The prime is one-shot on `primedAt`. Deleting
  `parkviaSync/state` would re-prime and **silently skip** every event in
  between — never clear it to "force a resync"; use Sync now.
- **An errored reference is not retried.** The cursor advances across the whole
  batch even when a row throws (a poisoned reservation must not wedge the
  cursor), so a mapping failure is counted in `errors` + logged and only
  reconsidered if ParkVia emits another event for that reference.
- **`totalPrice` is ParkVia's customer price**, not our net revenue. Partner
  settlement / commission is out of scope (as with the manual broker path).
- **Broker bookings carry no billing** (`billing: null`) → no proforma, no
  invoice, no cashbook row. Don't assume every booking has an invoice identity.
- **Some ParkVia reservations arrive without a customer email**, which is why
  the broker path treats email as optional; those bookings skip the customer
  confirmation (no recipient) while the rezervari@ ops alert still fires.
- **Amendment signalling is the one provisional area.** Only dates auto-apply,
  and only while `upcoming` — a price or plate change needs a human.
- **Cancelling a car that already arrived is never automatic** — it lands as
  `cancelled-needs-review` for staff to resolve.
- **`AmountDue > 0` means money to collect at the desk**; it lives in the
  booking notes, not in any money field.

## History

The integration shipped first as a dormant, provisional scaffold and was
finalized against the real API on 2026-07-23 — the auth model, the event-based
sync, the `<Booking>` schema (namespaced `Vehicle→Registration`, `i:nil` empties,
naive local dates) and the Register-No-Show verb were all confirmed live (raw
captures in the gitignored `documentation/parkvia-response.txt`; mapper tests
rewritten against the real shape, 10/10). Step-by-step onboarding record:
[parkvia-setup-steps.md](../parkvia-setup-steps.md).

## Planned / not built

- **Partner settlement / commission tracking** — deferred, matching the manual
  broker path.
- **Push / webhook delivery** — ParkCloud is poll-only as far as we know, so the
  15-minute cadence is the import latency.
