# Mango Parking v1.3 — ANPR Camera Integration

> **Status: 📋 PLANNED — not yet built** (as of 2026-07-01). No camera
> integration exists: there is no `functions/src/anpr.js` / `anprDecision.js`,
> no `plateEvents` / `cameraHeartbeats` collections, and no `/admin/anpr` page.
> **Exception:** the standalone overstay pieces this plan referenced *did* ship
> independently via v1.7+ — the `adminChargeOverstay` callable and the
> `markNoShows` scheduled detector are live. The camera hardware layer is not.

## Goal

Replace the manual "agent types plate" step at entry and exit with two Hikvision ANPR cameras that detect plates on-device and push events to our backend. Known plates → automatic check-in/check-out. Unknown plates → admin queue. Misreads → manual override from the existing check-in UI. **Barrier control is deferred** — these cameras are observers, not gate openers, until barrier hardware is on site.

Camera: **Hikvision iDS-2CD7A46G0/P-IZHS(Y)** — 4MP bullet, on-device deep-learning LPR, ISAPI/ONVIF, PoE+, IP67. Spec sheet in [`camera-doc.pdf`](camera-doc.pdf) (same folder).

---

## Locked decisions

1. **Two cameras** — one at entry, one at exit. Direction is determined by which camera fired the event (hardware-routed, not inferred).
2. **No barrier integration yet** — the cameras post plate events; the backend records check-in/check-out. Barrier wiring is a future phase when hardware arrives.
3. **Misread handling** — the existing AdminCheckIns "type plate → act" flow remains for walk-ins, misreads, and unmatched events. ANPR augments it, doesn't replace it.
4. **Allowlist scope** — open (no allowlist filtering). Every plate the camera sees is pushed to the backend; the backend decides what to do based on Firestore lookups.
5. **Retention** — raw plate events + snapshots: 30 days (auto-purged via Storage lifecycle rule + scheduled function). Resulting `bookings` / `activeCheckIns` rows: indefinite (existing behavior).
6. **Directionality** — two cameras, two roles, two HMAC secrets. Each camera is identified by which secret signs its requests.

---

## Architecture

```
┌─────────────┐         outbound HTTPS              ┌──────────────────────┐
│ Entry cam   │ ────────────────────────────────►   │                      │
│ ANPR on-dev │   POST /anprEntry                    │  cloudfunctions.net  │
└─────────────┘   multipart: JSON + JPEG             │  (europe-west1)      │
                                                     │                      │
┌─────────────┐         outbound HTTPS              │  • verify HMAC       │
│ Exit cam    │ ────────────────────────────────►   │  • parse plate       │
│ ANPR on-dev │   POST /anprExit                     │  • dedupe (5s)       │
└─────────────┘                                      │  • upload JPEG       │
                                                     │  • lookup + decide   │
                                                     │  • write event       │
                                                     │  • trigger action    │
                                                     └──────────┬───────────┘
                                                                │
                                ┌───────────────────────────────┼─────────────────────────┐
                                ▼                               ▼                         ▼
                       ┌────────────────┐            ┌────────────────────┐      ┌─────────────────┐
                       │ activeCheckIns │            │ plateEvents (audit)│      │ bookings        │
                       │  (live state)  │            │  + Storage snap    │      │ (status flip)   │
                       └────────────────┘            └────────────────────┘      └─────────────────┘
```

