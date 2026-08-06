// ParkVia (ParkCloud) auto-import — REST/XML integration. LIVE since 2026-07-23.
// See documentation/features/parkvia.md for the full picture.
//
// GOAL: reservations made through ParkVia appear as broker bookings
// automatically, instead of being re-typed at the admin desk.
//
// MODEL: ParkVia's operator technology is the ParkCloud Operator API — a
// REST/XML service on Azure API Management with API-key auth, PULL/poll (no
// push webhook). It is EVENT-based: NEW/AMEND/CANCEL/NOSHOW rows with
// increasing ids. The sync polls an OVERLAPPING age window (not a strict
// since/{id} cursor — see parkviaWindowHours below for why) and the
// parkviaImports ledger dedups re-seen events. A scheduled job (every 15 min)
// + an admin "Sync now" button drive runParkviaSync (index.js).
//
// CONFIG-GATED, NOT DORMANT. Everything runs off parkviaConfig(): with no
// ParkCloud credentials it returns { configured: false } and the poller is a
// logged no-op, the callables return { configured: false }, and the admin card
// shows "not configured". Production IS configured — PARKVIA_SUBSCRIPTION_KEY +
// PARKVIA_OPERATOR_KEY as secrets, PARKVIA_PARKING_ID (15777) + PARKVIA_BASE_URL
// in functions/.env.mango-parking.
//
// Endpoints, auth, the <Booking> schema, the datetime format and the No-Show
// verb were all CONFIRMED live on 2026-07-23 (see the per-function comments).
// The one area still provisional is how AMENDMENTS are signalled, so
// reconcileParkviaBooking (index.js) auto-applies safe date fields only.
// The whole XML→booking mapping stays quarantined in
// mapParkviaBookingToImport() and is unit-tested (functions/test/).

import { parseStringPromise, processors } from 'xml2js';
import { defineSecret } from 'firebase-functions/params';
// Bucharest wall-time + billing-days rules, shared with the Parkos importer so
// the two broker adapters can't drift apart. Re-exported below because the
// mapper tests (and index.js) have always imported deriveDays from here.
import { bucharestOffsetMin, deriveDays } from './roTime.js';
export { deriveDays };
export const PARKVIA_SUBSCRIPTION_KEY = defineSecret('PARKVIA_SUBSCRIPTION_KEY');
export const PARKVIA_OPERATOR_KEY = defineSecret('PARKVIA_OPERATOR_KEY');
export const PARKVIA_SECRETS = [PARKVIA_SUBSCRIPTION_KEY, PARKVIA_OPERATOR_KEY];

// Hard timeout — this runs inside a scheduled job and an admin callable; a hung
// ParkCloud request must not stall the function until the platform kill.
const PARKVIA_TIMEOUT_MS = 12_000;

// The broker name stamped on imported bookings (matches the manual desk value).
export const PARKVIA_BROKER_NAME = 'ParkVia';

// ── Configuration gate ──────────────────────────────────────────────────────
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
//
// CONFIRMED auth model (2026-07-23, live against the gateway): the Azure APIM
// subscription key goes in the Ocp-Apim-Subscription-Key header, and the
// ParkCloud operator key is the `key` QUERY PARAMETER (portal URL template:
// /rest/operator/v1.svc/operators[?key]). No operator-key header exists.
const PARKVIA_SERVICE_PREFIX = '/rest/operator/v1.svc';

