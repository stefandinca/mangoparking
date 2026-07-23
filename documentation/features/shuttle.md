# ManGO buzz Shuttle & Opening Hours

> Status: 🟡 Partial · Last verified: 2026-07-09

The free on-demand airport shuttle ("ManGO buzz") — its public `/shuttle` page
and the `/admin/shuttle` status board — plus the admin-editable **office opening
hours** that drive the footer and the after-hours long-term booking gate.
Related: [`trip-info.md`](./trip-info.md) (flight numbers), `../backend/integrations.md`.

## What it is

- **Shuttle** — a free, on-demand minibus between the lot and the airport/train
  station. The public page presents it plus reference train and "popular flight"
  schedules; the admin page is a per-departure status board (departed / boarding
  / scheduled / delayed / cancelled).
- **Opening hours** — the front desk (agent-staffed) is open per an
  admin-configured weekly schedule stored on `settings/global.openingHours`
  (the *lot* itself is 24/7). These hours render the footer's weekly office-hours
  block and gate last-minute, after-hours long-term bookings behind a "please
  call us" modal.

## How it works

### Shuttle service — `src/services/shuttleService.js`

- `getShuttleSchedule()` / `subscribeShuttle(cb)` read the `shuttleSchedule`
  collection, **falling back to `MOCK_SHUTTLE`** (10 hard-coded departures) when
  the collection is empty or unreadable. `getTrainSchedule()` mirrors this with
  `MOCK_TRAINS`. `getPopularFlights()` returns a static `MOCK_FLIGHTS` array —
  no live data source.
- `getUpcomingDepartures(schedule, count)` filters to future, non-cancelled
  departures by `departureTime` string compare, wrapping to start-of-day if too
  few remain.
- `updateShuttleStatus(id, status)` writes `shuttleSchedule/{id}.status` and
  audits `shuttle_updated`. `getRouteKey(route)` maps route codes
  (`parking_to_airport`, …) to i18n keys.

### Public page — `src/pages/public/Shuttle.js`

