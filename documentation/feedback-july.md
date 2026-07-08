# Feedback — July 2026

A second client-feedback round (follows [feedback-june.md](feedback-june.md) /
[feedback-june-status.md](feedback-june-status.md)). Requests were captured
iteratively in working sessions rather than a single list, so this file is the
authoritative record: what changed, grouped by the clusters it was committed in.
Most server behaviour needs a **Functions deploy** — see **Deploy / activation**
at the bottom.

## Cluster A — Reservation dates, re-pricing & transfers

| Item | Resolution | Commits |
|------|-----------|---------|
| Editing a booking's dates should re-price it | Editing dates from the check-in tab recomputes the price (tier/seasonal-aware); the drop-off date can also be changed on **active / checked-in** bookings. | `29ce70b`, `ddefe68` |
| Round-trip transfers were hard to track | Return legs now surface **by date** in the check-in Transfers tab, and each leg (outbound / return) carries its **own status**. | `3ffd0f8`, `b23d711` |

## Cluster B — International phone entry

| Item | Resolution | Commits |
|------|-----------|---------|
| Phone numbers needed country codes | Every phone field uses an international **dial-code dropdown with SVG country flags**; the create-reservation modal's phone input was widened. A reservation **notes** field was added alongside. | `21cd235`, `fb534ad`, `5ebc266` |

## Cluster C — Activity page

| Item | Resolution | Commits |
|------|-----------|---------|
| Deep-link from activity didn't visibly land | The deep-link opens the reservation's **day** and **flashes the row** (made reliably visible via the Web Animations API); the custom range-picker icon no longer overlaps its value. | `58f085d`, `986c310`, `aabb91a` |
| Wanted past activity, not just upcoming | New **History tab** — past activity as collapsed rows that expand to full detail, with a date-range picker. | `1440793` |
| Click a client / reservation to see details | Client **names are clickable → profile** modal (client data + reservations); **reservation numbers are clickable → a reservation-detail popup** that also shows **who created it and when** ("Rezervare făcută de {name} pe {date}"). | `d3a222c`, `d205578` |

## Cluster D — User data export (for invoicing)

| Item | Resolution | Commits |
|------|-----------|---------|
| Export user data to issue invoices | Admins can export user data **in bulk or individually** as CSV (identity + spend totals). Bulk export is **customers only** (excludes admins/agents/drivers). Fixed the SPA router swallowing the `blob:`/download click. | `ac86a0b`, `6eac8e8`, `dd062a3` |

## Cluster E — Admin reservation capture

| Item | Resolution | Commits |
|------|-----------|---------|
| Billing mandatory when staff book for a client | **PF/PJ billing is required** on admin-created long-term reservations and credit-pack sales (prefilled from a matched customer's saved billing). | `66b47b5` |
| See a spot's reservation from the map | On the capacity map, clicking a **booked (occupied/reserved) spot** opens its reservation-detail popup (un-booked tiles keep the status-cycle). | `d139ba5` |
| Opening a booking's profile showed staff, not the customer | Fixed — resolves the customer identity. | `ea39bb4` |

## Cluster F — Passengers & flight numbers

| Item | Resolution | Commits |
|------|-----------|---------|
| Capture the party size | **Number of passengers (1–10)** dropdown on the long-term form (public + admin), stored on the booking for the shuttle. | `deffd71` |
| Capture flight numbers | Optional **flight-number field under each date** (departure under drop-off, return under pick-up). Public form has an **(i) tooltip** reminding the user to enter the real flight number, not the airline reservation code. Also on **admin** manual reservations (native-title tooltip). | `144ef9c`, `66a9948` |
| Warn when a flight is delayed / cancelled | Reservation rows on the **check-in board** and the **Activity** upcoming feed show a warning badge when the flight is delayed (≥15 min), cancelled, or diverted. Provider-agnostic + cached; **dormant until a flight-status API key is configured** — see [../functions/src/flightStatus.js](../functions/src/flightStatus.js). | `a37e3d4` |

## Cluster G — Fixes & polish

| Item | Resolution | Commits |
|------|-----------|---------|
| Closed-cashbook print was an unreadable PDF | Print now renders from an isolated iframe with a self-contained document. | `a9dc510` |
| Nicer time picker | The date/time picker's hour selector is a **rentalcars-style horizontal slider** (a draggable HH:MM pill) instead of the number spinner. | `8aedf56` |

## New booking / user fields (server-written)

- `bookings`: `passengers` (1–10 | null), `flightNumberDropoff`, `flightNumberPickup` (upper-cased, capped, null when blank).
- Admin-created long-term bookings + credit sales now always carry a real `billing` object (PF/PJ) instead of a hardcoded `{type:'PF'}`.
- New server-only collection `flightStatusCache/{provider_FLIGHTNO_DATE}` (15-min cache; never read by clients — no rules change).

## Deploy / activation

- **Frontend** (all funnel/admin/i18n/picker changes): ships on push to `main` (Vercel).
- **Cloud Functions** — `firebase deploy --only functions`. Needed for anything that persists server-side:
  - Billing on admin reservations (`adminCreateLongtermBooking`, `grantCreditsForCash`).
  - Passengers + flight numbers (`createBookingFromOrder`, reached via `netopiaCallback` / `adminMarkOrderPaid` / `repayOrder` / `createPayment`, plus `adminCreateLongtermBooking`).
  - New flight-status callable (`lookupFlightStatuses`).
  Until deployed, the frontend still works — the new fields just aren't stored and no flight warnings show.
- **Flight-status warnings** stay **dormant** until a provider + key are set (dotenv `functions/.env.mango-parking` or a bound Gen2 secret): `FLIGHT_API_PROVIDER`, `FLIGHT_API_KEY`. Adapters included for AeroDataBox (recommended) and AviationStack. See the header of `functions/src/flightStatus.js`.

## Not done / follow-ups

- Deeper refresh of the [admin-flows/](admin-flows/) walkthroughs for the pages that changed this round (Activity, Capacity, check-in board, create-reservation) — this round doc covers the changes; the step-by-step flows still describe the pre-round UI in places.
- Verify/tighten the chosen flight-status adapter against a real provider response once a provider is picked.
