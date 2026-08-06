# External Integrations

> Status: 🟡 Partial (4 shipped, 1 of them dormant; 1 planned) · Last verified: 2026-07-27

Overview of the third-party integrations wired into the backend, and the planned ones
that are not built yet. Payments (Netopia) and email (Brevo) are large enough to have
their own docs:

- [./payments-netopia.md](./payments-netopia.md) — Netopia Mobilpay (card payments).
- [./email-brevo.md](./email-brevo.md) — Brevo (customer + ops email).

This doc covers the rest:

| Integration | Status | Where |
|---|---|---|
| **ANAF CUI lookup** | ✅ Shipped | `functions/src/cui.js`, `src/services/cuiService.js` |
| **Flight-status lookup** | ✅ Shipped, **dormant** (needs API key) | `functions/src/flightStatus.js`, `src/services/flightStatusService.js` |
| **SmartBill invoicing** | ✅ Shipped (v1.2 Phase 2/4 live; e-Factura + retry queue planned) | `functions/src/smartbill.js`, `src/services/invoiceService.js` |
| **ParkVia auto-import** | ✅ Shipped, **live since 2026-07-23** | `functions/src/parkvia.js`, `src/services/parkviaService.js` |
| **Parkos auto-import** | ✅ Shipped **2026-08-06**, inert until its secret is set | `functions/src/parkos.js`, `src/services/parkosService.js` |
| **ANPR cameras** | 📋 Planned — not built | [../roadmap/v.1.3_anpr.md](../roadmap/v.1.3_anpr.md) |

---

## ANAF CUI lookup — ✅ Shipped

Turns a Romanian fiscal code (CUI/CIF) into a company record so the PJ billing form
auto-fills company name, address, reg-com, and VAT-payer status.

### Server — `functions/src/cui.js`

`lookupCui` is an `onCall` (`cui.js:58`), `europe-west1`, `cors: true`. Given
`{ cui }`:

1. **Normalize + validate** — strip a leading `RO`/whitespace, require 2–10 digits
   (`cui.js:20`, `:62`).
2. **Cache check** — `lookupCache/cui_{cui}` with a **24h** TTL (`CACHE_TTL_MS`,
   `cui.js:18`). A fresh cache hit returns immediately (`cui.js:67`) so form keystrokes
   don't hammer ANAF.
3. **Call ANAF** — `POST https://webservicesp.anaf.ro/PlatitorTvaRest/api/v9/ws/tva`
   with body `[{ cui, data: <yesterday> }]` (ANAF publishes the day's snapshot the
   next morning, so it queries yesterday, `cui.js:78`). Uses the classic `node:https`
   module forced to **HTTP/1.1** + `minVersion: 'TLSv1'` (`cui.js:27`) because ANAF
   resets Node's undici `fetch` (ECONNRESET) from GCP egress.
4. **Parse** the v9 nested shape — `date_generale`, `inregistrare_scop_Tva`,
   `adresa_sediu_social` — into
   `{ companyName, address, regCom, vatPayer, cui }` (`cui.js:133`), cache it, return.

Failure modes return a soft `{ error: 'network' | 'anaf-<status>' | 'bad-json' |
'not_found' }` rather than throwing, so the form degrades to manual entry.

### Client — `src/services/cuiService.js`

`lookupCui(cui)` (`cuiService.js:11`) wraps the callable via `httpsCallable`. Any error
(function not deployed, network blip, ANAF 404) collapses to `{ error: 'unavailable' }`
— the caller (`BillingFields.js`, PJ branch) falls back to manual entry and the user
never sees a broken state.

> Note: the file's header comment still calls the function "future / Phase A infra" —
> that comment is stale; the callable **is** deployed and live. `isVatPayer` /
> `vatPayer` is captured today and is the field the (still-planned) SmartBill e-Factura
> branch — v1.2 Phase 8 — will key off (see [../roadmap/v.1.2_smartbill.md](../roadmap/v.1.2_smartbill.md)).
> ⚠️ `readBilling` does **not** currently persist `isVatPayer` on stored PJ billing;
> Phase 8 needs it captured at booking time.

---

## Flight-status lookup — ✅ Shipped but DORMANT

Lets the admin boards flag a reservation whose flight is delayed, cancelled, or
diverted. **Provider-agnostic and dormant by default**: with no API key configured the
callable returns `{ configured: false }` and the UI renders nothing — so it deploys
safely before a provider is chosen.

### Server — `functions/src/flightStatus.js`

