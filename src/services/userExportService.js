// Invoice-oriented user export.
//
// Produces one CSV row per user: their fiscal + contact identity (from the
// users/{uid} doc) plus lifetime spend totals aggregated from their bookings
// and credit purchases. Used in two places:
//   - bulk   → /admin/users "Export CSV" (all currently-listed users)
//   - single → the user-detail modal "Export" button (one user)
//
// Admins can read every bookings/* and tokenTransactions/* doc (Firestore
// rules: `allow read: if isStaff()`), so the bulk path fetches both
// collections once and aggregates in memory — fine at our scale (sub-1k
// users). The single path queries just that user's rows (unlimited, so the
// total isn't truncated the way the modal's 50-row preview is).

import { getCollection, where } from '../firebase/db.js';
import { t } from '../i18n/index.js';

function billingName(b) {
  if (!b) return '';
  return b.companyName || [b.firstName, b.lastName].filter(Boolean).join(' ') || b.name || '';
}

function billingAddress(b) {
  if (!b) return '';
  return b.companyAddress || b.address || [b.locality].filter(Boolean).join(', ') || '';
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const roleAlias = (r) => (r === 'staff' ? 'agent' : (r || 'customer'));

// Localized column headers, in output order. Keep in lock-step with userRow().
export function exportHeaders() {
  const d = t('admin.usersExport.col');
  return [
    d.name, d.email, d.phone, d.role,
    d.billingType, d.billingName, d.cui, d.regCom, d.cnp, d.address,
    d.registered, d.bookings, d.credits, d.totalPaid,
  ];
}

// Lifetime spend for one user from their (already-linked) bookings + credit
// transactions. "Total paid" = actually-collected money: paid bookings'
// gross + the amount recorded on each credit purchase (cash or online). A
// booking that was refunded flips to paymentStatus 'refunded' and so drops
// out of the total — exactly what an invoicing total wants.
export function userTotals(bookings, txns) {
  let totalPaid = 0;
  for (const b of bookings) {
    if (b.paymentStatus === 'paid') totalPaid += Number(b.totalPrice) || 0;
  }
  let credits = 0;
  for (const tx of txns) {
    if (tx.type === 'purchase') {
      credits += Number(tx.quantity) || 0;
      totalPaid += Number(tx.amount) || 0;
    }
  }
  return { bookings: bookings.length, credits, totalPaid: Math.round(totalPaid) };
}

// One CSV row (array of cells) for a user + their aggregated data.
export function userRow(user, bookings, txns) {
  const b = user.billing || {};
  const tot = userTotals(bookings, txns);
  return [
    user.displayName || '',
    user.email || '',
    user.phone || '',
    roleAlias(user.role),
    String(b.type || '').toUpperCase(),
    billingName(b),
    b.cui || '',
    b.regCom || '',
    b.cnp || '',
    billingAddress(b),
    fmtDate(user.createdAt),
    tot.bookings,
    tot.credits,
    tot.totalPaid,
  ];
}

function push(map, key, val) {
  const arr = map.get(key);
  if (arr) arr.push(val);
  else map.set(key, [val]);
}

// Merge bookings linked by customerId and by contact email, deduped by id.
function mergeBookings(a, b) {
  const seen = new Set();
  const out = [];
  for (const x of [...a, ...b]) {
    if (!x || seen.has(x.id)) continue;
    seen.add(x.id);
    out.push(x);
  }
  return out;
}

// Bulk: fetch all bookings + credit txns once, index, build a row per user.
export async function buildUsersExport(users) {
  const [bookings, txns] = await Promise.all([
    getCollection('bookings'),
    getCollection('tokenTransactions'),
  ]);
  const byCid = new Map();
  const byEmail = new Map();
  for (const b of bookings) {
    if (b.customerId) push(byCid, b.customerId, b);
    const em = b.contact?.email ? String(b.contact.email).toLowerCase() : '';
    if (em) push(byEmail, em, b);
  }
  const txByCid = new Map();
  for (const tx of txns) {
    if (tx.customerId) push(txByCid, tx.customerId, tx);
  }
  const rows = users.map((u) => {
    const merged = mergeBookings(
      byCid.get(u.id) || [],
      byEmail.get(String(u.email || '').toLowerCase()) || [],
    );
    return userRow(u, merged, txByCid.get(u.id) || []);
  });
  return { headers: exportHeaders(), rows };
}

// Single user: query just this user's rows (unlimited) and build one row.
export async function buildSingleUserExport(user) {
  const uid = user.id;
  const email = user.email;
  const [byId, byEmail, txns] = await Promise.all([
    uid ? getCollection('bookings', where('customerId', '==', uid)).catch(() => []) : Promise.resolve([]),
    email ? getCollection('bookings', where('contact.email', '==', email)).catch(() => []) : Promise.resolve([]),
    uid ? getCollection('tokenTransactions', where('customerId', '==', uid)).catch(() => []) : Promise.resolve([]),
  ]);
  const merged = mergeBookings(byId, byEmail);
  return { headers: exportHeaders(), rows: [userRow(user, merged, txns)] };
}
