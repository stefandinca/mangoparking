// ParkVia (ParkCloud) auto-import — REST/XML integration scaffold.
// See documentation/roadmap/v.1.x_parkvia.md for the full plan.
//
// GOAL: reservations made through ParkVia appear as broker bookings
// automatically, instead of being re-typed at the admin desk.
//
// DORMANT BY DEFAULT. With no ParkCloud credentials configured, parkviaConfig()
// returns { configured: false }: the scheduled poller is a logged no-op, the
// admin callables return { configured: false }, and the admin card shows
// "not configured". So this deploys safely TODAY, before we have partner access.
//
// MODEL: ParkVia's operator technology is the ParkCloud Operator API — a
// REST/XML service on Azure API Management with API-key auth, documented as
// PULL/poll (we fetch new bookings on a schedule; no confirmed push webhook).
// A scheduled job + an admin "Sync now" button drive runParkviaSync (index.js).
//
// ⚠️ PROVISIONAL: the exact endpoints, the reservation XML schema, the datetime
// format/timezone, the operator-key header name, and the cancellation/amendment
// status signal are all PARTNER-GATED (behind ParkCloud's developer portal) and
// UNKNOWN until we onboard. Everything so marked below must be confirmed against
// the real API before enabling. The whole XML→booking mapping is quarantined in
// mapParkviaBookingToImport() so only that one pure function changes on arrival.
//
// To enable once we have access (see the roadmap doc for the full checklist):
//   • dotenv functions/.env.mango-parking — PARKVIA_PARKING_ID, PARKVIA_BASE_URL
//   • firebase functions:secrets:set PARKVIA_SUBSCRIPTION_KEY
//   • firebase functions:secrets:set PARKVIA_OPERATOR_KEY
//   • uncomment the [SECRET] lines below + the `secrets: PARKVIA_SECRETS`
//     bindings on the poller/callables, finalize the provisional bits, redeploy.

import { parseStringPromise } from 'xml2js';
// [SECRET] import { defineSecret } from 'firebase-functions/params';
// [SECRET] export const PARKVIA_SUBSCRIPTION_KEY = defineSecret('PARKVIA_SUBSCRIPTION_KEY');
// [SECRET] export const PARKVIA_OPERATOR_KEY = defineSecret('PARKVIA_OPERATOR_KEY');
// [SECRET] export const PARKVIA_SECRETS = [PARKVIA_SUBSCRIPTION_KEY, PARKVIA_OPERATOR_KEY];

// Until the [SECRET] lines above are enabled, PARKVIA_SECRETS is empty so
// binding `secrets: PARKVIA_SECRETS` on a function is a harmless no-op and the
// project deploys with no ParkCloud config present.
export const PARKVIA_SECRETS = [];

// Hard timeout — this runs inside a scheduled job and an admin callable; a hung
// ParkCloud request must not stall the function until the platform kill.
const PARKVIA_TIMEOUT_MS = 12_000;

// The broker name stamped on imported bookings (matches the manual desk value).
export const PARKVIA_BROKER_NAME = 'ParkVia';

// ── Configuration / dormant gate ────────────────────────────────────────────
// Mirrors flightStatus.js apiConfig(): reads env first (dotenv or Gen2 secret,
// both surface on process.env inside a bound invocation). `configured` is false
// until the two keys + a parking id are present, which keeps everything inert.
export function parkviaConfig() {
  const subKey = process.env.PARKVIA_SUBSCRIPTION_KEY || '';
  const opKey = process.env.PARKVIA_OPERATOR_KEY || '';
  const parkingId = process.env.PARKVIA_PARKING_ID || '';
  // PROVISIONAL: confirm the real ParkCloud Operator API base host/path.
  const baseUrl = process.env.PARKVIA_BASE_URL || 'https://parkcloud.azure-api.net';
  return {
    configured: !!(subKey && opKey && parkingId),
    subKey,
    opKey,
    parkingId,
    baseUrl,
  };
}