`lookupFlightStatuses` is an `onCall` (`flightStatus.js:141`), staff-only
(`assertStaff`, `:130`). Input `{ items: [{ flightNumber, date }] }`; output
`{ configured, results: { "FLIGHTNO_DATE": normalized | { found:false } } }`.

- **Config gate** — `apiConfig()` (`flightStatus.js:35`) reads `FLIGHT_API_KEY`,
  `FLIGHT_API_PROVIDER`, optional `FLIGHT_API_HOST` from env. No key or unknown
  provider → `{ configured: false, results: {} }` (`flightStatus.js:148`).
- **Provider adapters** — `PROVIDERS` (`flightStatus.js:66`) has two, both normalizing
  to one shape (`found`, `cancelled`, `diverted`, `status`, `departureDelayMinutes`,
  `arrivalDelayMinutes`, `…Scheduled`):
  - **`aerodatabox`** (RapidAPI, recommended) — `GET
    /flights/number/{number}/{date}`, headers `X-RapidAPI-Key` / `X-RapidAPI-Host`
    (default host `aerodatabox.p.rapidapi.com`).
  - **`aviationstack`** — `GET /v1/flights?access_key=&flight_iata=&flight_date=`.
  A thrown error or bad shape is caught and treated as a miss (`found:false`) so a
  provider hiccup never surfaces a wrong warning.
- **Windowing + batching** — dedupes by `flightNo_date`, drops anything outside a
  **−2d … +7d** window (`LOOKBEHIND_DAYS`/`LOOKAHEAD_DAYS`, `flightStatus.js:29`),
  caps at 40 items (`MAX_ITEMS`).
- **Cache** — `flightStatusCache/{provider}_{flightNo}_{date}`, **15-minute** TTL
  (`CACHE_TTL_MS`, `flightStatus.js:26`). Caches hits **and** misses so a bad flight
  number doesn't re-bill the provider on every admin view.

### Client — `src/services/flightStatusService.js`

Admin rows that want a badge render an empty slot carrying the flight metadata:

```html
<span data-flight-warn data-flight="RO201" data-flight-date="2026-07-10" data-flight-dir="departure"></span>
```

After rows mount, `enhanceFlightWarnings(scopeEl)` (`flightStatusService.js:66`)
collects the slots, applies the same date window, resolves status via a client memo
(10-min TTL) → the batched callable, and paints a delay/cancel/divert badge (delays
≥15 min). It's a no-op until configured: once the callable reports `configured:false`,
a module-level flag flips and it stops calling (`flightStatusService.js:22`, `:95`).

### How to enable

Pick a provider, get a key, then either (per `flightStatus.js:6`):

- **dotenv** — create `functions/.env.mango-parking` with
  `FLIGHT_API_PROVIDER=aerodatabox` and `FLIGHT_API_KEY=xxxx` (optional
  `FLIGHT_API_HOST=…`), redeploy; **or**
- **Gen2 secret** — `firebase functions:secrets:set FLIGHT_API_KEY`, uncomment the two
  `[SECRET]` lines in `flightStatus.js` (the `defineSecret` import and the `secrets: […]`
  binding on the callable), redeploy.

No client change is needed — the UI turns on automatically once the callable starts
returning `configured: true`.

---

## SmartBill invoicing — ✅ Shipped (v1.2 Phase 2/4 live)

Romanian fiscal invoices (facturi) auto-issued from paid orders, backed by the captured
billing identity (PF/PJ split, CUI via the ANAF lookup above) on `bookings` /
`pendingOrders` / `tokenTransactions`.

**Two-document model (live, client-verified 2026-07-17):**
- Every order issues a **proforma** up front (SmartBill "estimate", non-fiscal) —
  `createPayment` (skipped when a voucher covers the full amount), plus desk sales via
  `adminCreateLongtermBooking` (non-broker) and `grantCreditsForCash`.
- Online-paid orders additionally get a **fiscal invoice** once payment confirms —
  `netopiaCallback` (new bookings, repays at `repayAmount`, credit packs).
- **Pay-at-location fiscal invoices stay manual** in the SmartBill UI (locked decision):
  `adminMarkOrderPaid` issues nothing.
- **Broker/prepaid** reservations capture no billing and issue nothing.

**Wrapper** — `functions/src/smartbill.js`: HTTP Basic auth against
`https://ws.smartbill.ro/SBORO/api`, 10s hard timeout, `errorText`-on-HTTP-200 failure
handling. Two series pinned case-insensitively — invoices `Mango` (type `f`), proformas
`MANGO` (type `p`); VAT 21%. Secrets `SMARTBILL_{USERNAME,TOKEN,CIF}`.

