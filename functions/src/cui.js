// ANAF CUI lookup — Romanian fiscal-code → company-record bridge.
//
// Public ANAF endpoint: POST https://webservicesp.anaf.ro/PlatitorTvaRest/api/v9/ws/tva
// Body: [{ cui: '14186770', data: '2026-05-12' }]
// Returns: { found: [{ date_generale: {...} }], notFound: [...] }
//
// Called from BillingFields.js via services/cuiService.lookupCui(). We wrap
// it in a callable to dodge browser CORS and to add a Firestore-backed 24h
// cache (lookupCache/cui_{value}) so we don't hammer ANAF with the same
// number on every keystroke through the form.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import https from 'node:https';

const ANAF_HOST = 'webservicesp.anaf.ro';
const ANAF_PATH = '/PlatitorTvaRest/api/v9/ws/tva';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeCui(input) {
  return String(input || '').trim().toUpperCase().replace(/^RO\s*/, '').replace(/\s+/g, '');
}

// ANAF resets Node's undici-based fetch (ECONNRESET) from GCP egress —
// likely HTTP/2 or strict TLS profile. Use the classic https module with
// forced HTTP/1.1 + a relaxed TLS minimum so the handshake completes.
function anafRequest(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: ANAF_HOST,
      path: ANAF_PATH,
      method: 'POST',
      port: 443,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'MangoParking/1.0 (rezervari@mangoparking.ro)',
        'Connection': 'close',
      },
      // ANAF still negotiates older TLS suites; let Node pick anything from
      // TLSv1 upwards rather than the Node 22 default of TLSv1.2+.
      minVersion: 'TLSv1',
      timeout: 15_000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

export const lookupCui = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const cui = normalizeCui(request.data?.cui);
    if (!cui || !/^\d{2,10}$/.test(cui)) {
      throw new HttpsError('invalid-argument', 'CUI must be 2–10 digits');
    }

    const db = getFirestore();
    const cacheRef = db.collection('lookupCache').doc(`cui_${cui}`);
    const cached = await cacheRef.get();
    if (cached.exists) {
      const data = cached.data();
      if (data.expiresAt && Date.parse(data.expiresAt) > Date.now()) {
        return data.payload;
      }
    }

    // ANAF publishes the day's snapshot the following morning. Use
    // yesterday so a request made early on day X still finds the company.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);

    let res;
    try {
      res = await anafRequest([{ cui: Number(cui), data: yesterday }]);
    } catch (err) {
      console.warn('ANAF network error:', {
        message: err?.message,
        code: err?.code,
      });
      return { error: 'network' };
    }

    if (res.status < 200 || res.status >= 300) {
      console.warn('ANAF HTTP', res.status, res.body?.slice(0, 200));
      return { error: `anaf-${res.status}` };
    }

    let body;
    try {
      body = JSON.parse(res.body);
    } catch {
      console.warn('ANAF bad JSON:', res.body?.slice(0, 200));
      return { error: 'bad-json' };
    }

    // Log enough to diagnose shape issues without dumping PII — keys + counts.
    console.log('lookupCui:', JSON.stringify({
      cui,
      cod: body?.cod,
      message: body?.message,
      foundCount: Array.isArray(body?.found) ? body.found.length : 0,
      notFoundCount: Array.isArray(body?.notFound) ? body.notFound.length : 0,
      firstHitKeys: Array.isArray(body?.found) && body.found[0] ? Object.keys(body.found[0]) : [],
    }));

    const hit = Array.isArray(body?.found) ? body.found[0] : null;
    if (!hit) {
      return { error: 'not_found' };
    }

    // v9 splits company info across several nested blocks. Address is more
    // reliable from `adresa_sediu_social` than from `date_generale.adresa`,
    // which is sometimes blank. Fall back through both.
    const g = hit.date_generale || {};
    const vat = hit.inregistrare_scop_Tva || {};
    const seat = hit.adresa_sediu_social || {};

    const seatAddress = [
      seat.sdenumire_Strada && `${seat.sdenumire_Strada} ${seat.snumar_Strada || ''}`.trim(),
      seat.sdenumire_Localitate || seat.sdenumire_Judet,
      seat.scod_Postal,
    ].filter(Boolean).join(', ');

    const payload = {
      companyName: g.denumire || '',
      address: g.adresa || seatAddress || '',
      // Locality + county surfaced separately: SmartBill requires localitate as
      // its own mandatory field for PJ invoices (the full address isn't enough).
      locality: seat.sdenumire_Localitate || '',
      county: seat.sdenumire_Judet || '',
      regCom: g.nrRegCom || '',
      vatPayer: Boolean(vat.scpTVA),
      cui,
    };

    // Best-effort cache — a Firestore blip must not fail a lookup that
    // already succeeded against ANAF.
    await cacheRef.set({
      payload,
      cachedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
    }).catch((err) => console.warn('lookupCui cache write failed:', err?.message));

    return payload;
  }
);
