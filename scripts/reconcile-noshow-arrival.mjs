#!/usr/bin/env node
/**
 * Repair a reservation that was flagged `no-show` even though the customer
 * DID arrive — the car was taken in and paid for at the desk, but nothing was
 * recorded in the app, so `markNoShows` (12h after drop-off, still `upcoming`,
 * no activeCheckIns row) correctly concluded a no-show from the state it saw.
 *
 * There is no UI path out of that state: the No-show tab deliberately hides
 * Collect, Check-in needs `upcoming` and Check-out needs `active`, so staff
 * can neither take the money nor put the car back on the board.
 *
 * What it does (all of it optional per flag):
 *   1. issues the fiscal invoice for a POS-CARD collection, dated the day the
 *      money was actually taken (SmartBill, series `Mango`, 21% VAT)
 *   2. marks booking + order paid (`admin-card` / `admin-cash`)
 *   3. puts the booking back to `active` with a real check-in timestamp and
 *      clears the no-show stamps
 *   4. optionally moves the pick-up (REFUSES if the billing-day count would
 *      change — that is a re-price and must go through adminRepriceBooking)
 *   5. assigns an available spot and marks it occupied
 *   6. writes the audit rows the equivalent UI actions would have written,
 *      each carrying `manual: true` + a reason so the trail is honest
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A FISCAL INVOICE CANNOT BE DELETED — it takes a number in the fiscal series
 * and can only be reversed with a storno. Hence:
 *   • dry run is the DEFAULT — nothing is written or sent without --live
 *   • the booking must actually carry the stuck signature (`no-show`) or the
 *     script refuses, so it cannot be pointed at a healthy reservation
 *   • a booking that already has smartbill.invoice is never re-invoiced
 *   • billing is re-checked with the same gate the server uses
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Usage:
 *   # credentials for the invoice step (PowerShell)
 *   $env:SMARTBILL_USERNAME = (firebase functions:secrets:access SMARTBILL_USERNAME)
 *   $env:SMARTBILL_TOKEN    = (firebase functions:secrets:access SMARTBILL_TOKEN)
 *   $env:SMARTBILL_CIF      = (firebase functions:secrets:access SMARTBILL_CIF)
 *
 *   node scripts/reconcile-noshow-arrival.mjs --code=LT-8DVK5 \
 *     --paid-by=card --issue-date=payment --pickup="2026-08-22 02:00"
 *
 *   ... then re-run with --live to apply.
 *
 * Options:
 *   --code=LT-XXXXX        the booking to repair                    (required)
 *   --paid-by=card|cash    how the money was taken       (default: card)
 *   --paid-at=<ISO>        when it was taken     (default: the drop-off time)
 *   --checkin-at=<ISO>     when the car arrived  (default: the drop-off time)
 *   --pickup="YYYY-MM-DD HH:MM"   new pick-up, Europe/Bucharest wall time
 *   --issue-date=payment|YYYY-MM-DD|today   fiscal invoice date (default: payment)
 *   --no-invoice           skip the SmartBill step entirely
 *   --actor=<email|uid>    recorded as the actor on the audit rows
 *   --reason="..."         free text stored on every audit row
 *   --live                 actually write (default: dry run)
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PROJECT = 'mango-parking';
const SB_BASE = 'https://ws.smartbill.ro/SBORO/api';
const INVOICE_SERIES = 'Mango';
const VAT_PERCENT = 21;
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const CLI_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CLI_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';
const GRACE_MS = 2 * 60 * 60 * 1000;

// ── args ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (n) => (argv.find((a) => a.startsWith(`--${n}=`)) || '').split('=').slice(1).join('=');
const live = argv.includes('--live');
const noInvoice = argv.includes('--no-invoice');
const code = flag('code');
const paidByArg = flag('paid-by') || 'card';
const paidAtArg = flag('paid-at');
const checkinAtArg = flag('checkin-at');
const pickupArg = flag('pickup');
const issueDateArg = flag('issue-date') || 'payment';
const actor = flag('actor') || 'scripts/reconcile-noshow-arrival.mjs';
const reason = flag('reason') || 'Customer arrived and paid at the desk; never recorded in the app, so the 12h no-show sweeper flagged it. Retroactive correction.';

if (!code) {
  console.error('--code=LT-XXXXX is required.');
  process.exit(1);
}
if (!['card', 'cash'].includes(paidByArg)) {
  console.error('--paid-by must be card or cash.');
  process.exit(1);
}

// ── Europe/Bucharest wall-clock helpers (mirror src/utils/date.js) ───────
const BUCHAREST_TZ = 'Europe/Bucharest';
function bucharestOffsetMinutes(date) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: BUCHAREST_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  const hour = +p.hour === 24 ? 0 : +p.hour;
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second) - date.getTime()) / 60000);
}
function bucharestLocalToIso(localValue) {
  const m = String(localValue || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0'] = m;
  const guessUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, 0);
  let off = bucharestOffsetMinutes(new Date(guessUtc));
  off = bucharestOffsetMinutes(new Date(guessUtc - off * 60000));
  return new Date(guessUtc - off * 60000).toISOString();
}
function isoToBucharestLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: BUCHAREST_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d).replace('T', ' ');
}
const bucharestDay = (iso) => isoToBucharestLocal(iso).slice(0, 10);
const billingDays = (dropIso, pickIso) => Math.max(1, Math.ceil(
  (Date.parse(pickIso) - Date.parse(dropIso) - GRACE_MS) / 86400000));

// ── auth ────────────────────────────────────────────────────────────────
async function firestoreToken() {
  const cfg = join(homedir(), '.config', 'configstore', 'firebase-tools.json');
  const refresh = JSON.parse(readFileSync(cfg, 'utf8'))?.tokens?.refresh_token;
  if (!refresh) throw new Error('No Firebase CLI refresh token — run `firebase login` first.');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET,
      refresh_token: refresh, grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(data).slice(0, 200)}`);
  return data.access_token;
}
function smartbillAuth() {
  const user = process.env.SMARTBILL_USERNAME;
  const tok = process.env.SMARTBILL_TOKEN;
  const cif = process.env.SMARTBILL_CIF;
  if (!user || !tok || !cif) {
    throw new Error('Set SMARTBILL_USERNAME, SMARTBILL_TOKEN and SMARTBILL_CIF (see the header of this file).');
  }
  return { header: 'Basic ' + Buffer.from(`${user}:${tok}`).toString('base64'), cif };
}

// ── Firestore REST ──────────────────────────────────────────────────────
const decode = (f) => {
  if (!f) return null;
  for (const k of ['stringValue', 'booleanValue', 'timestampValue']) if (k in f) return f[k];
  if ('integerValue' in f) return Number(f.integerValue);
  if ('doubleValue' in f) return Number(f.doubleValue);
  if ('nullValue' in f) return null;
  if ('mapValue' in f) return Object.fromEntries(Object.entries(f.mapValue.fields || {}).map(([k, v]) => [k, decode(v)]));
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
const toObj = (doc) => Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, decode(v)]));

let token;
async function fsGet(path) {
  const res = await fetch(`${FS_BASE}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return toObj(await res.json());
}
async function fsQuery(structuredQuery) {
  const res = await fetch(`${FS_BASE}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) throw new Error(`query: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).filter((r) => r.document)
    .map((r) => ({ id: r.document.name.split('/').pop(), data: toObj(r.document) }));
}
async function fsPatch(path, patch) {
  const mask = Object.keys(patch).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const res = await fetch(`${FS_BASE}/${path}?${mask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, encode(v)])) }),
  });
  if (!res.ok) throw new Error(`PATCH ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
}
async function fsCreate(collectionId, data) {
  const res = await fetch(`${FS_BASE}/${collectionId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, encode(v)])) }),
  });
  if (!res.ok) throw new Error(`CREATE ${collectionId}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).name.split('/').pop();
}

// ── mirrors of the server logic ─────────────────────────────────────────
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
    companyVatCode: cif, client, seriesName, issueDate, isDraft: false,
    products: items.map((it) => ({
      name: it.name, code: it.code || '', measuringUnitName: 'buc', currency: 'RON',
      quantity: Number(it.quantity) || 1, price: Number(it.price) || 0,
      isTaxIncluded: true, taxName: 'Normala', taxPercentage: VAT_PERCENT,
      saveToDb: false, isService: true,
    })),
  };
}

// ── main ────────────────────────────────────────────────────────────────
token = await firestoreToken();
const sb = (live && !noInvoice) ? smartbillAuth() : { cif: process.env.SMARTBILL_CIF || '<CIF>', header: null };

console.log(live
  ? '\n*** LIVE — Firestore and SmartBill WILL be written ***\n'
  : '\n--- DRY RUN — nothing is written (add --live to apply) ---\n');

const found = await fsQuery({
  from: [{ collectionId: 'bookings' }],
  where: { fieldFilter: { field: { fieldPath: 'code' }, op: 'EQUAL', value: { stringValue: code } } },
  limit: 2,
});
if (found.length !== 1) throw new Error(`Expected exactly one booking with code ${code}, found ${found.length}`);
const bookingId = found[0].id;
const b = found[0].data;

// Guard: only repair a booking that actually carries the stuck signature.
if (b.status !== 'no-show') {
  throw new Error(`Refusing: ${code} is '${b.status}', not 'no-show'. This script only repairs a wrongly-flagged no-show.`);
}
if (b.smartbill?.invoice) {
  throw new Error(`Refusing: ${code} already carries fiscal invoice ${b.smartbill.invoice.series}-${b.smartbill.invoice.number}.`);
}

const order = b.paymentId ? await fsGet(`pendingOrders/${b.paymentId}`) : null;
const dropoffIso = b.dropoffAt || b.startDate;
const paidAtIso = paidAtArg || dropoffIso;
const checkinIso = checkinAtArg || dropoffIso;
const charged = Number(order?.amount ?? b.totalPrice) || 0;
const paidByField = paidByArg === 'cash' ? 'admin-cash' : 'admin-card';

// Pick-up move — refuse anything that would change the money.
let newPickupIso = null;
let newDays = null;
if (pickupArg) {
  newPickupIso = bucharestLocalToIso(pickupArg);
  if (!newPickupIso) throw new Error(`Could not parse --pickup="${pickupArg}" (expected "YYYY-MM-DD HH:MM").`);
  newDays = billingDays(dropoffIso, newPickupIso);
  if (newDays !== Number(b.days)) {
    throw new Error(`Refusing: pick-up move changes billing days ${b.days} → ${newDays}, which re-prices the stay. `
      + 'Use the Edit/Reprice flow (adminRepriceBooking) instead.');
  }
}

const issueDate = issueDateArg === 'payment' ? bucharestDay(paidAtIso)
  : /^\d{4}-\d{2}-\d{2}$/.test(issueDateArg) ? issueDateArg
    : bucharestDay(new Date().toISOString());

const billing = b.billing || order?.customerData?.billing || {};
const billingCheck = checkBillingComplete(billing);
const wantInvoice = !noInvoice && paidByArg === 'card';

console.log(`booking      ${code}  (${bookingId})`);
console.log(`customer     ${b.contact?.name} · ${b.contact?.email} · ${b.contact?.phone}`);
console.log(`plate        ${b.licensePlate}`);
console.log(`order        ${b.paymentId || '(none)'}  amount=${charged} lei  status=${order?.status}/${order?.paymentStatus}`);
console.log(`stay         ${isoToBucharestLocal(dropoffIso)} → ${isoToBucharestLocal(b.pickupAt || b.endDate)}  (${b.days} days, ${b.totalPrice} lei)`);
console.log('');
console.log('PLANNED CHANGES');
console.log(`  status            no-show → active`);
console.log(`  checkinTimestamp  (none) → ${checkinIso}   [${isoToBucharestLocal(checkinIso)} local]`);
console.log(`  noShowAt          ${b.noShowAt} → null`);
console.log(`  noShowDetectedBy  ${b.noShowDetectedBy} → null`);
console.log(`  paymentStatus     ${b.paymentStatus} → paid`);
console.log(`  paidBy            ${b.paidBy} → ${paidByField}`);
console.log(`  paidAt            ${b.paidAt} → ${paidAtIso}   [${isoToBucharestLocal(paidAtIso)} local]`);
if (newPickupIso) {
  console.log(`  pickupAt          ${b.pickupAt} → ${newPickupIso}   [${isoToBucharestLocal(newPickupIso)} local]`);
  console.log(`  endDate           ${b.endDate} → ${bucharestDay(newPickupIso)}`);
  console.log(`  days              ${b.days} → ${newDays}  (unchanged — price stays ${b.totalPrice} lei)`);
}
console.log(`  order status      ${order?.status}/${order?.paymentStatus} → paid/paid`);
console.log('');
console.log(`  fiscal invoice    ${wantInvoice ? `${INVOICE_SERIES} series, dated ${issueDate}, ${charged} lei (21% VAT incl.)` : '(skipped)'}`);
if (wantInvoice) {
  if (!billingCheck.ok) throw new Error(`Refusing: billing incomplete — missing ${billingCheck.missing.join(', ')}`);
  const payload = buildInvoicePayload({
    billing: { ...billing, email: billing.email || b.contact?.email },
    items: [{ name: `Servicii parcare conform rezervării ${code}`, quantity: 1, price: charged, code: 'PARK-LT' }],
    seriesName: INVOICE_SERIES, issueDate, cif: sb.cif,
  });
  console.log('\nSmartBill payload:');
  console.log(JSON.stringify(payload, null, 2));
}

if (!live) {
  console.log('\nDry run — re-run with --live to apply.\n');
  process.exit(0);
}

// ── 1. fiscal invoice ───────────────────────────────────────────────────
let invoiceBlock = null;
if (wantInvoice) {
  const payload = buildInvoicePayload({
    billing: { ...billing, email: billing.email || b.contact?.email },
    items: [{ name: `Servicii parcare conform rezervării ${code}`, quantity: 1, price: charged, code: 'PARK-LT' }],
    seriesName: INVOICE_SERIES, issueDate, cif: sb.cif,
  });
  const res = await fetch(`${SB_BASE}/invoice`, {
    method: 'POST',
    headers: { Authorization: sb.header, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errorText) {
    throw new Error(`SmartBill refused the invoice: HTTP ${res.status} ${body.errorText || JSON.stringify(body).slice(0, 300)}`);
  }
  invoiceBlock = { series: body.series || INVOICE_SERIES, number: body.number, issuedAt: new Date().toISOString() };
  console.log(`✓ fiscal invoice ${invoiceBlock.series} ${invoiceBlock.number} issued (${issueDate})`);
}

// ── 2. spot ─────────────────────────────────────────────────────────────
let spotId = b.spotId || null;
if (!spotId) {
  const free = await fsQuery({
    from: [{ collectionId: 'spots' }],
    where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'available' } } },
    limit: 1,
  });
  spotId = free[0]?.id || null;
}
if (spotId) {
  await fsPatch(`spots/${spotId}`, { status: 'occupied', currentBookingId: bookingId });
  console.log(`✓ spot ${spotId} → occupied`);
} else {
  console.warn('! no available spot — booking left without one (assign from /admin/capacity)');
}

// ── 3. booking ──────────────────────────────────────────────────────────
const nowIso = new Date().toISOString();
const smartbillBlock = {
  ...(b.smartbill || {}),
  ...(invoiceBlock ? { invoice: invoiceBlock, status: 'invoiced', lastError: null } : {}),
};
const bookingPatch = {
  status: 'active',
  checkinTimestamp: checkinIso,
  noShowAt: null,
  noShowDetectedBy: null,
  paymentStatus: 'paid',
  paidAt: paidAtIso,
  paidBy: paidByField,
  spotId,
  manualReconciledAt: nowIso,
  manualReconciledBy: actor,
  manualReconciledReason: reason,
  ...(invoiceBlock ? { smartbill: smartbillBlock } : {}),
  ...(newPickupIso ? { pickupAt: newPickupIso, endDate: bucharestDay(newPickupIso), days: newDays } : {}),
};
await fsPatch(`bookings/${bookingId}`, bookingPatch);
console.log(`✓ booking ${code} → active, paid (${paidByField})`);

// ── 4. order ────────────────────────────────────────────────────────────
if (b.paymentId && order) {
  const orderPatch = {
    status: 'paid',
    paymentStatus: 'paid',
    paidAt: paidAtIso,
    paidBy: paidByField,
    bookingId,
    manualReconciledAt: nowIso,
    manualReconciledBy: actor,
    ...(invoiceBlock ? { smartbill: { ...(order.smartbill || {}), invoice: invoiceBlock, status: 'invoiced', lastError: null } } : {}),
    ...(newPickupIso ? { pickupAt: newPickupIso, endDate: bucharestDay(newPickupIso), days: newDays } : {}),
  };
  await fsPatch(`pendingOrders/${b.paymentId}`, orderPatch);
  console.log(`✓ order ${b.paymentId} → paid`);
}

// ── 5. audit rows ───────────────────────────────────────────────────────
const auditBase = { entityType: 'booking', entityId: bookingId, actorUid: actor, timestamp: nowIso };
await fsCreate('auditLog', {
  ...auditBase,
  entityType: 'pendingOrder',
  entityId: b.paymentId || bookingId,
  action: 'order_marked_paid',
  payload: { code, paidBy: paidByField, orderType: 'longTerm', amount: charged, manual: true, reason },
});
await fsCreate('auditLog', {
  ...auditBase,
  action: 'booking_checkin',
  oldValue: { status: 'no-show' },
  newValue: { status: 'active', spotId, code },
  payload: { code, manual: true, reason, checkinTimestamp: checkinIso },
});
if (newPickupIso) {
  await fsCreate('auditLog', {
    ...auditBase,
    action: 'booking_edited',
    oldValue: { pickupAt: b.pickupAt, endDate: b.endDate, days: b.days },
    newValue: { pickupAt: newPickupIso, endDate: bucharestDay(newPickupIso), days: newDays, code },
    payload: { code, manual: true, reason: 'Customer requested an earlier pick-up.' },
  });
}
if (invoiceBlock) {
  await fsCreate('auditLog', {
    ...auditBase,
    action: 'smartbill_invoice_issued',
    payload: { code, series: invoiceBlock.series, number: invoiceBlock.number, issueDate, amount: charged, manual: true, reason },
  });
}
console.log('✓ audit rows written');
console.log(`\nDone. Open /admin/transactions?booking=${bookingId} to verify.\n`);
