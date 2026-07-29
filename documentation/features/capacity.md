# Capacity & Parking Spots

> Status: ✅ Shipped · Last verified: 2026-07-09

The parking lot's spot inventory, live occupancy numbers, automatic spot
reservation on booking, and the interactive `/admin/capacity` zone map. Related:
[`cashbook-refunds.md`](./cashbook-refunds.md) (cancellation releases a spot),
`../backend/cloud-functions.md` (booking callables that reserve spots).

## What it is

- The lot has **`TOTAL_CAPACITY = 110`** spots (`src/utils/constants.js:1`),
  each stored as a `spots/{id}` doc with a `status`.
- A spot is in one of four states — `available`, `occupied`, `reserved`,
  `maintenance` (`SPOT_STATUSES` / `SPOT_COLORS`).
- The **live capacity** headline (available / occupied) is derived by
  aggregating the `spots` collection — never from a stored counter, which can
  drift.
- Paid bookings **auto-grab the first free spot** at creation time
  (`reserveAvailableSpot`); admins can hand-assign or override any tile from the
  map.

## How it works

### Deriving occupancy

`src/services/capacityService.js` is the single source of truth. `aggregateSpots()`
rolls a snapshot into `{ total, occupied, reserved, maintenance, available }`.
Key rule: **`reserved` counts as not-available** — the headline available
counter is `total - (occupied + reserved) - maintenance`, matching the staff
mental model that a held spot isn't bookable.

- `getCapacity()` — one-shot count (falls back to `TOTAL_CAPACITY` with zero
  occupancy when the collection is empty).
- `subscribeCapacity(cb)` — real-time; re-aggregates on every `spots` snapshot.
- `updateSpotStatus(spotId, status)` — writes the new status, audit-logs
  `spot_updated`, and keeps the legacy `settings/global.occupiedSpots` counter in
  sync via an atomic increment (that counter is otherwise **ignored** by the
  aggregation — it exists only for backward compatibility).

### Reserving a spot on booking (server)

`reserveAvailableSpot(bookingId)` in `functions/src/index.js:198` picks the first
`status == 'available'` spot inside a Firestore transaction (so two concurrent
bookings can't grab the same one), flips it to `reserved`, and stamps
`currentBookingId`. Returns `null` if none free — callers then proceed **without**
a `spotId` (admin can assign later from the map). It's invoked from:

- `createBookingFromOrder` (`:285`) — only for **paid** bookings; pay-at-pickup
  reserves later, when admin flips the order to paid (`:782`).
- the admin direct long-term booking path (`:1199`, `:2376`).

The `booking.spotId` links a reservation to its tile.

### The `/admin/capacity` map

`src/pages/admin/AdminCapacity.js`:

- Loads all spots plus two label sources — `bookings` with `status in
  ['upcoming','active']` (upcoming = reserved tile, active = checked-in) and
  `activeCheckIns` (credit sessions) — and builds `plateBySpot` (tile → plate)
  and `bookingBySpot` (tile → the reservation occupying it). A check-in without a
  `spotId` on its booking still resolves via the check-in's `bookingId`.
- Tiles are grouped into four zones **A/B/C/D** (`ZONE_META`), extracted from the
  spot id prefix like `A-01` (or a `zone` field). Each tile shows its id and the
  occupying plate.
- **Click behaviour** (delegated on `[data-spot]`):
  - a **booked** tile (has a `bookingBySpot` entry) opens that reservation's
    detail popup via `openBookingDetail(booking)` — hand-cycling a
    booking-driven tile would only desync it, so it's disabled.
  - any **other** tile **cycles** its status `available → occupied → reserved →
    maintenance → …`, optimistically recolouring + updating the legend counts,
    then persisting through `updateSpotStatus` with **rollback on failure**.
- A `subscribeCapacity` subscription drives the live headline numbers, the
  used-capacity bar (`(occupied + reserved) / total`), and the legend counters,
  so tiles and totals stay in lockstep. Cleanup unsubscribes on route change.

## Key files

- `src/services/capacityService.js` — aggregation, subscription, spot writes.
- `src/pages/admin/AdminCapacity.js` — the zone map + status-cycle; a booked
  tile navigates to the reservation's full record
  (`/admin/transactions?booking=<id>`).
- `src/utils/constants.js` — `TOTAL_CAPACITY` (`:1`), `SPOT_STATUSES`, `ZONES`.
- `functions/src/index.js` — `reserveAvailableSpot` (`:198`) + its callers.
- `firestore.rules` — `spots` (`:170`): public read, `isStaff()` write.

## Data (Firestore)

- **`spots/{id}`** — `status` (`available` | `occupied` | `reserved` |
  `maintenance`), optional `zone`, `currentBookingId` (set by
  `reserveAvailableSpot`). Id convention encodes the zone, e.g. `A-01`.
- **`settings/global.occupiedSpots`** — legacy counter kept in sync by
  `updateSpotStatus`, but **not** read by the aggregation (drift-prone; retained
  for compat only).
- **`bookings.spotId`** — the reserved tile for a booking.
- **`activeCheckIns.spotId`** — best-effort tile for a credit check-in session.

## Server (Cloud Functions)

No dedicated capacity callable — spot reservation is a helper
(`reserveAvailableSpot`) called inside the booking/order fulfilment paths.
Cancellation (`cancelBookingWithRefund`) releases the held spot back to
`available` so the map updates immediately.

## Gotchas / edge cases

- **`reserved` is unavailable.** Both the headline available count and the
  progress bar treat `occupied + reserved` as consumed.
- **No free spot ≠ failed booking.** `reserveAvailableSpot` returns `null` and
  the booking is created without a `spotId`; the tile is assigned later
  (manually or on mark-paid). So a booking can exist with no map tile.
- **Booked tiles are read-only on the map** — clicking opens details rather than
  cycling status, to avoid desyncing the tile from its reservation.
- **Two occupancy sources, one truth.** Only the `spots` aggregation feeds the
  live numbers; `settings/global.occupiedSpots` is vestigial.
- Zone grouping relies on the `A-`/`B-`/… id prefix (or a `zone` field); spots
  that match neither fall outside all four zone grids.