**Orchestration** — `smartbillIssueSafe` / `smartbillDeleteProformaSafe` /
`smartbillCancelInvoiceSafe` (`index.js`), all **best-effort**: a SmartBill failure
stamps `smartbill.status='failed'` + `lastError` and **never breaks a money flow**. The
`smartbill.{proforma,invoice,status,lastError}` field is server-written only
(rules-protected).

**Invalidation (Phase 4, live)** — cancellation deletes the proforma and issues a
**storno, always** (`/invoice/reverse`, no same-day anulare) of any auto-issued invoice;
reprice/overstay differences add proformas or partial stornos. Wired into
`cancelBookingWithRefund`, `cancelPendingCreditOrder`, `adminRepriceBooking`,
`adminChargeOverstay`, and the scheduled `markNoShows` / `expireStaleHolds` (unpaid docs
only — paid no-shows forfeit and keep their invoice).

**Admin diagnostics** — `smartbillHealthcheck` + `smartbillTestIssue` callables, surfaced
on `/admin/pricing` (`AdminPricing.js`).

**Documents are NOT surfaced** in the app or emails (client decision 2026-07-17) — staff
consult SmartBill directly.

**Still planned** — Phase 7 (retry queue for `smartbill.status='failed'` docs) and Phase 8
(e-Factura / ANAF SPV submission for B2B VAT payers). Full plan + phase history:
[../roadmap/v.1.2_smartbill.md](../roadmap/v.1.2_smartbill.md); working snapshot:
[../smartbill-doc.md](../smartbill-doc.md).

---

## ParkVia auto-import — ✅ Shipped (live since 2026-07-23)

Auto-imports reservations booked through **ParkVia** (the ParkCloud Operator API — REST/XML
on Azure API Management, API-key auth, **pull/poll**) as broker bookings, so staff don't
re-type them. Configured and running in production: secrets `PARKVIA_SUBSCRIPTION_KEY` +
`PARKVIA_OPERATOR_KEY`, `PARKVIA_PARKING_ID=15777` + `PARKVIA_BASE_URL` in
`functions/.env.mango-parking`. The config gate remains (same shape as flight-status):
without credentials `parkviaConfig().configured === false` → the poller is a logged no-op,
the callables return `{ configured:false }`, the admin card shows "not configured."

- **Poller** `pollParkviaBookings` (`scheduled.js`, every 15 min) and the **`parkviaSyncNow`**
  (`assertStaff`) / **`parkviaHealthcheck`** (`assertAdmin`) callables all drive
  `runParkviaSync` (`index.js`). ParkCloud is **event-based** but publishes events **out of id
  order**, so the sync polls an **overlapping `events/age` window** (72 h rolling, stretched
  over downtime) and triages per-ref from the `parkviaImports` ledger — never a strict
  `since/{id}` cursor (the 2026-07-29 PC90417080 lost-reservation incident). The first run
  primed `parkviaSync/state` and imported nothing (no historical backfill); `primeEventId`
  fences that manual-desk era off from the window.
- Imports route through **`createBrokerBookingCore`** (shared with the manual desk flow) →
  ordinary broker bookings (`source:'broker'`, `paidBy:'broker'`, `billing:null`, no cashbook,
  no SmartBill). Dedup is the **`parkviaImports/{ref}`** ledger (transactional claim); the
  booking carries a server-written **`parkvia`** trail field.
- Cancellations reconcile safely (only `upcoming` bookings auto-release; active/completed are
  flagged for manual review). Amendments auto-apply safe date fields only.
- No-shows are **reported back** to ParkVia (`PUT …/booking/{ref}/NoShow` via
  `reportParkviaNoShowSafe`, best-effort, once per booking) from both the `markNoShows`
  detector and `cancelBookingWithRefund`'s no-show conversion.
- The ParkCloud XML→booking mapping is quarantined in `mapParkviaBookingToImport`
  (`parkvia.js`) and unit-tested against the real schema
  (`functions/test/parkvia.mapper.test.js`).

Remaining provisional area: ParkCloud's **amendment** signalling — only safe date fields
auto-apply. Full detail: [../features/parkvia.md](../features/parkvia.md); onboarding
record: [../parkvia-setup-steps.md](../parkvia-setup-steps.md).

---

## Parkos auto-import — ✅ Shipped (2026-08-06), awaiting its secret

