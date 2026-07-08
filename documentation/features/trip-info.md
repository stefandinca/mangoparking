# Trip Info: Passengers, Flight Numbers & Flight-Status Warnings

> Status: 🟡 Partial · Last verified: 2026-07-09

Optional trip metadata captured on long-term bookings — **passenger count** and
**flight numbers** — plus the **flight-status warnings** (delayed / cancelled /
diverted) those flight numbers unlock on the admin boards. The passenger/flight
capture is shipped; the flight-status warnings are **built but dormant** until a
flight API key is configured. Related: [`transfers.md`](./transfers.md) (flight
fields on transfers), `../backend/integrations.md` (flight API provider details).

## What it is

- On a long-term booking the customer/agent may record **passengers (1–10)** and
  two optional **flight numbers**: the departure flight (under drop-off) and the
  return flight (under pick-up). Purely informational — they don't affect price.
- These show in the reservation-detail popup and, more usefully, let the check-in
  board and Activity feed **flag a reservation whose flight is delayed/cancelled/
  diverted** so staff can anticipate a late arrival or a no-show.

## How it works

### Capture (public) — `src/pages/public/BookingLongTerm.js`

- A **passengers** `<select>` with options 1–10 (`BookingLongTerm.js:232`).
- A reusable `flightField(name)` (`:146`) rendered twice: `flightNumberDropoff`
  under the drop-off date (`:182`) and `flightNumberPickup` under the pick-up date
  (`:191`) — both optional, `maxlength=10`, upper-cased.
- On submit (`:1030`): `passengers` clamped to 1–10; `cleanFlight()` normalizes
  each flight (trim, upper, collapse spaces, cap 12); both ride along in
  `customerData` into `createPayment`.

### Capture (admin) — `src/components/admin/CreateTransactionModal.js`

The walk-in / create-transaction modal's long-term branch has the same three
inputs (`:183` dropoff flight, `:190` pickup flight, `:196` passengers 1–10). On
submit (`:1114`) they're cleaned identically and passed to the
`adminCreateLongtermBooking` callable as `passengers`, `flightNumberDropoff`,
`flightNumberPickup`.

### Persistence (server)

`createBookingFromOrder` (`functions/src/index.js:253`) writes
`passengers: sanitizePassengers(...)`, `flightNumberDropoff: sanitizeFlight(...)`,
`flightNumberPickup: sanitizeFlight(...)` onto the `bookings` doc; the admin
callable does the same. So every long-term booking carries these three fields
(possibly empty/null).

### Reservation-detail popup — `src/components/admin/BookingDetailModal.js`

`openBookingDetail(booking)` renders read-only rows for **Passengers** (`:110`),
**Flight (drop-off)** (`:113`) and **Flight (pick-up)** (`:114`). The generic
`row()` helper omits empty values, so absent flight/passenger data simply doesn't
appear. This popup opens from booking codes, the capacity map, etc.

### Flight-status warnings — `src/services/flightStatusService.js` (client)

The admin boards emit an empty warning slot next to a row that has a flight:

```html
<span data-flight-warn data-flight="RO201" data-flight-date="2026-07-10" data-flight-dir="departure"></span>
```

After rows mount, the page calls `enhanceFlightWarnings(containerEl)`, which:

1. Collects visible slots, normalizes the flight number, keeps only those whose
   date is a valid `YYYY-MM-DD` inside a **−2…+7 day** window.
2. Serves from a 10-minute client memo (`FLIGHTNO_DATE`), else batches the
   remainder to the `lookupFlightStatuses` callable.
3. Paints a badge when the flight is **cancelled**, **diverted**, or **delayed
   ≥ 15 min** (`flightWarning()`). Delay direction matters: check-in watches the
   **departure** delay, check-out the **arrival** delay.
4. If the server reports `configured === false` (no API key), it flips a module
   flag and goes fully **no-op** for the rest of the session.

