// Flight-status lookup — provider-agnostic bridge that lets the admin board
// flag a reservation whose flight is delayed or cancelled.
//
// DORMANT BY DEFAULT. With no API key configured the callable returns
// { configured: false } and the UI shows nothing — so this deploys safely
// before a provider is chosen. To enable, supply a key + provider via EITHER:
//
//   • a dotenv file Firebase auto-loads:  functions/.env.mango-parking
//         FLIGHT_API_PROVIDER=aerodatabox
//         FLIGHT_API_KEY=xxxxxxxx
//         # FLIGHT_API_HOST=aerodatabox.p.rapidapi.com   (optional override)
//
//   • or a Gen2 secret — run `firebase functions:secrets:set FLIGHT_API_KEY`,
//     then uncomment the two lines marked [SECRET] below and redeploy.
//
// Providers implemented: 'aerodatabox' (RapidAPI, recommended) and
// 'aviationstack'. Both normalize to one shape; add another by extending
// PROVIDERS. Results cache in flightStatusCache/{key} for CACHE_TTL so repeated
// admin views don't re-bill the third party (the on-demand + cached model).

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
// [SECRET] import { defineSecret } from 'firebase-functions/params';
// [SECRET] const FLIGHT_API_KEY = defineSecret('FLIGHT_API_KEY');

const CACHE_TTL_MS = 15 * 60 * 1000;   // 15 min — matches the on-demand model
const MAX_ITEMS = 40;                  // batch cap per call
const LOOKAHEAD_DAYS = 7;              // don't bill for far-future flights
const LOOKBEHIND_DAYS = 2;             // …or long-past ones

function normalizeFlightNo(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function apiConfig() {
  const key = process.env.FLIGHT_API_KEY || '';
  const provider = (process.env.FLIGHT_API_PROVIDER || (key ? 'aerodatabox' : '')).toLowerCase();
  const host = process.env.FLIGHT_API_HOST || '';
  return { key, provider, host };
}

async function fetchJson(url, headers) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* leave null */ }
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function minutesBetween(aIso, bIso) {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 60000);
}

// ── Provider adapters ── each returns the normalized shape or { found:false }.
// A thrown error / bad shape is caught by the caller and treated as a miss, so
// a provider hiccup never surfaces a wrong warning.
const PROVIDERS = {
  // AeroDataBox (RapidAPI): GET /flights/number/{number}/{date}
  async aerodatabox(flightNo, date, { key, host }) {
    const h = host || 'aerodatabox.p.rapidapi.com';
    const url = `https://${h}/flights/number/${encodeURIComponent(flightNo)}/${date}?withAircraftImage=false&withLocation=false`;
    const { status, json } = await fetchJson(url, {
      'X-RapidAPI-Key': key,
      'X-RapidAPI-Host': h,
      Accept: 'application/json',
    });
    if (status < 200 || status >= 300 || !Array.isArray(json) || !json.length) return { found: false };
    const f = json[0];
    const st = String(f.status || '').toLowerCase();
    const dep = f.departure || {};
    const arr = f.arrival || {};
    const depSched = dep.scheduledTime?.utc || dep.scheduledTime?.local || null;
    const depAct = dep.revisedTime?.utc || dep.runwayTime?.utc || dep.actualTime?.utc || null;
    const arrSched = arr.scheduledTime?.utc || arr.scheduledTime?.local || null;
    const arrAct = arr.revisedTime?.utc || arr.predictedTime?.utc || arr.actualTime?.utc || null;
    return {
      found: true,
      cancelled: /cancel/.test(st),
      diverted: /divert/.test(st),
      status: st,
      departureDelayMinutes: depSched && depAct ? minutesBetween(depSched, depAct) : null,
      arrivalDelayMinutes: arrSched && arrAct ? minutesBetween(arrSched, arrAct) : null,
      departureScheduled: depSched,
      arrivalScheduled: arrSched,
    };
  },

  // AviationStack: GET /v1/flights?access_key=&flight_iata=&flight_date=
  async aviationstack(flightNo, date, { key }) {
    const url = `https://api.aviationstack.com/v1/flights?access_key=${encodeURIComponent(key)}&flight_iata=${encodeURIComponent(flightNo)}&flight_date=${date}`;
    const { status, json } = await fetchJson(url, { Accept: 'application/json' });
    const row = Array.isArray(json?.data) ? json.data[0] : null;
    if (status < 200 || status >= 300 || !row) return { found: false };
    const st = String(row.flight_status || '').toLowerCase();
    const dep = row.departure || {};
    const arr = row.arrival || {};
    const depDelay = Number.isFinite(Number(dep.delay)) ? Number(dep.delay)
      : (dep.scheduled && (dep.actual || dep.estimated) ? minutesBetween(dep.scheduled, dep.actual || dep.estimated) : null);
    const arrDelay = Number.isFinite(Number(arr.delay)) ? Number(arr.delay)
      : (arr.scheduled && (arr.actual || arr.estimated) ? minutesBetween(arr.scheduled, arr.actual || arr.estimated) : null);
    return {
      found: true,
      cancelled: st === 'cancelled',
      diverted: st === 'diverted',
      status: st,
      departureDelayMinutes: depDelay,
      arrivalDelayMinutes: arrDelay,
      departureScheduled: dep.scheduled || null,
      arrivalScheduled: arr.scheduled || null,
    };
  },
};

