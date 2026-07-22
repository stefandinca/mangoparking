# Pricing (tiers, seasonal overlays, online discount)

> Status: ✅ Shipped · Last verified: 2026-07-09

## What it is

The pricing model has four admin-editable pieces, all managed together on
**`/admin/pricing`** (`src/pages/admin/AdminPricing.js`):

1. **Credit packs** (`tokenPacks`) — see [credits](credits.md).
2. **Long-term per-day tiers** (`settings/longTermRates`).
3. **Seasonal period overlays** (`seasonalPricing`) — full tier tables scoped to
   a date window.
4. **The online discount** (`settings/global.onlineDiscountPercent`) and the
   **commuter late-pickup policy** (`settings/commuterPolicy`).

The load-bearing rule: **every price stored in the DB is the STANDARD (on-site)
price.** Paying online applies a *real* `-X%` discount on top; pay-at-pickup pays
the standard price unchanged. And the server, not the browser, is the source of
truth for what gets charged.

## How it works

### Long-term tiers

`settings/longTermRates` = `{ tiers: [{ minDays, maxDays|null, perDay }] }`.
`longTermService.calculateLongTermCost(days, rates)`
(`src/services/longTermService.js:28`) finds the tier whose `[minDays, maxDays]`
contains the day count (last tier catches the open-ended top) and returns
`days × perDay`. Default fallback tiers: 49 / 39 / 29 lei/day.

### Seasonal overlays (pick-up day wins)

`seasonalPricing/{auto}` docs each carry `name`, `startDate`, `endDate`,
`active`, and their **own full `tiers` table**. The effective tier set is chosen
by the booking's **pick-up day**:
`seasonalRatesService.getEffectiveRates(periods, pickupDay, defaultRates)`
(`src/services/seasonalRatesService.js:73`) returns the matching active period's
tiers, else the defaults. Overlapping active periods are **rejected at save
time** (`findOverlap`, `:84`), so at most one period ever matches a date. Pick-up
wins so a stay straddling a boundary prices at the higher-demand period it leaves
on.

### The real online discount

`settings/global.onlineDiscountPercent` (admin, 0–50, default 10) is applied by
`discountService.onlineFromStandard(standard, percent)`
(`src/services/discountService.js:46`):

```
online = round(standard × (1 − percent/100))     // returns null if the discount rounds to nothing
```

Public pages (`Pricing.js`, `BookingCredits.js`, `BookingLongTerm.js`) render the
**online** price as the headline with the **standard** struck through, plus a
`-X% online` badge. Pay-at-pickup shows the standard price with no strike. The
discount is applied **before** any voucher, so a voucher subtracts from the
already-discounted amount.

### Server-authoritative recompute (the trust boundary)

The browser sends the **standard** price/total; `createPayment`
(`functions/src/index.js:310`) never trusts it. `functions/src/pricingValidate.js`
recomputes the canonical figure and rejects mismatches with a 0-lei tolerance:

- **Long-term** — `computeAuthoritativeLongTermTotal({ dropoffAt, pickupAt })`
  (`pricingValidate.js:61`): re-derives billing days (same 24h + 2h-grace rule),
  loads `settings/longTermRates` + `seasonalPricing`, picks the tier for the
  **pick-up day in Europe/Bucharest** local time, and returns
  `{ days, perDay, expected }`. `createPayment` requires
  `submitted === expected` (`index.js:358`) before charging. It then applies the
  online discount (`:398`) and resolves the voucher; the authoritative `days` /
  `perDay` also feed days-voucher valuation.
- **Credits** — `computeAuthoritativePackPrice({ packId, quantity })`
  (`pricingValidate.js:273`): looks up the pack, requires `price` + `quantity`
  match, so a tampered `packPrice` can't buy a premium pack cheaply.

Without this guard a client could POST `totalPrice: 1` and pay 1 RON for a
30-day stay.

### Commuter late-pickup policy