async function parkviaRequest(path, { method = 'GET', body } = {}) {
  const cfg = parkviaConfig();
  if (!cfg.configured) throw new Error('ParkVia not configured');

  const url = new URL(`${cfg.baseUrl}${PARKVIA_SERVICE_PREFIX}${path}`);
  url.searchParams.set('key', cfg.opKey);

  let res;
  try {
    res = await fetch(url, {
      method,
      signal: AbortSignal.timeout(PARKVIA_TIMEOUT_MS),
      headers: {
        'Ocp-Apim-Subscription-Key': cfg.subKey,   // Azure APIM subscription key
        Accept: 'application/xml',
        ...(body ? { 'Content-Type': 'application/xml' } : {}),
      },
      // body may be '' — ParkCloud's IIS backend replies 411 Length Required
      // to write verbs without a Content-Length, so an explicit empty body
      // (→ content-length: 0) must survive this spread.
      ...(body != null ? { body } : {}),
    });
  } catch (err) {
    throw new Error(err?.name === 'TimeoutError' || err?.name === 'AbortError'
      ? `ParkVia: timeout after ${PARKVIA_TIMEOUT_MS / 1000}s`
      : `ParkVia: ${err?.message || 'network error'}`, { cause: err });
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`ParkVia HTTP ${res.status}${text ? `: ${String(text).slice(0, 200)}` : ''}`);
  }
  // Write-style operations (Register No Show) may reply with an empty 2xx body.
  if (!text.trim()) return null;
  return parseParkviaXml(text);
}

// Shared XML→object parse — exported so the mapper tests parse fixtures with
// EXACTLY the runtime options. stripPrefix matters: ParkCloud namespaces child
// elements (e.g. <d2p1:Registration> inside <Vehicle>) with arbitrary prefixes,
// and nil attributes arrive as i:nil.
export function parseParkviaXml(text) {
  return parseStringPromise(text, {
    explicitArray: false,
    trim: true,
    tagNameProcessors: [processors.stripPrefix],
    attrNameProcessors: [processors.stripPrefix],
  });
}

// Nil-aware text extraction. ParkCloud renders empty fields two ways: an empty
// element (→ '') and an explicit <Field i:nil="true"/> (→ { $: { nil: 'true' } }
// after parsing) — String() on the latter would yield "[object Object]".
export function xmlText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.$ && String(v.$.nil).toLowerCase() === 'true') return '';
    return typeof v._ === 'string' ? v._.trim() : '';
  }
  return String(v).trim();
}

// ── Endpoints ───────────────────────────────────────────────────────────────

// CONFIRMED (2026-07-23): lists the operators visible to this account.
// GET /operators → <ArrayOfOperator xmlns="http://parkcloud.net/operator">
//   <Operator><Id>15777</Id><Name>ManGo Parking - …</Name></Operator>…
// Used by the healthcheck as a cheap, known-good reachability probe.
export async function listParkviaOperators() {
  const parsed = await parkviaRequest('/operators');
  const node = parsed?.ArrayOfOperator?.Operator ?? [];
  return (Array.isArray(node) ? node : [node])
    .filter(Boolean)
    .map((o) => ({ id: String(o.Id ?? '').trim(), name: String(o.Name ?? '').trim() }));
}

// CONFIRMED (2026-07-23): booking-change events — the sync driver. ParkCloud
// is event-based: NEW / AMEND / CANCEL / NOSHOW rows, each with a
// monotonically-increasing Id. The sync polls by age window
// (…/bookings/events/age/{hours} — verified up to 720h); the since/{id}
// variant remains supported for diagnostics but ids become VISIBLE out of
// order, so it must not be used as a strict cursor (see parkviaWindowHours).
// GET → <ArrayOfEvent><Event><Id>34407328</Id><Date>2026-07-03T14:00:06.757</Date>
//        <Type>NEW</Type><BookingReference>PC90243780</BookingReference></Event>…
export async function listParkviaEvents({ sinceId, hours } = {}) {
  const cfg = parkviaConfig();
  const path = sinceId != null
    ? `/operator/${encodeURIComponent(cfg.parkingId)}/bookings/events/since/${encodeURIComponent(sinceId)}`
    : `/operator/${encodeURIComponent(cfg.parkingId)}/bookings/events/age/${encodeURIComponent(hours || 24)}`;
  const parsed = await parkviaRequest(path);
  const node = parsed?.ArrayOfEvent?.Event ?? [];
  return (Array.isArray(node) ? node : [node])
    .filter(Boolean)
    .map((e) => ({
      id: Number(xmlText(e.Id)),
      date: xmlText(e.Date),
      type: String(xmlText(e.Type)).toUpperCase(),   // NEW | AMEND | CANCEL | NOSHOW
      ref: xmlText(e.BookingReference),
    }))
    .filter((e) => Number.isFinite(e.id) && e.ref);
}