// ── Outbound HTTP + XML parse ───────────────────────────────────────────────
// fetch + AbortSignal.timeout, then xml2js parseStringPromise. Copies the
// timeout/error-normalisation shape used by smartbill.js.
// PROVISIONAL: the operator-key HEADER NAME below is a guess — ParkCloud may
// want the operator key as a second header, a query param, or nothing beyond
// the Azure subscription key. Confirm on onboarding.
async function parkviaRequest(path, { method = 'GET', body } = {}) {
  const cfg = parkviaConfig();
  if (!cfg.configured) throw new Error('ParkVia not configured');

  let res;
  try {
    res = await fetch(`${cfg.baseUrl}${path}`, {
      method,
      signal: AbortSignal.timeout(PARKVIA_TIMEOUT_MS),
      headers: {
        'Ocp-Apim-Subscription-Key': cfg.subKey,   // Azure APIM subscription key
        'X-ParkCloud-Operator-Key': cfg.opKey,      // PROVISIONAL header name
        Accept: 'application/xml',
        ...(body ? { 'Content-Type': 'application/xml' } : {}),
      },
      ...(body ? { body } : {}),
    });
  } catch (err) {
    throw new Error(err?.name === 'TimeoutError' || err?.name === 'AbortError'
      ? `ParkVia: timeout after ${PARKVIA_TIMEOUT_MS / 1000}s`
      : `ParkVia: ${err?.message || 'network error'}`);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`ParkVia HTTP ${res.status}${text ? `: ${String(text).slice(0, 200)}` : ''}`);
  }
  // explicitArray:false collapses single-element nodes to plain values, which
  // makes the mapper (below) readable. Matches netopia.js's IPN XML parsing.
  return parseStringPromise(text, { explicitArray: false, trim: true });
}

// ── Endpoint stubs (PROVISIONAL paths / query params / pagination) ──────────

// List reservations changed since a cursor. PROVISIONAL: the real endpoint,
// the `since` query-param name/format, pagination, and the response envelope
// are all unknown. Returns { raw: [...] } — an array of raw reservation nodes
// for the mapper to normalise. Shape below is a placeholder.
export async function listParkviaBookings({ since } = {}) {
  const cfg = parkviaConfig();
  // PROVISIONAL: endpoint + query. e.g. /operator/{parkingId}/bookings?since=ISO
  const q = new URLSearchParams();
  if (since) q.set('modifiedSince', since);           // PROVISIONAL param name
  const path = `/operator/${encodeURIComponent(cfg.parkingId)}/bookings?${q.toString()}`;
  const parsed = await parkviaRequest(path);
  // PROVISIONAL: dig out the reservation array from the real envelope.
  const node = parsed?.bookings?.booking ?? parsed?.Bookings?.Booking ?? [];
  const raw = Array.isArray(node) ? node : [node].filter(Boolean);
  return { raw };
}

// Fetch a single reservation's current state (used to re-check status).
// PROVISIONAL endpoint + shape.
export async function getParkviaBookingStatus(ref) {
  const cfg = parkviaConfig();
  const path = `/operator/${encodeURIComponent(cfg.parkingId)}/bookings/${encodeURIComponent(ref)}`;
  const parsed = await parkviaRequest(path);
  const b = parsed?.booking ?? parsed?.Booking ?? {};
  return { ref, status: normalizeStatus(b), raw: b };
}

// ── Status normalisation (PROVISIONAL enum) ─────────────────────────────────
// Maps ParkCloud's status field onto our internal reconcile signal.
// PROVISIONAL: real status values/paths unknown — confirm on onboarding.
function normalizeStatus(raw = {}) {
  const s = String(raw.status ?? raw.Status ?? raw.state ?? '').toLowerCase();
  if (/cancel/.test(s)) return 'cancelled';
  if (/amend|chang|modif|updat/.test(s)) return 'amended';
  return 'active';
}

