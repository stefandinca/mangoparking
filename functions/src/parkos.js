// Parkos auto-import — REST/JSON integration.
// See documentation/features/parkos.md for the full picture.
//
// GOAL: reservations made through Parkos (parkos.com / parkos.ro — the Dutch
// airport-parking aggregator) appear as broker bookings automatically, instead
// of being re-typed at the admin desk. Same destination as the ParkVia
// importer, and it shares createBrokerBookingCore with it, so both produce
// byte-identical booking docs.
//
// MODEL: Parkos exposes a small OAuth2 (Laravel Passport) REST/JSON partner
// API at https://api.parkos.com. It is PULL-only, and — unlike ParkCloud —
// there is NO event feed: the reservations list is filtered with a
// (from, till, period_type) triple, and `period_type=updated_at` gives us
// proper modified-since semantics. A scheduled job (every 15 min) + an admin
// "Sync now" button drive runParkosSync (index.js).
//
// The reservations resource is READ-ONLY (OPTIONS → GET,HEAD), so unlike
// ParkVia there is no no-show report-back and no way to push a status. The
// writable resources on the account (/v1/prices, /v1/availability) are a
// separate, not-yet-built feature — see the doc.
//
// CONFIG-GATED, NOT DORMANT-BY-DESIGN. Everything runs off parkosConfig():
// with no Parkos credentials it returns { configured: false }, the poller is a
// logged no-op, the callables return { configured: false }, and the admin card
// shows "not configured".
//
// Endpoints, auth, the reservation schema, the datetime convention and the
// paging/empty-result behaviour were all CONFIRMED live on 2026-08-06 against
// merchant 3079 (ManGo Parking) — see the per-function comments.
// The whole JSON→booking mapping stays quarantined in
// mapParkosReservationToImport() and is unit-tested (functions/test/).

import { defineSecret } from 'firebase-functions/params';
import { bucharestWallToIso, bucharestDayKey, deriveDays } from './roTime.js';

// Only the secret is a Secret Manager value; the numeric client id, the
// merchant id and the base URL are non-secret config in
// functions/.env.mango-parking (same split as PARKVIA_*).
export const PARKOS_CLIENT_SECRET = defineSecret('PARKOS_CLIENT_SECRET');
export const PARKOS_SECRETS = [PARKOS_CLIENT_SECRET];

// Hard timeout — this runs inside a scheduled job and an admin callable; a hung
// Parkos request must not stall the function until the platform kill.
const PARKOS_TIMEOUT_MS = 12_000;

// The broker name stamped on imported bookings. MUST match what staff have been
// typing by hand at the desk ('Parkos'), so the ledger, the reservation chips
// and any later reporting treat the two eras as one channel.
export const PARKOS_BROKER_NAME = 'Parkos';

// ── Configuration gate ──────────────────────────────────────────────────────
// Mirrors parkviaConfig(): reads env first (dotenv or Gen2 secret, both surface
// on process.env inside a bound invocation). `configured` is false until both
// OAuth credentials are present, which keeps everything inert.
export function parkosConfig() {
  const clientId = process.env.PARKOS_CLIENT_ID || '';
  const clientSecret = process.env.PARKOS_CLIENT_SECRET || '';
  const merchantId = process.env.PARKOS_MERCHANT_ID || '';
  const baseUrl = process.env.PARKOS_BASE_URL || 'https://api.parkos.com';
  return {
    configured: !!(clientId && clientSecret),
    clientId,
    clientSecret,
    merchantId,
    baseUrl,
  };
}

// ── OAuth2 client-credentials token ─────────────────────────────────────────
// CONFIRMED (2026-08-06): POST /oauth/token, form-encoded, grant_type=
// client_credentials → { token_type: 'Bearer', expires_in, access_token }.
// The issued JWT is nominally valid for a YEAR, but we deliberately re-mint it
// far sooner: a rotated client secret would otherwise keep working off a warm
// instance for months. Cached in module memory only — never persisted, so a
// bearer token for a live sales channel never sits at rest in Firestore.
const PARKOS_TOKEN_MAX_AGE_MS = 6 * 60 * 60_000;
let tokenCache = null;   // { token, expiresAtMs, clientId }

