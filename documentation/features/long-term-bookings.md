# Long-term bookings (date-range reservations)

> Status: ✅ Shipped · Last verified: 2026-07-09

## What it is

A **long-term booking** is a dated reservation: the customer picks a
**drop-off → pick-up** range, the price comes from admin-managed per-day tiers
(with optional [seasonal overlays](pricing.md)), and they pay online, at pickup,
via a broker, or as a walk-in at the lot. It runs beside the
[credit](credits.md) product. Pricing detail lives in [pricing](pricing.md);
invoice identity in [billing](billing.md); discounts in [vouchers](vouchers.md).

## How it works

### Billing-days rule (24h + a single 2h grace)

Chargeable days are derived from the drop-off/pick-up **instants**, not calendar
dates:

```
billingDays = max(1, ceil((pickupMs - dropoffMs - GRACE_MS) / 24h))   // GRACE_MS = 2h
```

So 24h ≤ stay ≤ 26h → **1 day**; >26h ≤ 50h → **2 days**; etc. The 2h grace is
applied **once** across the whole booking. This is implemented identically on
the client (`src/pages/public/BookingLongTerm.js:33`, `GRACE_MS`) and on the
server guard (`functions/src/pricingValidate.js:38`, `billingDays`).

### Timezone convention (Europe/Bucharest everywhere)