The **second** broker channel: auto-imports reservations booked through **Parkos**
(parkos.com / parkos.ro) as broker bookings. Deliberately independent of ParkVia —
separate credentials, ledger, scheduler and admin card — so one aggregator's outage can't
stop the other. Both converge on `createBrokerBookingCore`, so their bookings are identical.

- **Transport** — REST/**JSON** at `https://api.parkos.com`, OAuth2 **client credentials**
  (Laravel Passport): `POST /oauth/token` → a Bearer JWT nominally valid a year, cached in
  module memory only and re-minted every 6 h; a 401 re-mints once and retries.
- **Poller** `pollParkosBookings` (`scheduled.js`, every 15 min) and the **`parkosSyncNow`**
  (`assertStaff`) / **`parkosHealthcheck`** (`assertAdmin`) callables all drive
  `runParkosSync` (`index.js`). The feed is `GET /v1/reservations` filtered by an
  all-or-nothing `(from, till, period_type)` trio; we poll `period_type=updated_at` over a
  **3-day overlapping window** (stretched over downtime, capped at a year) and triage per-ref
  from the `parkosImports` ledger. `/v1/reservations` is **read-only** — unlike ParkVia there
  is **no no-show report-back**.
- **Two guards** make it safe against an account staff already service by hand: a
  reservation whose stay already **ended** is recorded and never imported (no
  retro-backfill), and before creating anything the sync **adopts** a desk-entered booking
  with the same plate + Bucharest arrival day (`parkos_linked` audit) instead of duplicating
  it. This replaces ParkVia's one-shot prime and, unlike a prime, doesn't go blind to an
  upcoming reservation nobody typed in.
- Cancellations reconcile safely (only `upcoming` bookings auto-release; active/completed are
  flagged for manual review); amendments auto-apply safe date fields only.
- The JSON→booking mapping is quarantined in `mapParkosReservationToImport` (`parkos.js`) and
  unit-tested against a real captured record (`functions/test/parkos.mapper.test.js`).
  Europe/Bucharest wall-time + billing-days rules are shared with the ParkVia adapter in
  `functions/src/roTime.js`.

**Not live yet:** `PARKOS_CLIENT_ID` / `PARKOS_MERCHANT_ID` / `PARKOS_BASE_URL` are in
`functions/.env.mango-parking`, but the config gate stays closed until
`firebase functions:secrets:set PARKOS_CLIENT_SECRET` + a functions redeploy.

The same credentials also reach **writable** `/v1/prices` and `/v1/availability` resources
(pushing our tariffs and capacity out to Parkos) — discovered, documented, deliberately **not
built**. Full detail + go-live steps: [../features/parkos.md](../features/parkos.md).

## ANPR cameras — 📋 Planned (not built)

Two Hikvision ANPR cameras that auto check-in/out by plate. **Not built** — no
`functions/src/anpr.js` / `anprDecision.js`, no `plateEvents` / `cameraHeartbeats`
collections, no `/admin/anpr` page.

**Exception:** the standalone overstay pieces that plan referenced **did** ship
independently (via v1.7+): the `adminChargeOverstay` callable and the `markNoShows`
scheduled detector (`functions/src/scheduled.js:274`) are live. The camera hardware
layer is not.

Full plan (HMAC-signed ingestion endpoints, decision engine, snapshot storage + 30-day
retention, admin live page, reconciliation, GDPR signage):
[../roadmap/v.1.3_anpr.md](../roadmap/v.1.3_anpr.md).

---

## At a glance

- **ANAF** — live, cached 24h, degrades to manual entry, feeds PJ billing capture.
- **Flight status** — live but dormant; flip on with one env var / secret + redeploy,
  cached 15 min, staff-only.
- **SmartBill** — live (v1.2 Phase 2/4): proforma on every order, fiscal invoice on
  online-payment confirm, storno on cancel; best-effort, never breaks a money flow.
  e-Factura + retry queue (Phase 7/8) still planned.
- **ParkVia** — live since 2026-07-23; polls every 15 min and imports ParkVia reservations as
  broker bookings, reconciles cancellations/amendments, reports no-shows back.
- **Parkos** — built 2026-08-06, inert until its secret is set; the second broker channel,
  OAuth2/JSON, polls `updated_at` every 15 min, read-only feed (no report-back), guarded
  against duplicating the reservations staff already entered by hand.
- **ANPR** — design docs only; overstay detection + `markNoShows` (ANPR-adjacent) are the
  sole shipped fragments, the camera layer is not built.