async function parkosToken({ force = false } = {}) {
  const cfg = parkosConfig();
  if (!cfg.configured) throw new Error('Parkos not configured');
  if (!force && tokenCache
      && tokenCache.clientId === cfg.clientId
      && Date.now() < tokenCache.expiresAtMs) {
    return tokenCache.token;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });

  let res;
  try {
    res = await fetch(`${cfg.baseUrl}/oauth/token`, {
      method: 'POST',
      signal: AbortSignal.timeout(PARKOS_TIMEOUT_MS),
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (err) {
    throw new Error(timeoutMessage(err) || `Parkos auth: ${err?.message || 'network error'}`, { cause: err });
  }

  const text = await res.text();
  if (!res.ok) throw new Error(`Parkos auth HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);

  let json;
  try { json = JSON.parse(text); } catch { throw new Error('Parkos auth: unparseable response'); }
  const token = json?.access_token;
  if (!token) throw new Error('Parkos auth: no access_token in response');

  const ttlMs = Math.max(60_000, (Number(json.expires_in) || 3600) * 1000 - 60_000);
  tokenCache = {
    token,
    clientId: cfg.clientId,
    expiresAtMs: Date.now() + Math.min(ttlMs, PARKOS_TOKEN_MAX_AGE_MS),
  };
  return token;
}

function timeoutMessage(err) {
  return (err?.name === 'TimeoutError' || err?.name === 'AbortError')
    ? `Parkos: timeout after ${PARKOS_TIMEOUT_MS / 1000}s`
    : '';
}

// ── Outbound HTTP + JSON parse ──────────────────────────────────────────────
// Bearer auth, 12s hard timeout, error normalisation in the shape used by
// smartbill.js / parkvia.js.
//
// TWO Parkos quirks this centralises:
//   • an empty result set is HTTP **204 No Content**, not a 200 with an empty
//     list — a naive res.json() would throw on every quiet poll;
//   • errors come back as 404 with a JSON body, in one of two shapes
//     ({"message":"..."} or {"message":{"message":"...","status_code":404}}).
// A 401 (rotated secret / evicted token) re-mints the token once and retries.
async function parkosRequest(path, { query, method = 'GET', retryAuth = true } = {}) {
  const cfg = parkosConfig();
  if (!cfg.configured) throw new Error('Parkos not configured');

  const url = new URL(`${cfg.baseUrl}${path}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  }

  const token = await parkosToken();
  let res;
  try {
    res = await fetch(url, {
      method,
      signal: AbortSignal.timeout(PARKOS_TIMEOUT_MS),
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    throw new Error(timeoutMessage(err) || `Parkos: ${err?.message || 'network error'}`, { cause: err });
  }

  if (res.status === 401 && retryAuth) {
    await parkosToken({ force: true });
    return parkosRequest(path, { query, method, retryAuth: false });
  }
  if (res.status === 204) return null;             // empty result set

  const text = await res.text();
  if (!res.ok) throw new Error(`Parkos HTTP ${res.status}${text ? `: ${parkosErrorText(text)}` : ''}`);
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Parkos: unparseable JSON response');
  }
}

// Both documented error envelopes collapse to one readable line.
export function parkosErrorText(text) {
  try {
    const j = JSON.parse(text);
    const m = j?.message;
    if (typeof m === 'string') return m;
    if (m && typeof m.message === 'string') return m.message;
  } catch { /* not JSON — fall through to the raw text */ }
  return String(text).slice(0, 200);
}

// `data` is an OBJECT keyed "0","1","2"… (a JSON-encoded PHP array), NOT a JSON
// array — Object.values is mandatory, [].concat() would silently yield nothing.
function envelopeItems(parsed) {
  const d = parsed?.data;
  if (!d) return [];
  return Array.isArray(d) ? d.filter(Boolean) : Object.values(d).filter(Boolean);
}

// ── Endpoints ───────────────────────────────────────────────────────────────

// CONFIRMED (2026-08-06): the merchants visible to these credentials.
// GET /v1/merchants → data[] of
// { id, name, currency, location:{id,name,slug}, country:{id,name,country_code} }
// Used by the healthcheck as a cheap, known-good reachability probe — and to
// verify our configured merchant id is actually on the account.
export async function listParkosMerchants() {
  const parsed = await parkosRequest('/v1/merchants');
  return envelopeItems(parsed).map((m) => ({
    id: String(m.id ?? '').trim(),
    name: String(m.name ?? '').trim(),
    currency: String(m.currency ?? '').trim(),
    location: m.location?.name || '',
  }));
}

// CONFIRMED (2026-08-06): the reservations list — the sync driver.
// GET /v1/reservations[?page=N][&from=YYYY-MM-DD&till=YYYY-MM-DD&period_type=…]
//
// The three filter params are all-or-nothing: supplying `from` alone answers
// 404 "Period_type and Till parameters are required." `period_type` accepts
// exactly: arrival | departure | created_at | updated_at | canceled_at |
// cancelled_at (the service's own error text). `from`/`till` are DATE-granular
// and INCLUSIVE at both ends — a time component is accepted but truncated.
// Page size is fixed at 100 (a `per_page` param is ignored); paginator carries
// { total_count, total_pages, current_page, per_page, next_page_url }.
export async function listParkosReservations({ from, till, periodType, page } = {}) {
  const parsed = await parkosRequest('/v1/reservations', {
    query: { page, from, till, period_type: periodType },
  });
  return { items: envelopeItems(parsed), paginator: parsed?.paginator || null };
}

// Every reservation touched in [fromDate, tillDate] (inclusive, Parkos dates),
// following the paginator. Page cap is a runaway guard, not a business limit:
// 20 × 100 rows is far beyond any real window for a single car park, and
// hitting it is logged rather than silently truncating the batch.
const PARKOS_MAX_PAGES = 20;

export async function fetchParkosReservationsUpdatedBetween(fromDate, tillDate, periodType = 'updated_at') {
  const out = [];
  for (let page = 1; page <= PARKOS_MAX_PAGES; page++) {
    const { items, paginator } = await listParkosReservations({
      from: fromDate, till: tillDate, periodType, page,
    });
    out.push(...items);
    const totalPages = Number(paginator?.total_pages) || 1;
    if (!items.length || page >= totalPages) {
      if (page >= PARKOS_MAX_PAGES && totalPages > PARKOS_MAX_PAGES) {
        console.warn(`Parkos: window truncated at ${PARKOS_MAX_PAGES} pages (total_pages=${totalPages})`);
      }
      break;
    }
  }
  return out;
}

// ── THE isolated adapter ────────────────────────────────────────────────────
// Maps one reservation record → the import param object consumed by
// createBrokerBookingCore (index.js). Pure, no I/O, unit-tested against a real
// captured record. Normalisation happens HERE (ISO instants, upper-cased plate,
// the desk note) so the rest of the pipeline stays schema-agnostic.
//
// Returns { ref, plate, dropoffAt, pickupAt, arrivalDay, days, totalPrice,
//           currency, paid, passengers, flightNumberDropoff,
//           flightNumberPickup, contact:{name,email,phone}, notes, brokerName,
//           rawStatus, createdAt, updatedAt }.
// Throws if a load-bearing field (code, plate, either date) is missing, so the
// poller counts it as an error and skips rather than importing garbage.
export function mapParkosReservationToImport(raw = {}) {
  const ref = str(raw.code);
  const plate = str(raw.car_license_plate).toUpperCase().replace(/[\s-]/g, '');
  // arrival_date/arrival_time (and the departure pair) are naive wall-time at
  // the car park — VERIFIED against desk-entered twins of the same
  // reservations, e.g. 2026-07-31 23:00 ↔ startDate 2026-07-31T20:00:00Z
  // (EEST, +03:00). Same Europe/Bucharest convention as ParkCloud.
  const dropoffAt = bucharestWallToIso(str(raw.arrival_date), str(raw.arrival_time));
  const pickupAt = bucharestWallToIso(str(raw.departure_date), str(raw.departure_time));

  if (!ref) throw new Error('Parkos mapping: missing reservation code');
  if (!plate) throw new Error(`Parkos mapping: missing plate (ref ${ref})`);
  if (!dropoffAt || !pickupAt) throw new Error(`Parkos mapping: missing/invalid dates (ref ${ref})`);

  // Parkos's CUSTOMER price, not our net — broker bookings get no cashbook and
  // no SmartBill document. `paid:false` means the desk still has to collect.
  const totalPrice = num(raw.total_price);
  const currency = str(raw.currency) || 'RON';
  const paid = raw.paid !== false;
  const persons = Number(raw.persons) || 0;

  // The feed's own `days` is the unit the customer was billed on, so it wins;
  // deriveDays is the fallback when it's absent or nonsense. (Spot-checked
  // against every live record on 2026-08-06 — the two agreed on all of them.)
  const feedDays = Number(raw.days);
  const days = Number.isFinite(feedDays) && feedDays > 0 ? feedDays : deriveDays(dropoffAt, pickupAt);

  return {
    ref,
    plate,
    dropoffAt,
    pickupAt,
    arrivalDay: bucharestDayKey(dropoffAt),
    days,
    totalPrice,
    currency,
    paid,
    passengers: persons > 0 ? persons : null,
    flightNumberDropoff: str(raw.flight_departure_nr) || null,
    flightNumberPickup: str(raw.flight_return_nr) || null,
    contact: {
      name: str(raw.name),
      // Parkos does NOT expose the customer's email — phone + name only. The
      // broker path already treats email as optional; the consequence is that
      // these imports send no customer confirmation (no recipient) while the
      // rezervari@ ops alert still fires.
      email: '',
      phone: str(raw.phone),
    },
    notes: buildParkosNotes({ paid, totalPrice, currency, raw }),
    brokerName: PARKOS_BROKER_NAME,
    // No enquiry/pending state in this feed — a non-null cancelled_at is the
    // only status signal there is.
    rawStatus: str(raw.cancelled_at) ? 'cancelled' : 'active',
    createdAt: isoOrEmpty(raw.created_at),
    updatedAt: isoOrEmpty(raw.updated_at),
  };
}

// The desk note. Romanian, like the ParkVia importer's — Cloud Functions have
// no i18n and staff read these on the check-in board.
export function buildParkosNotes({ paid, totalPrice, currency, raw = {} }) {
  const parts = [];
  if (!paid && totalPrice > 0) parts.push(`Parkos: de încasat ${totalPrice} ${currency} la sosire`);
  const car = str(raw.car_brand_model);
  if (car) parts.push(`Mașină: ${car}`);
  const extras = [...summarizeExtras(raw.products), ...summarizeExtras(raw.fees)];
  if (extras.length) parts.push(`Extra: ${extras.join(', ')}`);
  return parts.join(' · ') || null;
}

// `products` / `fees` were empty on every record captured so far, so their
// element shape is unconfirmed. Summarise defensively rather than guess a
// schema: whatever label/price-ish keys exist get used, and anything
// unrecognised degrades to a compact JSON tail instead of "[object Object]".
function summarizeExtras(list) {
  if (!Array.isArray(list)) return [];
  return list.map((it) => {
    if (it == null) return '';
    if (typeof it !== 'object') return String(it).trim();
    const label = str(it.name) || str(it.title) || str(it.description) || str(it.type);
    const price = num(it.price ?? it.amount ?? it.total);
    if (label) return price > 0 ? `${label} (${price})` : label;
    return JSON.stringify(it).slice(0, 60);
  }).filter(Boolean);
}

// ── Poll window (test-covered) ──────────────────────────────────────────────
// Polled as an OVERLAPPING date window on `period_type=updated_at`, never a
// strict "everything since exactly lastSyncAt" cursor. Two reasons:
//   • the filter is DATE-granular, so an instant cursor cannot be expressed;
//   • the ParkVia lesson (documentation/features/parkvia.md, the PC90417080
//     incident): re-serving recent rows costs nothing because the
//     parkosImports ledger decides what still needs work, while a tight cursor
//     silently loses anything that surfaces late.
export const PARKOS_FEED_MAX_DAYS = 365;   // first run / long downtime
export const PARKOS_LOOKBACK_DAYS = 3;     // rolling overlap on a normal run

// Days of history to request this run: the rolling lookback, stretched to cover
// poller downtime (gap since the last successful sync + a day of margin),
// capped at the feed maximum. Never synced → the full year.
export function parkosWindowDays(lastSyncAt, nowMs) {
  const last = Date.parse(lastSyncAt || '');
  if (!Number.isFinite(last)) return PARKOS_FEED_MAX_DAYS;
  const gapDays = Math.ceil(Math.max(0, nowMs - last) / 86_400_000);
  return Math.min(PARKOS_FEED_MAX_DAYS, Math.max(PARKOS_LOOKBACK_DAYS, gapDays + 1));
}

// The (from, till) pair for a window of `days`, as the API's YYYY-MM-DD.
// `till` runs a day PAST today on purpose: `updated_at` is UTC while the
// service filters on its own calendar, and a reservation touched late tonight
// must not fall outside the window because of a timezone edge.
export function parkosWindowRange(days, nowMs) {
  const day = (offsetDays) => new Date(nowMs + offsetDays * 86_400_000).toISOString().slice(0, 10);
  return { from: day(-Math.abs(days)), till: day(1) };
}

// Firestore doc-ids can't contain '/'. Sanitise a Parkos reservation code for
// use as the parkosImports/{ref} ledger doc-id.
export function parkosRefDocId(ref) {
  return String(ref).trim().replace(/[/\\.#$[\]]/g, '_').slice(0, 200);
}

// ── tiny local helpers ──────────────────────────────────────────────────────
function str(v) {
  return v == null ? '' : String(v).trim();
}

function num(v) {
  const n = Number(String(v ?? '').replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// created_at/updated_at arrive as UTC ISO ("2026-07-31T15:07:30.000000Z").
// (cancelled_at does NOT — it is a space-separated local-time string in the
// service's own zone, which is why the mapper only reads it as a boolean.)
function isoOrEmpty(v) {
  const ms = Date.parse(str(v));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}