function withinWindow(date) {
  const t = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  return t >= now - LOOKBEHIND_DAYS * 864e5 && t <= now + LOOKAHEAD_DAYS * 864e5;
}

async function assertStaff(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be authenticated');
  const snap = await getFirestore().collection('users').doc(request.auth.uid).get();
  const role = snap.exists ? snap.data().role : null;
  if (!['admin', 'agent', 'staff', 'driver'].includes(role)) {
    throw new HttpsError('permission-denied', 'Backoffice access required');
  }
}

// Batch lookup. Input: { items: [{ flightNumber, date }] } (date = YYYY-MM-DD).
// Output: { configured, results: { "FLIGHTNO_DATE": normalized | { found:false } } }.
export const lookupFlightStatuses = onCall(
  { region: 'europe-west1', cors: true /* [SECRET] , secrets: [FLIGHT_API_KEY] */ },
  async (request) => {
    await assertStaff(request);

    const { key, provider, host } = apiConfig();
    const adapter = PROVIDERS[provider];
    if (!key || !adapter) return { configured: false, results: {} };

    const rawItems = Array.isArray(request.data?.items) ? request.data.items.slice(0, MAX_ITEMS) : [];
    // Dedupe by flightNo_date; drop anything outside the useful time window.
    const wanted = new Map();
    for (const it of rawItems) {
      const flightNo = normalizeFlightNo(it?.flightNumber);
      const date = String(it?.date || '').slice(0, 10);
      if (!flightNo || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !withinWindow(date)) continue;
      wanted.set(`${flightNo}_${date}`, { flightNo, date });
    }
    if (!wanted.size) return { configured: true, results: {} };

    const db = getFirestore();
    const results = {};
    await Promise.all([...wanted.entries()].map(async ([mapKey, { flightNo, date }]) => {
      const cacheRef = db.collection('flightStatusCache').doc(`${provider}_${flightNo}_${date}`);
      try {
        const snap = await cacheRef.get();
        if (snap.exists) {
          const d = snap.data();
          if (d.fetchedAt && Date.parse(d.fetchedAt) > Date.now() - CACHE_TTL_MS) {
            results[mapKey] = d.status;
            return;
          }
        }
      } catch { /* fall through to a live fetch */ }

      let normalized;
      try {
        normalized = await adapter(flightNo, date, { key, host });
      } catch (err) {
        console.warn('flight lookup failed', flightNo, date, err?.message);
        normalized = { found: false };
      }
      results[mapKey] = normalized;
      // Cache hits AND misses (a bad flight number shouldn't re-bill each view).
      cacheRef.set({ status: normalized, fetchedAt: new Date().toISOString() }).catch(() => {});
    }));

    return { configured: true, results };
  },
);