- **Check-in board** (`AdminCheckIns.js:331`, `flightSlot`): the check-in tab
  watches the **departure** flight (`flightNumberDropoff`, drop-off day); the
  check-out tab watches the **arrival** flight (`flightNumberPickup`, pick-up
  day). `enhanceFlightWarnings(bodyEl)` runs after each render (`:888`).
- **Activity feed** (`AdminActivity.js:111`, `flightSlotEvent`): each timeline
  event carries the relevant flight for its kind; check-in-type events watch
  departure, check-out-type watch arrival, keyed on the event's own timestamp.
  Enhanced at `:325`.

### Server — `functions/src/flightStatus.js` (`lookupFlightStatuses` callable)

Provider-agnostic bridge, `europe-west1`, `assertStaff`-gated. With **no API key
configured it returns `{ configured: false }`** and the UI shows nothing — so it
deploys safely before a provider is chosen. When enabled (env
`FLIGHT_API_PROVIDER` + `FLIGHT_API_KEY`, or a Gen2 secret), it dedupes the batch,
drops out-of-window dates, and resolves each flight via a provider adapter
(`aerodatabox` on RapidAPI, or `aviationstack`), caching hits **and** misses in
`flightStatusCache/{provider_flight_date}` for 15 minutes so repeated admin views
don't re-bill the third party. Full provider/key details:
[`../backend/integrations.md`](../backend/integrations.md).

## Key files

- `src/pages/public/BookingLongTerm.js` — passenger + flight capture (`:146`,
  `:232`, `:1030`).
- `src/components/admin/CreateTransactionModal.js` — same fields, admin side
  (`:183`, `:196`, `:1114`).
- `src/components/admin/BookingDetailModal.js` — read-only display (`:110`,
  `:113`, `:114`).
- `src/services/flightStatusService.js` — client warning enhancer + badge.
- `functions/src/flightStatus.js` — `lookupFlightStatuses` callable (server).
- `src/pages/admin/AdminCheckIns.js` / `AdminActivity.js` — the boards that emit
  warning slots.
- `functions/src/index.js` — `sanitizePassengers` / `sanitizeFlight` on booking
  writes (`:253`).

## Data (Firestore)

- **`bookings`** — `passengers` (1–10), `flightNumberDropoff`,
  `flightNumberPickup` (normalized strings, may be empty/null). Carried through
  `pendingOrders.customerData` before fulfilment.
- **`flightStatusCache/{provider_flight_date}`** — `{ status, fetchedAt }`;
  15-min TTL; caches both found and not-found results. Written only when the
  flight API is enabled.

## Server (Cloud Functions)

`lookupFlightStatuses` (`functions/src/flightStatus.js:141`) — batch flight-status
lookup, staff-gated, dormant without a key. Input `{ items:[{ flightNumber, date }] }`,
output `{ configured, results: { "FLIGHTNO_DATE": normalized } }`.

## Gotchas / edge cases

- **Warnings are dormant by default.** With no provider key the callable returns
  `configured:false` and the client stops calling it — so on a stock deployment
  no flight badges ever appear even though flight numbers are captured and shown.
- **Direction matters.** A delayed *departure* flags the check-in row; a delayed
  *arrival* flags check-out. The delay threshold is **≥ 15 min**; cancelled /
  diverted always flag.
- **Windowed to avoid billing.** Both client and server ignore flights outside
  roughly −2…+7 days, so far-future or long-past reservations never trigger a
  lookup.
- **Fields are optional and free-typed.** A malformed flight number just yields a
  not-found (cached) result — never a wrong warning. Empty passenger/flight
  values are simply omitted from the detail popup.
- Flight numbers are normalized differently at capture (`cleanFlight`, cap 12)
  vs. lookup (`normalizeFlightNo`, strips non-alphanumerics) — the lookup form is
  what's sent to the provider.

## Planned / not built

- **Flight API provider not wired.** No key ships by default; choosing/enabling a
  provider (AeroDataBox or AviationStack) activates the warnings. See
  [`../backend/integrations.md`](../backend/integrations.md).
