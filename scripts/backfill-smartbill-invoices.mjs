#!/usr/bin/env node
/**
 * One-off backfill: issue the fiscal invoices that were never raised for
 * POS-card payments taken before the 2026-08-05 rule change.
 *
 * Background: until 2026-08-05 a card payment at the desk was filed with cash
 * as "pay-at-location", which issued a proforma at most and often nothing at
 * all. The live code now issues a fiscal invoice for card (decision 1b in
 * documentation/roadmap/v.1.2_smartbill.md) but only for NEW payments — this
 * script covers the ones already taken.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A FISCAL INVOICE CANNOT BE DELETED. It takes a sequential number in the
 * fiscal series and enters the accounting record; a mistake has to be reversed
 * with a storno, leaving two wrong documents instead of none. Hence:
 *   • dry run is the DEFAULT — nothing is sent without --live
 *   • the booking codes must be listed explicitly; there is no "all" mode
 *   • a booking that already carries smartbill.invoice is skipped
 *   • billing is re-checked with the same gate the server uses
 *   • issuing stops at the first failure instead of continuing down the list
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Usage:
 *   # 1. credentials (PowerShell)
 *   $env:SMARTBILL_USERNAME = (firebase functions:secrets:access SMARTBILL_USERNAME)
 *   $env:SMARTBILL_TOKEN    = (firebase functions:secrets:access SMARTBILL_TOKEN)
 *   $env:SMARTBILL_CIF      = (firebase functions:secrets:access SMARTBILL_CIF)
 *
 *   # 2. dry run — prints the exact payload for each, sends nothing
 *   node scripts/backfill-smartbill-invoices.mjs LT-EC8LV LT-FKWKE
 *
 *   # 3. issue for real, dated the day each payment was taken
 *   node scripts/backfill-smartbill-invoices.mjs --live --issue-date=payment LT-EC8LV
 *
 * Options:
 *   --live                  actually issue (default: dry run)
 *   --issue-date=payment    date each invoice on the day the money was taken
 *   --issue-date=YYYY-MM-DD date them all on a specific day
 *   (default)               today, Europe/Bucharest
 *
 * Firestore access reuses the Firebase CLI login, so `firebase login` must
 * already be done. No extra dependencies.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PROJECT = 'mango-parking';
const SB_BASE = 'https://ws.smartbill.ro/SBORO/api';
const INVOICE_SERIES = 'Mango';          // fiscal series (type 'f')
const VAT_PERCENT = 21;
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// Firebase CLI's public OAuth client — the same pair the CLI itself uses.
const CLI_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CLI_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

// ── args ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const live = argv.includes('--live');
const issueDateArg = (argv.find((a) => a.startsWith('--issue-date=')) || '').split('=')[1] || '';
const codes = argv.filter((a) => !a.startsWith('--'));

if (!codes.length) {
  console.error('Refusing to run with no booking codes.\n'
    + 'Usage: node scripts/backfill-smartbill-invoices.mjs [--live] [--issue-date=payment|YYYY-MM-DD] LT-XXXXX ...');
  process.exit(1);
}

const bucharestToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(new Date());

// ── auth ────────────────────────────────────────────────────────────────
async function firestoreToken() {
  const cfg = join(homedir(), '.config', 'configstore', 'firebase-tools.json');
  const refresh = JSON.parse(readFileSync(cfg, 'utf8'))?.tokens?.refresh_token;
  if (!refresh) throw new Error('No Firebase CLI refresh token — run `firebase login` first.');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLI_CLIENT_ID,
      client_secret: CLI_CLIENT_SECRET,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(data).slice(0, 200)}`);
  return data.access_token;
}

function smartbillAuth() {
  const user = process.env.SMARTBILL_USERNAME;
  const token = process.env.SMARTBILL_TOKEN;
  const cif = process.env.SMARTBILL_CIF;
  if (!user || !token || !cif) {
    throw new Error('Set SMARTBILL_USERNAME, SMARTBILL_TOKEN and SMARTBILL_CIF (see the header of this file).');
  }
  return { header: 'Basic ' + Buffer.from(`${user}:${token}`).toString('base64'), cif };
}

// ── Firestore REST ──────────────────────────────────────────────────────
const decode = (f) => {
  if (!f) return null;
  for (const k of ['stringValue', 'booleanValue', 'timestampValue']) if (k in f) return f[k];
  if ('integerValue' in f) return Number(f.integerValue);
  if ('doubleValue' in f) return Number(f.doubleValue);
  if ('nullValue' in f) return null;
  if ('mapValue' in f) {
    return Object.fromEntries(Object.entries(f.mapValue.fields || {}).map(([k, v]) => [k, decode(v)]));
  }
  if ('arrayValue' in f) return (f.arrayValue.values || []).map(decode);
  return null;
};

const encode = (v) => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)])) } };
};

async function findBookingByCode(accessToken, code) {
  const res = await fetch(`${FS_BASE}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'bookings' }],
        where: { fieldFilter: { field: { fieldPath: 'code' }, op: 'EQUAL', value: { stringValue: code } } },
        limit: 2,
      },
    }),
  });
  const rows = (await res.json()).filter((r) => r.document);
  if (rows.length !== 1) return null;
  const doc = rows[0].document;
  return {
    id: doc.name.split('/').pop(),
    data: Object.fromEntries(Object.entries(doc.fields).map(([k, v]) => [k, decode(v)])),
  };
}

// Merge-and-write the whole `smartbill` map: we read it first, so the existing
// proforma block is preserved rather than clobbered.
async function stampInvoice(accessToken, bookingId, smartbill) {
  const res = await fetch(
    `${FS_BASE}/bookings/${bookingId}?updateMask.fieldPaths=smartbill`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { smartbill: encode(smartbill) } }),
    },
  );
  if (!res.ok) throw new Error(`Firestore stamp failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}

// Same, for the order the booking was paid through — read-modify-write so the
// existing proforma block survives.
async function stampOrderInvoice(accessToken, orderId, stamp) {
  const cur = await fetch(`${FS_BASE}/pendingOrders/${orderId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!cur.ok) throw new Error(`read failed: HTTP ${cur.status}`);
  const doc = await cur.json();
  const existing = doc.fields?.smartbill ? decode(doc.fields.smartbill) : {};
  const res = await fetch(
    `${FS_BASE}/pendingOrders/${orderId}?updateMask.fieldPaths=smartbill`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { smartbill: encode({ ...existing, ...stamp }) } }),
    },
  );
  if (!res.ok) throw new Error(`PATCH failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}

// ── mirrors of the server logic (functions/src/smartbill.js + index.js) ──
function checkBillingComplete(billing = {}) {
  const missing = [];
  const abroad = billing.abroad === true;
  if (billing.type === 'PJ') {
    if (!String(billing.cui || '').trim()) missing.push('cui');
    if (!String(billing.companyName || '').trim()) missing.push('companyName');
    if (!String(billing.regCom || '').trim()) missing.push('regCom');
  } else if (!String(billing.name || `${billing.firstName || ''} ${billing.lastName || ''}`).trim()) {
    missing.push('name');
  }
  if (!abroad) {
    if (!String(billing.locality || '').trim()) missing.push('locality');
    if (!String(billing.county || '').trim()) missing.push('county');
  }
  return { ok: missing.length === 0, missing };
}

function buildInvoicePayload({ billing = {}, items = [], seriesName, issueDate, cif }) {
  const isPJ = billing.type === 'PJ';
  const abroad = billing.abroad === true;
  const city = abroad ? 'BUCURESTI' : (billing.locality || '');
  const county = abroad ? 'BUCURESTI' : (billing.county || '');
  const client = isPJ
    ? {
      name: billing.companyName || '', vatCode: billing.cui || '', regCom: billing.regCom || '',
      isTaxPayer: billing.isVatPayer === true, address: billing.companyAddress || '',
      city, county, country: 'Romania', email: billing.email || '', saveToDb: false,
    }
    : {
      name: billing.name || [billing.firstName, billing.lastName].filter(Boolean).join(' '),
      vatCode: billing.cnp || (abroad ? '0000000000000' : ''), isTaxPayer: false,
      address: billing.address || '', city, county, country: 'Romania',
      email: billing.email || '', saveToDb: false,
    };
  return {
    companyVatCode: cif,
    client,
    seriesName,
    issueDate,
    isDraft: false,
    products: items.map((it) => ({
      name: it.name, code: it.code || '', measuringUnitName: 'buc', currency: 'RON',
      quantity: Number(it.quantity) || 1, price: Number(it.price) || 0,
      isTaxIncluded: true, taxName: 'Normala', taxPercentage: VAT_PERCENT,
      saveToDb: false, isService: true,
    })),
  };
}

// ── main ────────────────────────────────────────────────────────────────
const accessToken = await firestoreToken();
const sb = live ? smartbillAuth() : { cif: process.env.SMARTBILL_CIF || '<CIF>' , header: null };

console.log(live
  ? '\n*** LIVE — invoices WILL be issued in SmartBill and cannot be deleted ***\n'
  : '\n--- DRY RUN — nothing is sent to SmartBill (add --live to issue) ---\n');

const planned = [];
for (const code of codes) {
  const found = await findBookingByCode(accessToken, code);
  if (!found) { console.log(`${code}: SKIP — not found (or code not unique)`); continue; }
  const { id, data } = found;

  if (data.smartbill?.invoice?.number) {
    console.log(`${code}: SKIP — already invoiced (${data.smartbill.invoice.series} ${data.smartbill.invoice.number})`);
    continue;
  }
  const gate = checkBillingComplete(data.billing || {});
  if (!gate.ok) {
    console.log(`${code}: SKIP — billing incomplete, missing: ${gate.missing.join(', ')}`);
    continue;
  }

  // The CHARGED amount, matching what the live code invoices. totalPrice is
  // the gross and would over-invoice a discounted booking.
  const amount = Number(data.totalPrice) || 0;
  const issueDate = issueDateArg === 'payment'
    ? String(data.paidAt || '').slice(0, 10) || bucharestToday()
    : (/^\d{4}-\d{2}-\d{2}$/.test(issueDateArg) ? issueDateArg : bucharestToday());

  const payload = buildInvoicePayload({
    billing: { ...(data.billing || {}), email: data.billing?.email || data.contact?.email || '' },
    items: [{
      name: `Servicii parcare conform rezervării ${data.code}`,
      quantity: 1, price: amount, code: 'PARK-LT',
    }],
    seriesName: INVOICE_SERIES,
    issueDate,
    cif: sb.cif,
  });

  console.log(`\n${code}  (${id})`);
  console.log(`  amount     ${amount} lei      issueDate ${issueDate}`);
  console.log(`  client     ${payload.client.name} | ${payload.client.city}, ${payload.client.county}`);
  console.log(`  payload    ${JSON.stringify(payload)}`);
  planned.push({ code, id, data, payload });
}

if (!planned.length) {
  console.log('\nNothing to do.\n');
  process.exit(0);
}

console.log(`\n${planned.length} invoice(s) ready.`);
if (!live) {
  console.log('Dry run — re-run with --live to issue.\n');
  process.exit(0);
}

for (const p of planned) {
  process.stdout.write(`Issuing ${p.code} ... `);
  const res = await fetch(`${SB_BASE}/invoice`, {
    method: 'POST',
    headers: { Authorization: sb.header, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(p.payload),
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { _raw: text }; }
  // SmartBill can return HTTP 200 with an errorText — status alone is not enough.
  if (data?.errorText || !res.ok) {
    console.log('FAILED');
    console.error(`  ${data?.errorText || `HTTP ${res.status}: ${text.slice(0, 200)}`}`);
    console.error('  Stopping — the remaining invoices were NOT issued.');
    process.exit(1);
  }
  console.log(`OK  ${data.series} ${data.number}`);

  const stamp = {
    invoice: { series: data.series ?? INVOICE_SERIES, number: data.number ?? null, issuedAt: new Date().toISOString() },
    status: 'invoiced',
    backfilledAt: new Date().toISOString(),
  };
  await stampInvoice(accessToken, p.id, { ...(p.data.smartbill || {}), ...stamp });
  console.log('  stamped on the booking');

  // Mirror onto the linked order. The live code stamps both refs, and the
  // "which card payments are missing an invoice?" audit query runs over
  // pendingOrders (paidBy == 'admin-card' && smartbill.status == 'failed') —
  // leaving the order at 'failed' would re-flag a payment that is now invoiced.
  if (p.data.paymentId) {
    await stampOrderInvoice(accessToken, p.data.paymentId, stamp)
      .then(() => console.log('  mirrored onto the order'))
      .catch((err) => console.warn(`  ! order mirror failed (booking is stamped): ${err.message}`));
  }
}
console.log('\nDone.\n');
