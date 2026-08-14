#!/usr/bin/env node
/**
 * One-off repair: re-attach a paid Netopia order whose confirmation IPN was
 * swallowed, to the booking staff had to create by hand.
 *
 * Background (incident 2026-08-12, see documentation/backend/payments-netopia.md):
 * a declined first attempt wrote `status: 'paid'` onto the order, which the
 * idempotency guard read as "already fulfilled", so the *successful* retry's
 * IPN was discarded. No booking, no fiscal invoice, no confirmation email, and
 * the promo voucher left consumed with a null bookingId. The customer arrived
 * anyway and was entered by hand — usually as "Broker / prepaid", because
 * there was no order to attach the payment to.
 *
 * The callback bug itself is fixed in functions/src/netopia.js; this script
 * only repairs the records the outage already damaged.
 *
 * What it writes:
 *   bookings/{id}        paidBy/paymentMethod/source → the online-card shape,
 *                        paymentId → the order, billing ← the order's billing
 *                        (needed before an invoice can be raised at all)
 *   pendingOrders/{id}   bookingId + the paid markers the success branch
 *                        would have written, plus a reconciliation stamp
 *   voucherRedemptions   bookingId stamped on the order's redemption
 *   auditLog             one row, so the hand-correction is traceable
 *
 * It does NOT touch SmartBill. Raise the fiscal invoice afterwards with
 * scripts/backfill-smartbill-invoices.mjs, which reads the billing this
 * script puts on the booking.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Dry run is the DEFAULT — nothing is written without --live. The order must
 * still carry the swallowed signature (status 'paid', no bookingId, no
 * paidBy) or the script refuses: that guard is what stops it being pointed at
 * a healthy order and rewriting a good record.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Usage:
 *   node scripts/reconcile-swallowed-ipn-order.mjs \
 *     --order=ord_1786576684010_uuvq16 --booking=LT-783EF
 *
 *   node scripts/reconcile-swallowed-ipn-order.mjs --live \
 *     --order=ord_1786576684010_uuvq16 --booking=LT-783EF \
 *     --paid-at=2026-08-12T23:29:19.504Z --actor=you@example.com
 *
 * Options:
 *   --order=<orderId>     pendingOrders doc id                    (required)
 *   --booking=<LT-XXXXX>  the hand-made booking to re-attach      (required)
 *   --paid-at=<ISO>       true capture time (the successful IPN's timestamp);
 *                         defaults to the booking's existing paidAt
 *   --actor=<email>       who to record in auditLog       (default: the script)
 *   --live                actually write (default: dry run)
 *
 * Firestore access reuses the Firebase CLI login, so `firebase login` must
 * already be done. No extra dependencies.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PROJECT = 'mango-parking';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// Firebase CLI's public OAuth client — the same pair the CLI itself uses.
const CLI_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CLI_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

// ── args ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => (argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');
const live = argv.includes('--live');
const orderId = flag('order');
const bookingCode = flag('booking');
const paidAtArg = flag('paid-at');
const actor = flag('actor') || 'scripts/reconcile-swallowed-ipn-order.mjs';

if (!orderId || !bookingCode) {
  console.error('Both --order and --booking are required.\n'
    + 'Usage: node scripts/reconcile-swallowed-ipn-order.mjs [--live] '
    + '--order=ord_... --booking=LT-XXXXX [--paid-at=ISO] [--actor=email]');
  process.exit(1);
}

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

const toObj = (doc) => Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, decode(v)]));

let token;
async function fsGet(path) {
  const res = await fetch(`${FS_BASE}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return toObj(await res.json());
}

async function fsQuery(collectionId, field, value) {
  const res = await fetch(`${FS_BASE}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } },
        limit: 5,
      },
    }),
  });
  if (!res.ok) throw new Error(`query ${collectionId}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
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
  if (!res.ok) throw new Error(`PATCH ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
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

// ── main ────────────────────────────────────────────────────────────────
token = await firestoreToken();

console.log(live
  ? '\n*** LIVE — Firestore WILL be written ***\n'
  : '\n--- DRY RUN — nothing is written (add --live to apply) ---\n');

const order = await fsGet(`pendingOrders/${orderId}`);
if (!order) { console.error(`Order ${orderId} not found.`); process.exit(1); }

// Refuse anything that isn't actually a swallowed order. A healthy order has
// a bookingId and a paidBy; rewriting one of those would corrupt a good record.
const swallowed = order.status === 'paid' && !order.bookingId && !order.balanceDocId && !order.paidBy;
if (!swallowed) {
  console.error(`Order ${orderId} does not carry the swallowed signature — refusing.`);
  console.error(`  status=${order.status} bookingId=${order.bookingId || '-'} `
    + `balanceDocId=${order.balanceDocId || '-'} paidBy=${order.paidBy || '-'}`);
  process.exit(1);
}

const matches = await fsQuery('bookings', 'code', bookingCode);
if (matches.length !== 1) {
  console.error(`Booking ${bookingCode}: expected exactly 1 match, got ${matches.length}. Refusing.`);
  process.exit(1);
}
const { id: bookingId, data: booking } = matches[0];

if (booking.paymentId && booking.paymentId !== orderId) {
  console.error(`Booking ${bookingCode} is already attached to ${booking.paymentId}. Refusing.`);
  process.exit(1);
}

// Sanity: the hand-made booking should be for the same car and money.
const samePlate = String(booking.licensePlate || '').replace(/[\s-]/g, '').toUpperCase()
  === String(order.customerData?.licensePlate || '').replace(/[\s-]/g, '').toUpperCase();
const charged = Number(order.amount) || 0;
console.log(`order    ${orderId}  ${charged} lei  ${order.customerData?.licensePlate}  ${order.customerData?.email}`);
console.log(`booking  ${bookingCode} (${bookingId})  ${booking.totalPrice} lei  ${booking.licensePlate}`);
console.log(`         plate match: ${samePlate ? 'yes' : 'NO'}   amount match: ${booking.totalPrice === charged ? 'yes' : 'NO'}`);
if (!samePlate) { console.error('\nPlate mismatch — refusing.'); process.exit(1); }
if (booking.totalPrice !== charged) {
  console.error(`\nBooking total (${booking.totalPrice}) != charged amount (${charged}) — refusing.`);
  console.error('Reconcile the amount by hand first; this script will not decide which is right.');
  process.exit(1);
}

const paidAt = paidAtArg || booking.paidAt || order.processedAt || new Date().toISOString();
const nowIso = new Date().toISOString();

// The booking: from the desk's "broker" shape to the online-card shape.
// `source`, `paidBy` and `paymentMethod` must ALL move — isBrokerBooking()
// treats any one of them as proof of a broker sale and would keep suppressing
// this customer's real total.
const bookingPatch = {
  paidBy: 'netopia',
  paymentMethod: 'online',
  source: 'web',
  paymentId: orderId,
  paymentStatus: 'paid',
  paidAt,
  brokerName: null,
  updatedAt: nowIso,
};
// Only fill billing if the desk left it empty — never overwrite what a human typed.
if (!booking.billing && order.customerData?.billing) bookingPatch.billing = order.customerData.billing;

// The order: the markers the success branch would have written.
const orderPatch = {
  bookingId,
  paymentStatus: 'paid',
  paidBy: 'netopia',
  paidAt,
  netopiaAction: 'confirmed',
  reconciledAt: nowIso,
  reconciledNote: `IPN swallowed by the status-collision bug; payment confirmed in the Netopia panel and re-attached to ${bookingCode}.`,
};

const redemptions = await fsQuery('voucherRedemptions', 'orderId', orderId);
const redemptionPatches = redemptions
  .filter((r) => !r.data.bookingId)
  .map((r) => ({ id: r.id, code: r.data.voucherCode }));

const auditRow = {
  entityType: 'booking',
  entityId: bookingId,
  action: 'booking_payment_reconciled',
  oldValue: {
    paidBy: booking.paidBy ?? null,
    paymentMethod: booking.paymentMethod ?? null,
    source: booking.source ?? null,
    paymentId: booking.paymentId ?? null,
  },
  newValue: {
    code: bookingCode,
    paidBy: 'netopia',
    paymentMethod: 'online',
    source: 'web',
    paymentId: orderId,
  },
  timestamp: nowIso,
  createdAt: nowIso,
  userId: 'script',
  userEmail: actor,
};

console.log(`\nbookings/${bookingId}`);
for (const [k, v] of Object.entries(bookingPatch)) {
  const before = booking[k] === undefined ? '(unset)' : JSON.stringify(booking[k]);
  console.log(`  ${k.padEnd(15)} ${String(before).slice(0, 40).padEnd(42)} → ${JSON.stringify(v).slice(0, 60)}`);
}
console.log(`\npendingOrders/${orderId}`);
for (const [k, v] of Object.entries(orderPatch)) {
  const before = order[k] === undefined ? '(unset)' : JSON.stringify(order[k]);
  console.log(`  ${k.padEnd(15)} ${String(before).slice(0, 40).padEnd(42)} → ${JSON.stringify(v).slice(0, 60)}`);
}
console.log(`\nvoucherRedemptions: ${redemptionPatches.length} to stamp`
  + `${redemptionPatches.map((r) => ` (${r.id} ${r.code})`).join('')}`);
console.log(`auditLog: 1 row — ${auditRow.action} by ${actor}`);

if (!live) {
  console.log('\nDry run — re-run with --live to apply.\n');
  process.exit(0);
}

await fsPatch(`bookings/${bookingId}`, bookingPatch);
console.log(`\nbookings/${bookingId} updated`);
await fsPatch(`pendingOrders/${orderId}`, orderPatch);
console.log(`pendingOrders/${orderId} updated`);
for (const r of redemptionPatches) {
  await fsPatch(`voucherRedemptions/${r.id}`, { bookingId });
  console.log(`voucherRedemptions/${r.id} stamped`);
}
const auditId = await fsCreate('auditLog', auditRow);
console.log(`auditLog/${auditId} written`);

console.log('\nDone. Next: raise the fiscal invoice —');
console.log(`  node scripts/backfill-smartbill-invoices.mjs --live --issue-date=payment ${bookingCode}\n`);