// CONFIRMED (2026-07-23): the full, current state of one booking — what the
// mapper consumes. GET /operator/{id}/booking/{reference} → <Booking>…</Booking>
// (Reference, Status ENQUIRY|CONFIRMED|CANCELLED, AmountPaid/AmountDue/Currency,
// ArrivalDate/DepartureDate as LOCAL wall-time without offset, Customer,
// Vehicle→Registration, Passengers(+Child/Infant), Outbound/ReturnFlight,
// IsNoShow). Returns the raw parsed Booking node.
export async function getParkviaBookingDetails(ref) {
  const cfg = parkviaConfig();
  const path = `/operator/${encodeURIComponent(cfg.parkingId)}/booking/${encodeURIComponent(ref)}`;
  const parsed = await parkviaRequest(path);
  return parsed?.Booking ?? {};
}

// Register No Show — tells ParkVia the customer never arrived:
// PUT /operator/{operator_id}/booking/{reference}/NoShow. The portal lists the
// operation without a verb; probed live 2026-07-23 — POST/GET get APIM's
// "Resource not found", PUT routes through (a fake ref draws the service's own
// "Invalid booking reference" error, proving template + verb). Empty body with
// an explicit content-length (see parkviaRequest). Any 2xx counts as accepted.
// The subsequent NOSHOW event ParkCloud emits is a harmless echo — the sync
// loop re-fetches details and reconciles to 'unchanged' (Status stays
// CONFIRMED, only IsNoShow flips).
export async function registerParkviaNoShow(ref) {
  const cfg = parkviaConfig();
  const path = `/operator/${encodeURIComponent(cfg.parkingId)}/booking/${encodeURIComponent(ref)}/NoShow`;
  await parkviaRequest(path, { method: 'PUT', body: '' });
  return { ok: true };
}

// ── Status normalisation (CONFIRMED enum) ───────────────────────────────────
// Booking.Status per the portal docs: ENQUIRY (not yet confirmed — do not
// import), CONFIRMED, CANCELLED (cancelled or refunded).
export function normalizeStatus(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'CANCELLED') return 'cancelled';
  if (s === 'ENQUIRY') return 'enquiry';
  return 'active';                                   // CONFIRMED (default-safe)
}

