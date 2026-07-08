# External Integrations

> Status: 🟡 Partial (2 shipped, 1 of them dormant; 2 planned) · Last verified: 2026-07-09

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
| **SmartBill invoicing** | 📋 Planned — not built | [../roadmap/v.1.2_smartbill.md](../roadmap/v.1.2_smartbill.md) |
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
> `vatPayer` is captured today and is the field the planned SmartBill e-Factura branch
> would key off (see [../roadmap/v.1.2_smartbill.md](../roadmap/v.1.2_smartbill.md)).

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

## SmartBill invoicing — 📋 Planned (not built)

Romanian fiscal invoices (facturi / chitanțe / e-Factura) auto-issued from every paid
order. **None of it is in the codebase** — no `functions/src/smartbill.js`, no
`smartbill` field on any doc, no SmartBill API call. The **only** part that exists
today is capture of billing identity at checkout (PF/PJ split, CUI via the ANAF lookup
above) on `bookings` / `pendingOrders` / `tokenTransactions`; that data is stored for
future invoicing but never sent anywhere.

Full plan (8 phases: wrapper, auto-issue on online/cash/card, storno on cancel,
customer/admin PDF access, email attachment, retry queue, e-Factura for B2B VAT
payers): [../roadmap/v.1.2_smartbill.md](../roadmap/v.1.2_smartbill.md).

---

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
- **SmartBill / ANPR** — design docs only; billing capture (SmartBill) and overstay
  detection + `markNoShows` (ANPR-adjacent) are the sole shipped fragments.