Renders the on-demand blurb, a train-schedule table (from `getTrainSchedule`,
mock fallback) and a "flights today" table (static `getPopularFlights`). A 60s
interval is wired but currently a no-op (comment: "In production, this would
re-fetch").

### Admin board — `src/pages/admin/AdminShuttle.js`

Status summary cards (counts per status) plus a table of departures. Row actions
**delay / cancel / depart** optimistically restyle the status pill and persist
via `updateShuttleStatus`. The driver / passengers columns show `—` when the
schedule doc (or mock) lacks `driver` / `capacity`.

### Opening hours — `src/services/openingHoursService.js`

- Stored as `settings/global.openingHours = { mon:{open,close,closed}, …, sun }`;
  `normalize()` fills defaults (`08:00`–`20:00`, not closed). Module-level cache.
- `getOpeningHours()` (cached read), `saveOpeningHours(hours)` (merge-write via
  `setDocument`, audits `opening_hours_updated`) — edited from the Public website
  admin section (`/admin/website`).
- Timezone helpers use `Europe/Bucharest`: `bucharestTodayKey()` (`'mon'`..`'sun'`)
  and `bucharestNowHm()` (`"HH:MM"`, lexically comparable to open/close).
- `isOutsideOpeningHoursNow(hours)` — true when the desk is unstaffed now (closed
  day, or now `< open` or `>= close`). **Fails OPEN** (returns `false`) when no
  config is loaded, so a missed preload never wrongly blocks a booking.

### Where hours are consumed

- **Footer** (`src/components/core/Footer.js:17`) — `groupedHoursLines()`
  collapses contiguous same-hours days into lines like "Monday–Friday: 09:00–18:00"
  and labels a Sat+Sun run "Weekends". Showing the whole week (not just today)
  stops a closed day from reading as permanently closed. Patched in after the
  cached service resolves. A **`t('openingHours.callNote')`** line + `tel:` link to
  `CONTACT_PHONE` follows the hours ("for reservations outside working hours, please
  call before arriving"), then a **`t('openingHours.nightWeekendNote')`** line
  ("if you need us at night or on the weekend, call us:") + the same phone.
  Site-wide, so it shows on every public page.
- **Contact page** (`src/pages/public/Contact.js`) — full weekly table, with the same
  `openingHours.callNote` + phone line below it, followed by the
  `nightWeekendNote` line. The Home contact card (`Home.js`) shows the
  `nightWeekendNote` under its phone entry too, and the same sentence appears
  under the WhatsApp/phone contact block of the customer email templates
  (`booking-longterm-confirm`, `booking-repriced`, `booking-cancelled`,
  `signup-welcome`, both locales).
- **After-hours booking gate** (`src/pages/public/BookingLongTerm.js:929`) —
  `afterHoursGateBlocks()` fires when the drop-off is within `LAST_MINUTE_MS`
  **and** `isOutsideOpeningHoursNow()` is true: it opens a "call us" modal
  (`openAfterHoursModal`, tel: link to `CONTACT_PHONE`) and blocks leaving step 1,
  because a last-minute after-hours arrival can't self-service check-in — an
  agent must be dispatched. Also re-checked at submit.

## Key files

- `src/services/shuttleService.js` — schedule reads + status write + mocks.
- `src/services/openingHoursService.js` — hours model, cache, `Europe/Bucharest`
  helpers, `isOutsideOpeningHoursNow`.
- `src/pages/public/Shuttle.js` — public shuttle/train/flights page.
- `src/pages/admin/AdminShuttle.js` — admin status board.
- `src/components/core/Footer.js` — grouped weekly office-hours lines.
- `src/pages/public/BookingLongTerm.js` — after-hours "call us" gate (`:929`).
- `firestore.rules` — `shuttleSchedule` / `trainSchedule` (`:176`/`:182`): public
  read, `isStaff()` write.

## Data (Firestore)

- **`shuttleSchedule/{id}`** — `route` (`parking_to_airport` |
  `airport_to_parking` | `parking_to_train` | `train_to_parking`),
  `departureTime` (`"HH:MM"`), `dayOfWeek`, `status` (`scheduled` | `boarding` |
  `departed` | `delayed` | `cancelled`); optional `driver`, `capacity`.
- **`trainSchedule/{id}`** — `direction` (`to_bucharest` | `from_bucharest`),
  `departureTime`.
- **`settings/global.openingHours`** — `{ mon..sun: { open, close, closed } }`,
  times as `"HH:MM"`. Merge-written so other `settings/global` fields survive.

## Server (Cloud Functions)

None specific to the shuttle or opening hours — all reads/writes are client-side
under staff/admin Firestore rules. (Popular-flight *status* warnings on the admin
boards are a separate, dormant integration — see [`trip-info.md`](./trip-info.md).)

## Gotchas / edge cases

- **Mock fallbacks everywhere.** An empty `shuttleSchedule`/`trainSchedule`
  silently serves hard-coded mock rows; "popular flights" is *always* static.
  Numbers on both pages may not reflect real operations until the collections are
  seeded.
- **Opening-hours gate fails open.** If the config hasn't loaded,
  `isOutsideOpeningHoursNow` returns `false`, so bookings are never wrongly
  blocked — the trade-off is a genuinely-after-hours booking could slip through
  before the preload completes.
- **All comparisons are string-based** on `"HH:MM"` / weekday keys — correct only
  because the strings are zero-padded 24h and in `Europe/Bucharest`.

## Planned / not built

- **Admin shuttle add/edit is inert.** The `+ Add departure` button and the
  per-row **edit** action in `AdminShuttle.js` have no handlers (edit returns
  early); only delay/cancel/depart persist. Creating/editing departures isn't
  built yet.
- **Auto-refresh is a stub** on the public `/shuttle` page (60s interval does
  nothing).