`settings/commuterPolicy.latePickupDailyRate` (default 49) feeds
`longTermService.computeLateFee(plannedEnd, actual, policy)` — one daily rate per
started day past the planned end. Charged at the lot via `adminChargeOverstay`.
See [long-term bookings](long-term-bookings.md).

## Key files

| File | Role |
|---|---|
| `src/pages/admin/AdminPricing.js` | Edits packs, long-term tiers, seasonal periods, discount %, commuter policy (each with its own Save). |
| `src/services/longTermService.js` | `getLongTermRates` / `saveLongTermRates`, `calculateLongTermCost`, `getCommuterPolicy`, `computeLateFee`. |
| `src/services/seasonalRatesService.js` | Seasonal CRUD + `getEffectiveRates` / `findPeriodForDate` / `findOverlap`. |
| `src/services/discountService.js` | `getOnlineDiscountPercent` / `saveOnlineDiscountPercent` / `onlineFromStandard`. |
| `src/pages/public/Pricing.js` | Public `/pricing` — tiers + packs with the online-discount treatment. |
| `functions/src/pricingValidate.js` | `computeAuthoritativeLongTermTotal`, `computeAuthoritativePackPrice`, `resolveVoucher`. |

## Data (Firestore)

| Doc / collection | Shape | Access |
|---|---|---|
| `settings/longTermRates` | `{ tiers: [{ minDays, maxDays|null, perDay }] }` | public read, admin write |
| `seasonalPricing/{auto}` | `{ name, startDate, endDate, active, tiers[] }` | public read, admin write |
| `settings/global` | `{ onlineDiscountPercent, openingHours, occupiedSpots, totalCapacity, … }` | public read, admin write (merge) |
| `settings/commuterPolicy` | `{ latePickupDailyRate }` | public read, admin write |
| `tokenPacks/{auto}` | `{ quantity, price, name, nameRo, sortOrder, active }` | public read, admin write |

`saveOnlineDiscountPercent` writes `settings/global` with `{ merge: true }`
(`discountService.js:37`) so capacity/opening-hours fields are preserved, and
audit-logs `online_discount_updated`.

## Server (Cloud Functions)

`createPayment` (HTTP) is the enforcement point; `pricingValidate.js` is a plain
module it imports. There is no standalone pricing callable — the client reads the
config collections directly (public read) for display, and the server recomputes
for charging.

## Gotchas / edge cases

- **`pricingService.js` / `pricingTiers` is a parallel legacy model, not the live
  long-term price.** `src/services/pricingService.js` (with its `pricingTiers`
  collection, `addOns`, `calculatePrice`, `getCommuterRate`) is **not** what the
  long-term funnel or the server guard use — those read `settings/longTermRates`
  + `seasonalPricing`. Don't confuse the two when editing rates.
- **Discount is client-cached.** `getOnlineDiscountPercent` memoizes the value
  for the page session (`discountService.js:19`); `saveOnlineDiscountPercent`
  updates the cache, but other open tabs won't see a change until reload.
- **`onlineFromStandard` returns `null` when the discount rounds to nothing** —
  callers use that to skip the strikethrough/badge, so a 0% (or trivially small)
  discount shows a clean single price.
- **Seasonal period is chosen by pick-up day in Bucharest local time** on both
  client and server, so late-night pick-ups bucket into the correct calendar day.
- **0-lei price tolerance.** Any client/server price disagreement is rejected
  loudly (logged + HTTP 400) rather than silently coerced.

## Shipped downstream

- **SmartBill invoicing consumes these prices** (v1.2 Phase 2, live) — the
  server-authoritative charged total becomes the single VAT-inclusive invoice line.
  See [billing](billing.md) and [roadmap/v.1.2_smartbill.md](../roadmap/v.1.2_smartbill.md).

## Planned / not built

- No dynamic / demand-based pricing beyond the manual seasonal overlays.