A picked drop-off/pick-up wall-clock time **always means Europe/Bucharest**
(the lot's timezone), regardless of the device's timezone. Every conversion
between the picker's `Y-m-d H:i` value and the stored ISO instant goes through
`bucharestLocalToIso` / `isoToBucharestLocal` (`src/utils/date.js`) — in the
public funnel, the admin create-transaction modal, and the edit/reprice
dialog. Displays (emails, admin boards, booking detail) render pinned to
`Europe/Bucharest` for the same reason. Never convert picker values with a
bare `new Date(...)` — it is device-TZ-dependent and, for the space-separated
format, Invalid Date on Safari.

### Pricing (tiers + seasonal + online discount)

- **Default tiers** live at `settings/longTermRates`
  (`{ tiers: [{ minDays, maxDays|null, perDay }] }`), read by
  `longTermService.getLongTermRates()` and priced by `calculateLongTermCost`.
- **Seasonal overlays** (`seasonalPricing` collection) each carry a full tier
  table; the active period whose `[startDate, endDate]` contains the **pick-up
  day** wins (`seasonalRatesService.getEffectiveRates`). Pick-up wins so a stay
  straddling a boundary prices at the period it leaves on.
- **DB prices are the STANDARD (on-site) price.** Online payment applies a real
  `-X%` on top; pay-at-pickup pays the standard price. See [pricing](pricing.md).

Full detail + the server-authoritative recompute is in [pricing](pricing.md).

### The four payment paths

| Path | Entry | Booking created | `paymentStatus` | `paidBy` |
|---|---|---|---|---|
| **Online (Netopia)** | `BookingLongTerm.js` → `createPayment` → IPN | at IPN (`createBookingFromOrder`) | `paid` | `netopia` (or `voucher` if fully covered) |
| **Pay-at-pickup** | `BookingLongTerm.js` (method toggle) → `createPayment` | at order time | `unpaid` | `null` until collected |
| **Broker / prepaid** | admin `adminCreateLongtermBooking` (`paidBy:'broker'`) | immediately | `paid` | `broker` |
| | _Broker bookings capture no billing (the broker invoices the customer) and, since 2026-07-26, the client **email is optional** in the create modal (3rd-party reservations often arrive without one; a typed value must still be valid). Email-less bookings skip the customer confirmation (`resolveRecipient` → no-recipient) and the account invite; the rezervari@ ops alert still fires with "—" for the email._ | | | |
| | _**`brokerName` is editable** (2026-08-03) from the Edit reservation dialog, so an import or desk entry filed under the wrong broker can be corrected. The field is rendered **only on bookings that are already broker** — `brokerName` is itself one of the markers `isBrokerBooking()` reads, so offering it on an ordinary booking would let a typo silently reclassify it and strip the payment block from its confirmation email. ParkVia's amend reconcile only patches dates/days, so it never overwrites a staff edit to the name._ | | | |
| | _**Also optional when EDITING** (2026-08-03): the edit dialog demanded a valid email **and** phone, so a broker booking missing either could not be saved at all — staff couldn't correct a plate or a date because of a field the broker never sent. Empty contact fields are now accepted on a broker booking (anything typed is still validated) and the labels read "(opțional)". Ordinary bookings are unchanged — both stay mandatory. Recognition is `isBrokerBooking()` (`src/utils/brokerBooking.js`), the client mirror of the server predicate; `tests/brokerBooking.test.mjs` imports both copies and fails if they drift._ | | | |
| **Walk-in (cash/card)** | admin `adminCreateLongtermBooking` (`autoCheckIn`) | immediately + checked in | `paid` | `admin-cash` / `admin-card` |

**Online** — `createPayment` (`functions/src/index.js:310`) recomputes the
authoritative total (below), applies the online discount + any voucher, writes a
`pendingOrders` doc and hands off to Netopia. `netopiaCallback` (`:705`) creates
the booking (`createBookingFromOrder`, `:227`) as `paid` and reserves a spot.

**Pay-at-pickup** — `createPayment` creates the booking **now**
(`paymentStatus: 'unpaid'`, `paymentMethod: 'pay-at-pickup'`) plus a
`pendingOrders` doc, and short-circuits (no Netopia). It's payable later online
via `repayOrder` (`/pay`) — which stamps `repayAmount` so the IPN reconciles the
booking to the discounted charge — or collectable at the lot via
`adminMarkOrderPaid`. Pay-at-pickup bookings **reserve their spot only when
paid**, so an unpaid no-show never orphans a spot.

**Broker & walk-in** — both go through `adminCreateLongtermBooking`
(`index.js:2279`, `assertStaff`). `paidBy` ∈ `cash | card | broker | later`:
- `cash` → `admin-cash`, records a cashbook entry (`recordCashEntry`).
- `card` → `admin-card`, no cashbook (terminal reconciles).
- `broker` → `broker` marker + `source: 'broker'`, stores `brokerName`, no
  cashbook (money collected off-lot, e.g. ParkVia). **No billing, no SmartBill
  documents** (2026-07-21): the broker bills the customer, so the admin modal
  hides the billing block, the booking stores `billing: null`, and
  `adminCreateLongtermBooking` skips proforma issuance for `paidBy: 'broker'`.
  Both the manual desk flow and the two broker auto-imports (**ParkVia**,
  [**Parkos**](./parkos.md)) route through the
  shared `createBrokerBookingCore` primitive so all three produce identical
  docs — see [parkvia.md](./parkvia.md) (live since 2026-07-23) and
  [parkos.md](./parkos.md) (built 2026-08-06).
- `later` → unpaid reservation; creates a `pendingOrders` doc so it rides the
  same pay-at-pickup rails (online repay or collect at lot).
`autoCheckIn` flips the fresh booking to `active`, marks the spot `occupied`, and
writes `activeCheckIns/{plate}` in the same call.

### Public accordion flow (`BookingLongTerm.js`)

Steps: **dates → details (vehicle / passengers / contact) → billing →
payment method → voucher**, with a sticky blueberry summary card showing the
total, a per-line breakdown (subtotal, online discount, voucher) and the
terms/privacy consents. Live recompute (`recompute()`) reprices on every date
change, swaps in the seasonal tier table, and re-derives the online discount +
voucher. On submit it sends the **standard** `totalPrice` plus `dropoffAt` /
`pickupAt` (ISO) and date-only `startDate` / `endDate` (backward compat) to
`startNetopiaPayment` (`BookingLongTerm.js:1091`).

### After-hours "call us" gate (last-minute bookings)

A drop-off less than **8h** away (`LAST_MINUTE_MS`, `BookingLongTerm.js:31`)
made while the front desk is **closed now** (`isOutsideOpeningHoursNow` over
`settings/global.openingHours`) needs an agent dispatched, so self-checkout is
blocked and a **phone-call modal** (`openAfterHoursModal`) is shown instead. The
gate fires when leaving the dates step **and** is re-checked at submit (in case
time crossed the closing boundary). It fails **open** if the date or hours config
isn't loaded. See [commit `55c5b40`].

### Newer fields: passengers + flight numbers

The details step captures **passengers** (1–10, for the shuttle party size) and
optional **flight numbers** under each date (`flightNumberDropoff` /
`flightNumberPickup`). They flow through `customerData` and are sanitized
server-side (`sanitizePassengers` `index.js:2256`, `sanitizeFlight` `:2263`:
upper-cased, whitespace-collapsed, capped at 12 chars, `null` when blank).

## Booking lifecycle

```
upcoming ──check-in──▶ active ──check-out──▶ completed
   │                      │
   ├── cancelled (refund queue if paid)
   └── no-show (markNoShows scheduled detector)
```

- **Cancellation** — self-service (owner, `/account/bookings`) or staff
  (`cancelBookingWithRefund`). Paid → `refund-pending` (manual queue); the
  customer gets a **`booking-cancelled` confirmation email** (best-effort, with
  a "refund on its way" note when one was queued — the `booking-refunded` email
  follows when staff process it). The no-show conversion (drop-off >12h past,
  never arrived) forfeits the fee and sends no email.

- **Reprice / extension** — staff move a booking's dates on `/admin/checkins`
  (`adminRepriceBooking`). Unpaid → re-quote (collected at pick-up); when the
  total changed, the client is automatically emailed the new total
  (`sendBookingRequoteEmail`, same `booking-repriced` template with
  `requote:true` copy) with a pay-online link to the booking's own pending
  order (`/pay?orderId=<paymentId>`, discounted) or pay-at-arrival. Paid + more
  days → collect the difference now (cash/card), **or `email` the client a payment
  request**: the new dates apply immediately, the difference is tracked as owed
  (`extensionOwed`), and a `kind:'extension'` `pendingOrders` doc + a
  `booking-repriced` email let the client pay **online (with the online discount)**
  or **at arrival**. Both settle via `applyExtensionSettlement` (accrues
  `extensionPrice`, never re-marks the booking paid). Paid + fewer days → refund
  queue. Full mechanics in [backend/cloud-functions.md](../backend/cloud-functions.md).
- **Overstay** — a late pick-up is charged via the `adminChargeOverstay`
  callable; the rate is `settings/commuterPolicy.latePickupDailyRate`
  (default 49), applied per started day past the planned end
  (`longTermService.computeLateFee`).
- **No-show** — the `markNoShows` scheduled job flags upcoming bookings whose
  window passed without a check-in.
- **Spot reservation** — `reserveAvailableSpot` (`index.js:198`) grabs the first
  `available` spot → `reserved` in a transaction; check-in flips it to
  `occupied`; check-out frees it. Only **paid** bookings reserve at creation.

## Key files

| File | Role |
|---|---|
| `src/pages/public/BookingLongTerm.js` | Public accordion, live pricing, voucher, after-hours gate, Netopia handoff. |
| `src/services/longTermService.js` | `getLongTermRates` / `saveLongTermRates`, `calculateLongTermCost`, `getCommuterPolicy`, `computeLateFee`; client `createLongTermBooking` / `createCreditBooking` (legacy — see gotcha). |
| `src/services/seasonalRatesService.js` | Seasonal periods CRUD + `getEffectiveRates` / `findOverlap`. |
| `functions/src/index.js` | `createPayment`, `netopiaCallback`, `createBookingFromOrder`, `adminCreateLongtermBooking`, `reserveAvailableSpot`, `repayOrder`. |
| `functions/src/pricingValidate.js` | `computeAuthoritativeLongTermTotal` — server price guard. |

## Data (Firestore)

**`bookings/{auto}`** (long-term shape — `type: 'longTerm'`):
```
code, type, customerId | null, licensePlate,
startDate, endDate,          // date-only, backward compat
dropoffAt, pickupAt,         // ISO instants (canonical)
days, passengers, flightNumberDropoff, flightNumberPickup,
basePrice, latePrice, totalPrice,   // totalPrice = amount actually charged
status,                      // upcoming | active | completed | cancelled
contact: { name, email, phone }, billing: {...},
paymentId,                   // pendingOrders ref
paymentMethod,               // online | pay-at-pickup | admin | broker
paymentStatus,               // paid | unpaid
paidAt, paidBy,              // netopia | voucher | admin-cash | admin-card | broker | null
brokerName, notes, spotId, source,  // web | admin | broker
createdAt, completedAt, createdBy
```
`totalPrice`/`basePrice` carry the **charged** amount (online-discounted or
standard); a voucher-discounted booking keeps the gross on the order and the net
on the booking.

**`pendingOrders/{ord_…}`** — order staging: the full `createPayment` body plus
`amount` (charged), `voucherAmount`, `promoVoucherCode`, `voucherDaysUsed`,
`status`, `paymentMethod`, `bookingId`, `repayAmount`. The IPN and
`adminMarkOrderPaid` both replay it. See [data-model reference in Brief](../../Brief.md#6-firestore-collections-principal).

**`settings/longTermRates`**, **`seasonalPricing`**, **`settings/commuterPolicy`**
— pricing config (see [pricing](pricing.md)).

## Server (Cloud Functions)

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `createPayment` | HTTP | public | Price-guard + booking/order creation + Netopia envelope |
| `netopiaCallback` | HTTP (IPN) | Netopia | Confirms online bookings paid; reconciles repays |
| `repayOrder` | HTTP | public | Re-issue Netopia payment for a pay-later booking |
| `adminCreateLongtermBooking` | callable | `assertStaff` | Broker / walk-in / pay-later reservation + optional check-in |

Check-in/out, cancel+refund, no-show and overstay are covered in the
[admin-flow walkthroughs](../admin-flows/).

## Gotchas / edge cases

- **Two booking-creation paths, one canonical.** The live booking write is
  server-side (`createBookingFromOrder` / `adminCreateLongtermBooking`). The
  client `longTermService.createLongTermBooking` / `createCreditBooking` still
  exist but are legacy — production reservations don't go through them.
- **Fully-voucher-covered booking skips Netopia.** A `days` voucher covering the
  whole total drives `amount ≤ 0`; `createPayment` creates the booking
  immediately as `paidBy: 'voucher'` and returns `{ free: true }` — no payment
  handoff. See [vouchers](vouchers.md).
- **Pick-up day (Bucharest tz) sets the seasonal period.** The server extracts
  the local day so a 02:00 pick-up isn't bucketed into the previous calendar
  day (`pricingValidate.js:27`, `bucharestDay`).
- **After-hours gate fails open.** If `openingHours` or the drop-off date isn't
  ready, the gate does not block — the reservation proceeds.
- **`totalPrice` on the wire is always the standard price.** The server applies
  discount + voucher; never trust a client-sent net.

## Invoicing (SmartBill, live)

- Long-term orders are invoiced (v1.2 Phase 2): a **proforma** at order time and a
  **fiscal invoice** once the money is actually collected **by card** — online on IPN
  confirm, or at the desk on the POS (client decision 2026-08-05). **Cash** at the
  location gets a proforma only; its fiscal invoice is raised manually. Broker/prepaid
  capture no billing and issue nothing. Cancellation deletes the proforma and
  **stornos** any auto-issued invoice; reprice/overstay differences add a proforma or
  an invoice per the same card/cash rule, or a partial storno. Invoice line:
  `Servicii parcare conform rezervării {code}`. See
  [roadmap/v.1.2_smartbill.md](../roadmap/v.1.2_smartbill.md).

## Planned / not built

- **Automated refunds** — cancellation refunds are a manual admin queue; Netopia
  has no refund API in the current integration.
  [roadmap/v.1.4_netopia_v2_migration.md](../roadmap/v.1.4_netopia_v2_migration.md).
- **ANPR auto check-in/out** — [roadmap/v.1.3_anpr.md](../roadmap/v.1.3_anpr.md).