// ── THE isolated adapter — PROVISIONAL, the ONLY piece that changes on the ──
// ── arrival of the real ParkCloud XML schema. Pure function, no I/O, so it   ─
// ── is unit-tested against a fixture (functions/test/parkvia.mapper.test.js).─
//
// Maps a raw ParkCloud reservation node → the import param object consumed by
// createBrokerBookingCore (index.js). ALL field paths, the datetime format, the
// price field, and how plate/days are derived are guesses until confirmed.
// Every access is marked. Do the normalisation HERE (ISO datetimes, days,
// upper-cased plate) so the rest of the pipeline is schema-agnostic.
//
// Returns { ref, plate, dropoffAt, pickupAt, days, totalPrice,
//           contact:{name,email,phone}, brokerName, rawStatus }.
// Throws if a load-bearing field (ref, plate, both dates) is missing, so the
// poller counts it as an error and skips it rather than importing garbage.
export function mapParkviaBookingToImport(raw = {}) {
  const pick = (...keys) => {
    for (const k of keys) {
      const v = raw?.[k];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  };

  // PROVISIONAL: confirm field name/path for the ParkVia booking reference.
  const ref = pick('bookingReference', 'reference', 'BookingReference', 'id');
  // PROVISIONAL: confirm plate field name.
  const plate = pick('vehicleRegistration', 'registration', 'plate', 'VehicleRegistration')
    .toUpperCase().replace(/[\s-]/g, '');
  // PROVISIONAL: confirm datetime field names + format/timezone. toIso() below
  // assumes an ISO-8601-ish string; a different format needs a real parser.
  const dropoffAt = toIso(pick('arrivalDateTime', 'dropOff', 'startDate', 'ArrivalDateTime'));
  const pickupAt = toIso(pick('departureDateTime', 'pickUp', 'endDate', 'DepartureDateTime'));

  if (!ref) throw new Error('ParkVia mapping: missing booking reference');
  if (!plate) throw new Error(`ParkVia mapping: missing plate (ref ${ref})`);
  if (!dropoffAt || !pickupAt) throw new Error(`ParkVia mapping: missing/invalid dates (ref ${ref})`);

  // PROVISIONAL: confirm price field + currency handling. This is ParkVia's
  // CUSTOMER price, not our net — broker bookings get no cashbook/SmartBill.
  const totalPrice = parsePrice(pick('totalPrice', 'price', 'amount', 'TotalPrice'));

  return {
    ref,
    plate,
    dropoffAt,
    pickupAt,
    days: deriveDays(dropoffAt, pickupAt),
    totalPrice,
    contact: {
      // PROVISIONAL: confirm customer field names.
      name: pick('customerName', 'leadName', 'CustomerName'),
      email: pick('customerEmail', 'email', 'CustomerEmail').toLowerCase(),
      phone: pick('customerPhone', 'phone', 'CustomerPhone'),
    },
    brokerName: PARKVIA_BROKER_NAME,
    rawStatus: normalizeStatus(raw),
  };
}

// ── Small pure helpers used by the mapper (also test-covered) ───────────────

// PROVISIONAL: replace with a real parser once the ParkCloud datetime format
// (and whether it carries a timezone) is known. Returns an ISO string or ''.
export function toIso(v) {
  if (!v) return '';
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : '';
}

// Billing-days: ceil of the span, 2h grace applied once, min 1 — mirrors the
// billing-days rule used across the app (see documentation long-term bookings).
export function deriveDays(dropoffIso, pickupIso) {
  const a = Date.parse(dropoffIso);
  const b = Date.parse(pickupIso);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 1;
  const GRACE_MS = 2 * 60 * 60 * 1000;
  return Math.max(1, Math.ceil((b - a - GRACE_MS) / (24 * 60 * 60 * 1000)));
}

function parsePrice(v) {
  const n = Number(String(v).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Firestore doc-ids can't contain '/'. Sanitise a ParkVia ref for use as the
// parkviaImports/{ref} ledger doc-id.
export function parkviaRefDocId(ref) {
  return String(ref).trim().replace(/[/\\.#$[\]]/g, '_').slice(0, 200);
}