- **Cameras** push events outbound only. No inbound port-forward needed at the site. Site-side requirement: outbound HTTPS to `*.cloudfunctions.net` allowed; static IP optional (we don't IP-allowlist — HMAC handles auth).
- **Each camera has its own HMAC secret.** Entry secret signs requests to `/anprEntry`; exit secret signs `/anprExit`. Wrong cam hitting wrong endpoint → 401.
- **No allowlist sync to camera.** Open scope means the camera streams every plate it sees; the backend is the brain.
- **Snapshots** are uploaded to Firebase Storage under `anpr-snapshots/{eventId}.jpg`. Storage lifecycle rule auto-deletes after 30 days.
- **Audit trail** lives in `plateEvents/{id}` — raw event + decision + linked entity (booking/credit/null). Also 30-day retention.

---

## Existing repo plumbing we'll reuse

- `normalizePlate` already exists in `src/services/tokenService.js` and `src/services/longTermService.js` — we'll consolidate (Phase 3.1).
- `lookupByPlate` in `src/services/tokenService.js` — checks `tokenBalances` for credit balance + plate match.
- `checkInBooking(bookingId, spotId)` + `checkOutBooking(bookingId)` — exist in `src/services/bookingService.js` and are wired into AdminCheckIns. We'll call equivalents server-side.
- `useToken(balanceDocId, plate)` + `checkOut(plate)` from token service.
- `activeCheckIns` collection — already the source of truth for "who's currently in the lot."
- `auditLog` — every ANPR-driven mutation gets logged.
- AdminCheckIns "quick check-in bar" (recently added) — becomes the human-override surface for ANPR exceptions.

---

## Phase 1 — Site provisioning + camera config (~0.5 day on-site)

Not code; hardware setup. Listed so the dev plan has a clear blocker.

- Mount entry and exit cameras per spec: side-of-lane, 1.6–2m height, 30° max horizontal angle, 5–7m trigger distance.
- PoE+ switch on the parking LAN (single cable each).
- Static IPs on a dedicated VLAN; default-deny inbound; outbound HTTPS to `*.cloudfunctions.net` + `*.googleapis.com` + NTP allowed.
- Camera admin password rotated; default account disabled.
- ANPR region: **Europe → Romania**. Capture Mode: **License Plate and Vehicle**.
- HTTPS-only ISAPI; reject HTTP.
- NTP sync (events depend on accurate timestamps for dedupe).
- Configure **Event → Linkage → Notify Surveillance Center** with HTTP destinations:
  - Entry cam → `https://<region>-<project>.cloudfunctions.net/anprEntry`
  - Exit cam → `https://<region>-<project>.cloudfunctions.net/anprExit`
- Picture upload: enabled, JPEG, attached to event payload (multipart).
- Heartbeat: enable so the camera POSTs every 30s — backend tracks last-seen.
- microSD card installed (forensic backup at the camera; 30-day rolling local record).

---

## Phase 2 — Plate event ingestion endpoint (~0.5 day)

### 2.1 Secrets

- `ANPR_ENTRY_HMAC_KEY` and `ANPR_EXIT_HMAC_KEY` — each ~32 random bytes, base64. Set via `firebase functions:secrets:set`.

### 2.2 New `functions/src/anpr.js`

Two `onRequest` Cloud Functions, both `cors: false`, region `europe-west1`, secrets bound:

```js
export const anprEntry = onRequest({ ..., secrets: [ANPR_ENTRY_HMAC_KEY] }, ingest('entry'));
export const anprExit  = onRequest({ ..., secrets: [ANPR_EXIT_HMAC_KEY]  }, ingest('exit'));
```

The `ingest(direction)` factory returns a handler that:

1. Verifies `X-Hmac-Signature` against the body using the appropriate secret. Reject on mismatch with 401 (no body — don't leak).
2. Parses multipart: JSON metadata + JPEG snapshot. Hikvision's ISAPI sends:
   ```json
   { "eventType": "ANPR", "dateTime": "...", "ANPR": {
       "licensePlate": "B123ABC", "confidenceLevel": 95,
       "vehicleType": "smallCar", "country": 50, ...
     } }
   ```
3. **Dedupes**: if a `plateEvents` row with the same `direction + normalizedPlate` exists in the last 5 seconds, return 200 OK without processing (cameras retry on transient network blips).
4. Uploads JPEG to `anpr-snapshots/{eventId}.jpg` (Firebase Storage).
5. Writes `plateEvents/{eventId}` with `{ direction, rawPlate, normalizedPlate, confidence, vehicleType, capturedAt, snapshotPath, decision: 'pending', linkedDocPath: null, cameraIp }`.
6. Returns 200 OK immediately. The downstream decision runs as a Firestore-trigger function (3.3) — keeps the HTTP response under Hikvision's 5s timeout even if Firestore is slow.

### 2.3 Heartbeat

Camera POSTs an empty heartbeat every 30s; we store the latest `cameraHeartbeats/{role}` doc with `lastSeenAt`. Admin dashboard surfaces a red banner if either camera goes >2 min without a heartbeat.

---

## Phase 3 — Decision engine (~1 day)

### 3.1 Consolidate plate normalization

Move the two existing `normalizePlate` implementations into `src/utils/plate.js` (also accessible from functions via a small mirror). Strict mode (server-side): strip spaces, uppercase, replace common OCR confusions (`O→0`, `I→1` — actually we want the *reverse* of the bookingCode alphabet, since real RO plates use these chars), but log both raw and normalized so misreads are auditable.

### 3.2 New `functions/src/anprDecision.js`

Firestore-trigger on `plateEvents/{id}` create:

**Confidence gate:** if `confidence < 0.85`, mark `decision: 'low-confidence'` and stop. Surfaces in admin queue for human review.

**Entry direction:**

| Match | Action | `decision` |
|---|---|---|
| `bookings` where `plate == X` AND `status == 'upcoming'` AND `startDate` within ±12h | call `checkInBooking(bookingId, spotId)` server-side; spotId auto-assigned via existing capacity logic | `auto-checkin-booking` |
| `tokenBalances/plate_*` with `balance > 0` AND no `activeCheckIns` for this plate | call `useToken` equivalent + create `activeCheckIns` row | `auto-checkin-credit` |
| Plate already has `activeCheckIns` row | already inside; flag for ops review (potentially double-entry) | `duplicate-entry` |
| No match anywhere | log; surface in admin "unmatched entries" queue | `unmatched` |

**Exit direction:**

| Match | Action | `decision` |
|---|---|---|
| `activeCheckIns` where `plate == X` matched by longTerm booking | call `checkOutBooking(bookingId)` | `auto-checkout-booking` |
| `activeCheckIns` where `plate == X` matched by credit | call `checkOut(plate)` | `auto-checkout-credit` |
| No `activeCheckIns` row, but plate has past balance/booking | flag — possible missed entry event | `unmatched-exit` |
| No match anywhere | log | `unmatched` |

In every branch, patch the `plateEvents` doc with `decision` + `linkedDocPath` (the booking or activeCheckIns doc the action affected).

### 3.3 Idempotency

The decision function is keyed off the `plateEvents` doc create — Firestore triggers run at-least-once. Wrap mutations in a "check then act" guard:
- Before `checkInBooking`: re-read the booking; if already `status: 'active'`, skip.
- Before `useToken`: check `activeCheckIns` doesn't already exist for the plate.
- Idempotent by design — replays are no-ops.

### 3.4 Auto-checkin without prior booking (Phase 2 of credit flow)

For credit-pack customers, our existing flow is: customer buys credits → arrives → agent uses one token. ANPR removes the agent step. The decision engine must call `useToken` server-side, which:
1. Decrements `tokenBalances/plate_*` by 1.
2. Creates `activeCheckIns/{plate}` with `checkinTime: now`.
3. Logs `tokenTransactions` `type: 'use'`.
4. Triggers the existing E4 email (Phase E of v1.1).

This is already a callable today; we factor the body into a helper and call it from the decision engine.

---

## Phase 4 — Snapshot storage + retention (~0.25 day)

### 4.1 Storage layout

- `anpr-snapshots/{YYYY-MM-DD}/{eventId}.jpg` (date-prefixed for cheap range queries + lifecycle).
- `firebase.json` storage rules: deny all client access; staff read via signed URLs only.

### 4.2 Lifecycle rule

Firebase Storage lifecycle action: `Delete` after `Age: 30 days` on prefix `anpr-snapshots/`. Configure via `gsutil lifecycle set`.

### 4.3 Firestore retention

Scheduled function `purgeOldPlateEvents` (daily at 03:00 Europe/Bucharest): deletes `plateEvents` docs older than 30 days in batches. The linked `bookings` / `activeCheckIns` rows are untouched.

---

## Phase 5 — Admin live page (~1 day)

### 5.1 New route `/admin/anpr`

Permission: `agent` + `admin`. Add to `AdminLayout` sidebar.

### 5.2 Live event stream

Real-time subscribe to `plateEvents` ordered by `capturedAt desc`, last 50. Each row:

- Snapshot thumbnail (left, 80×60)
- Plate (large mono font)
- Direction badge (Entry ↑ / Exit ↓)
- Confidence % (color: green ≥95, mango 85–94, red <85)
- Decision badge (auto-checkin/checkout, unmatched, low-confidence, duplicate-entry)
- Linked entity link (e.g., booking code LT-XXXXX, opens BookingHistory row)
- Time (relative + absolute on hover)
- Action buttons (right):
  - **Override plate**: if OCR misread, agent types correct plate → re-runs decision engine for this event
  - **Manual check-in/out**: routes to AdminCheckIns prefilled with the plate
  - **Mark resolved**: hides from queue without action

### 5.3 Unmatched queue

Top of page: pinned card with count of `decision in ['unmatched','unmatched-exit','low-confidence','duplicate-entry']` from the last 24h. Click → filtered list. Persists until manually resolved.

### 5.4 Camera health banner

Header strip: `Entry camera 🟢 last seen 12s ago · Exit camera 🟢 last seen 8s ago`. Red if heartbeat >2 min old.

---

## Phase 6 — Reconciliation + anomalies (~0.5 day)

`functions/src/scheduled.js`:

- **`anprReconcileDaily`** (daily 04:00) — find `activeCheckIns` older than 14 days with no exit event; mark as `stale`, alert admin. Find `unmatched` entries from yesterday with no follow-up resolution; include in daily digest.
- **`anprMissedExitDetector`** (hourly) — for each `activeCheckIns` row where the matching booking's `endDate` has passed by >2h with no exit ANPR event, write `bookings/{id}.anprAnomaly: 'missed-exit'`. Surfaces in AdminCheckIns row badge.

### 6.3 Overstay detection (independent of ANPR)

A parked car is **overstaying** when it's still in `activeCheckIns` past its paid window. This doesn't require ANPR — it's a derived state from existing data — so this section can ship before the cameras arrive.

- **`detectOverstays`** (hourly, `europe-west1`): for every `activeCheckIns` row, look up the matching booking and compare `endDate` to now:
  - `now > endDate + 30 min grace` → write `bookings/{id}.overstay = { since: endDate, hours, severity }` where `severity` is `'mild'` (≤4h), `'high'` (4–24h), or `'critical'` (>24h).
  - Walk-in credit check-ins use `checkinTime + 24h` as the implicit `endDate` (one token = one day).
  - Re-run idempotent: re-derives every tick, overwrites the field.
- **AdminCheckIns row badge** — the existing "În parcare acum" tab grows a colored chip per row: mango (mild), orange (high), red (critical), with hours-over count. Sort by severity desc by default.
- **AdminDashboard tile** — new "Mașini cu depășire" card with three counters (mild / high / critical) and a click-through to the filtered AdminCheckIns view. Mango border, no badge if count is zero.
- **Audit + admin actions** — agent can resolve from the row: either confirm checkout (use existing checkout button → clears the field) or "Charge overstay" (records a `cashEntries` row + clears the field). The "charge overstay" action is a new callable `chargeOverstay({ bookingId, amount, paidBy })` that mirrors `adminMarkOrderPaid` but writes a separate `tokenTransactions` line `type: 'overstay'` so reporting can separate it.
- **Daily digest** includes the overstay snapshot (counts + top 5 by hours-over).

Daily email digest to admin (via Brevo) with: total events, auto-checkin count, auto-checkout count, unmatched count, low-confidence count, missed-exit alerts, **overstay counts by severity**.

---

## Phase 7 — Privacy, GDPR, on-site signage (~0.25 day)

- Privacy notice on `/privacy` (editable from AdminLegal — already wired in v1.1) updated to disclose: ANPR in use, plates + snapshots retained 30 days, purpose (parking management), legal basis (legitimate interest), data subject rights.
- On-site signage at entrance: "Această parcare folosește recunoaștere automată a numerelor de înmatriculare. Datele se păstrează 30 de zile. Detalii: mangoparking.ro/privacy" — physical sign, not in scope of code, but flagged here.
- Storage lifecycle (Phase 4.2) is the enforcement mechanism for the 30-day promise; document that explicitly in the privacy text.
- Audit trail: every ANPR-driven check-in/out gets `auditLog` entry with `actor: 'anpr-entry-cam'` / `'anpr-exit-cam'`, distinguishable from human-agent actions.

---

## File-level touch summary

**New files (~6):**
- `functions/src/anpr.js` — ingestion endpoints (entry + exit)
- `functions/src/anprDecision.js` — Firestore-trigger decision engine
- `src/utils/plate.js` — consolidated plate normalization
- `src/pages/admin/AdminAnpr.js` — live event page
- `src/services/anprService.js` — client wrappers (override plate, mark resolved)
- (Optional) `functions/src/anprBarrier.js` — placeholder for the future barrier integration; kept in-tree so Phase 8 can drop in

**Modified files (~9):**
- `functions/src/index.js` — re-export the new anpr functions; factor `useToken` body into a callable helper for reuse by decision engine
- `functions/src/scheduled.js` — `purgeOldPlateEvents`, `anprReconcileDaily`, `anprMissedExitDetector`, `detectOverstays`
- `functions/src/index.js` — new callable `chargeOverstay`
- `src/pages/admin/AdminDashboard.js` — "Mașini cu depășire" tile
- `src/pages/admin/AdminCheckIns.js` — overstay chip on row + sort-by-severity default in the "În parcare acum" tab
- `functions/src/emails.js` — admin daily digest template
- `firestore.rules` — `plateEvents` is staff-read, server-write only; `cameraHeartbeats` same
- `firestore.indexes.json` — composite indexes on `plateEvents(direction, capturedAt desc)` and `plateEvents(decision, capturedAt desc)`
- `storage.rules` — `anpr-snapshots/**` denied to all clients (read via Cloud Function signed URLs only)
- `firebase.json` — register the new storage lifecycle config
- `src/router/routes.js` — new `/admin/anpr` route
- `src/components/admin/AdminLayout.js` — new sidebar entry
- `src/services/tokenService.js` + `src/services/longTermService.js` — replace local `normalizePlate` with imports from `src/utils/plate.js`
- `src/i18n/ro.js` + `en.js` — `anpr.*` keys
- `src/pages/public/Privacy.js` (or the AdminLegal-managed content) — ANPR disclosure

---

## Verification

### Phase 1
- Camera web UI: ANPR working on test plates at the install distance. Recognition rate ≥98% across 50 manual test drives.
- Outbound HTTPS confirmed: camera reaches `https://www.google.com` from its diagnostic tool.
- Heartbeat appears in `cameraHeartbeats/entry` within 30s of boot.

### Phase 2
- Manually POST a forged plate event with the correct HMAC → 200, event row appears, JPEG in Storage.
- POST with bad HMAC → 401, no event written.
- POST same plate twice within 5s → only one row.

### Phase 3
- Pre-seed a `bookings` row `status: upcoming, startDate: now+1h, plate: TEST01`. Fire test event from entry endpoint → booking flips to `active` within 2s.
- Pre-seed `tokenBalances/plate_TEST02, balance: 3`. Fire entry → balance becomes 2, `activeCheckIns/TEST02` exists.
- Fire entry with no matching record → `plateEvents` row exists with `decision: 'unmatched'`.
- Fire exit for `TEST02` → `activeCheckIns/TEST02` removed.
- Fire same entry event twice (replay) → only one check-in, no double-decrement.

### Phase 4
- Upload 10 test JPEGs into `anpr-snapshots/<old-date>/` → confirm gsutil lifecycle config shows they'd be purged.
- Manually backdate a `plateEvents` doc by 31 days → daily purge function removes it.

### Phase 5
- Open `/admin/anpr` in two browsers; trigger a test event → both update within 1s.
- Override a plate on a `low-confidence` event → decision re-runs, new branch chosen.
- Stop the entry camera for 3 min → red banner shows up.

### Phase 6
- Manually set an `activeCheckIns` row `checkinTime: 15 days ago` → reconcile flags it `stale`.
- Manually set a `bookings.endDate: 3h ago, status: active` with no matching exit event → missed-exit anomaly badge appears.
- Manually set a `bookings.endDate: 2h ago, status: active` with the row still in `activeCheckIns` → overstay tick writes `overstay.severity: 'mild'`, AdminCheckIns row shows the mango chip, AdminDashboard tile increments.
- Push the same row to `endDate: 26h ago` → severity flips to `critical`, tile counter moves between buckets without double-counting.
- Resolve via "Charge overstay" with `paidBy: 'cash'` → `cashEntries` row appears, `tokenTransactions` `type: 'overstay'` written, `bookings.overstay` cleared.

### Cross-cutting (before declaring done)
- 30-day retention proof: lifecycle rule visible in `gsutil lifecycle get gs://<bucket>`.
- GDPR text live on `/privacy`.
- Physical signage installed.
- Audit-log entries for ANPR actions distinguishable from human-agent actions.
- 24h soak test on staging with real cameras (or a simulator): no missed events, no duplicate check-ins, no false unmatched.

---

## Estimated effort

| Phase | Days |
|---|---|
| 1 — Site + camera provisioning (hardware) | 0.5 |
| 2 — Ingestion endpoint | 0.5 |
| 3 — Decision engine | 1.0 |
| 4 — Snapshot storage + retention | 0.25 |
| 5 — Admin live page | 1.0 |
| 6 — Reconciliation + anomalies | 0.5 |
| 7 — Privacy + signage | 0.25 |
| **Total** | **~4 days** code, plus on-site install |

Phases 2–4 can run in parallel after the cameras are physically up (Phase 1). Phase 5 needs Phase 3 to be writing events. Phase 6 is independent.

---

## Caveats and future work

- **Barriers are not in scope.** When barrier hardware arrives, add a Phase 8: wire camera alarm output (24V/1A, dry-contact) to the barrier "open" terminal. Two options: (a) camera opens locally based on on-device allowlist synced from our backend, or (b) backend triggers camera alarm output via ISAPI `PUT /ISAPI/System/IO/outputs/{n}/trigger`. Recommend (a) with (b) as failover.
- **OCR confusion characters** — Romanian plates use `O`, `I`, etc., but Hikvision's algorithm is plate-aware and rarely confuses them. The 2% error rate cited in the spec is realistic. Don't try to "fix" OCR with substitution rules; let the misreads go to the override queue instead.
- **Vehicle attribute data** (type/color/brand) — the camera reports it; we store it on the event but don't act on it. Future: anti-fraud check ("this plate's car is reported as red, the camera saw black — flag").
- **No retroactive privacy** — events older than 30 days are gone; the resulting check-in record stays. Make sure the privacy text reflects exactly that (we don't claim to delete check-in history).
- **Hikvision vendor risk** — banned for federal use in US/UK. Romania private operator: fine. If procurement policy ever shifts, the ISAPI-based design ports to other ANPR cameras (Axis, Dahua) with adapter swaps in `functions/src/anpr.js` only.
- **Single point of failure** — if both cameras fail, the existing manual AdminCheckIns flow still works. No degraded mode needed; agents fall back to typing plates by hand.
- **Out of scope for v1.3**: barrier control, two-factor entry (plate + RFID), bus/truck multi-axle recognition, foreign-plate enforcement workflows, integration with police/DGPCI databases.