// ── THE isolated adapter — finalized 2026-07-23 against two real bookings ───
// ── (PC90288686 / PC90243780; raw copies in documentation/parkvia-response.txt,
// ── gitignored). Pure function, no I/O — unit-tested against a real-shaped
// ── fixture (functions/test/parkvia.mapper.test.js).
//
// Maps a parsed <Booking> node (parseParkviaXml + stripPrefix) → the import
// param object consumed by createBrokerBookingCore (index.js). Normalisation
// happens HERE (ISO instants, billing days, upper-cased plate) so the rest of
// the pipeline is schema-agnostic.
//
// Returns { ref, plate, dropoffAt, pickupAt, days, totalPrice, amountDue,
//           currency, passengers, flightNumberDropoff, flightNumberPickup,
//           contact:{name,email,phone}, brokerName, rawStatus }.
// Throws if a load-bearing field (ref, plate, both dates) is missing, so the
// poller counts it as an error and skips it rather than importing garbage.
export function mapParkviaBookingToImport(raw = {}) {
  const ref = xmlText(raw.Reference);
  const plate = xmlText(raw.Vehicle?.Registration).toUpperCase().replace(/[\s-]/g, '');
  // ArrivalDate / DepartureDate arrive as naive local wall-time
  // ("2026-07-20T11:00:00", no offset) — interpreted as Europe/Bucharest, the
  // car park's zone, and converted to real instants (the app-wide convention).
  const dropoffAt = parkcloudLocalToIso(xmlText(raw.ArrivalDate));
  const pickupAt = parkcloudLocalToIso(xmlText(raw.DepartureDate));

  if (!ref) throw new Error('ParkVia mapping: missing booking reference');
  if (!plate) throw new Error(`ParkVia mapping: missing plate (ref ${ref})`);
  if (!dropoffAt || !pickupAt) throw new Error(`ParkVia mapping: missing/invalid dates (ref ${ref})`);

  // ParkVia's CUSTOMER price, not our net — broker bookings get no
  // cashbook/SmartBill. AmountDue > 0 means pay-on-arrival money the desk must
  // still collect; the importer surfaces it in the booking notes.
  const amountPaid = parsePrice(xmlText(raw.AmountPaid));
  const amountDue = parsePrice(xmlText(raw.AmountDue));
  const c = raw.Customer || {};
  const passengers =
    (Number(xmlText(raw.Passengers)) || 0) +
    (Number(xmlText(raw.PassengersChild)) || 0) +
    (Number(xmlText(raw.PassengersInfant)) || 0);

  return {
    ref,
    plate,
    dropoffAt,
    pickupAt,
    days: deriveDays(dropoffAt, pickupAt),
    totalPrice: amountPaid + amountDue,
    amountDue,
    currency: xmlText(raw.Currency) || 'RON',
    passengers: passengers > 0 ? passengers : null,
    flightNumberDropoff: xmlText(raw.OutboundFlight) || null,
    flightNumberPickup: xmlText(raw.ReturnFlight) || null,
    contact: {
      name: [xmlText(c.FirstName), xmlText(c.Surname)].filter(Boolean).join(' '),
      email: xmlText(c.Email).toLowerCase(),
      phone: xmlText(c.Mobile),
    },
    brokerName: PARKVIA_BROKER_NAME,
    rawStatus: normalizeStatus(xmlText(raw.Status)),
  };
}

// ── Poll window (test-covered) ──────────────────────────────────────────────
// The events feed is polled with an OVERLAPPING age window, never a strict
// since/{lastEventId} cursor. Learned live (2026-07-29, PC90417080): ParkCloud
// publishes event rows LATE and OUT OF ID ORDER — a NEW event stamped 11:17
// was still absent from the feed at 12:21 while a 12:08 event with a higher id
// was already served. A strict cursor fast-forwards past the late row and the
// reservation is silently lost. The overlap re-serves recent events every run;
// the parkviaImports ledger decides what still needs work.
export const PARKVIA_FEED_MAX_HOURS = 720;   // deepest the feed goes (verified live)
export const PARKVIA_LOOKBACK_HOURS = 72;    // rolling overlap on a normal run

// Hours of events to request this run: the rolling lookback, stretched to
// cover poller downtime (gap since the last successful sync + a day of
// margin), capped at the feed maximum. Never synced → everything the feed has.
export function parkviaWindowHours(lastSyncAt, nowMs) {
  const last = Date.parse(lastSyncAt || '');
  if (!Number.isFinite(last)) return PARKVIA_FEED_MAX_HOURS;
  const gapHours = Math.ceil(Math.max(0, nowMs - last) / 3_600_000);
  return Math.min(PARKVIA_FEED_MAX_HOURS, Math.max(PARKVIA_LOOKBACK_HOURS, gapHours + 24));
}

// ── Small pure helpers used by the mapper (also test-covered) ───────────────

// ParkCloud datetimes are naive wall-clock strings in the car park's zone.
// Convert "yyyy-MM-ddTHH:mm:ss(.fff)" (Europe/Bucharest) → a real ISO instant,
// resolving the +02:00/+03:00 (EET/EEST) offset for that specific date via Intl.
export function parkcloudLocalToIso(v) {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return '';
  const [, y, mo, d, h, mi, se] = m;
  const wallAsUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(se || 0));
  if (!Number.isFinite(wallAsUtc)) return '';
  return new Date(wallAsUtc - bucharestOffsetMin(new Date(wallAsUtc)) * 60_000).toISOString();
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
