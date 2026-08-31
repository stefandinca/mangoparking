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

// Lifetime figures for one user from their (already-linked) bookings + credit
// transactions. "Total paid" = actually-collected money: paid bookings'
// gross + the amount recorded on each credit purchase (cash or online). A
// booking that was refunded flips to paymentStatus 'refunded' and so drops
// out of the total — exactly what an invoicing total wants.
//
// `bookings` / `credits` / `totalPaid` are the CSV's three columns and must
// keep their meaning; the rest drive the sortable Clients table on
// /admin/users and are additive.
export function userTotals(bookings, txns, balance = null) {
  let totalPaid = 0;
  let longestStay = 0;
  let totalDays = 0;
  let cancellations = 0;
  let noShows = 0;
  // Most recent time this customer DID something. Deliberately keyed on when a
  // booking was made / a credit moved, never on `dropoffAt` — a reservation for
  // next month would otherwise stamp a customer's "last activity" in the
  // future, which reads as nonsense in a "who has gone quiet" list.
  let lastActivityAt = '';
  const seen = (when) => {
    const s = String(when || '');
    if (s && s > lastActivityAt) lastActivityAt = s;
  };

  for (const b of bookings) {
    if (b.paymentStatus === 'paid') totalPaid += Number(b.totalPrice) || 0;
    const days = Number(b.days) || 0;
    totalDays += days;
    // Longest STAY is a long-term notion; a credit check-in is same-day by
    // construction (its pick-up is that day's 20:00 cutoff).
    if (b.type === 'longTerm' && days > longestStay) longestStay = days;
    if (b.status === 'cancelled') cancellations += 1;
    if (b.status === 'no-show') noShows += 1;
    seen(b.createdAt);
  }

  let credits = 0;
  let creditsUsed = 0;
  for (const tx of txns) {
    if (tx.type === 'purchase') {
      credits += Number(tx.quantity) || 0;
      totalPaid += Number(tx.amount) || 0;
    }
    // `use` rows carry a negative quantity (one per parking day spent).
    if (tx.type === 'use') creditsUsed += Math.abs(Number(tx.quantity) || 0);
    seen(tx.timestamp || tx.createdAt);
  }

  return {
    bookings: bookings.length,
    credits,
    totalPaid: Math.round(totalPaid),
    creditsUsed,
    longestStay,
    totalDays,
    cancellations,
    noShows,
    lastActivityAt: lastActivityAt || null,
    creditBalance: Number(balance?.balance) || 0,
  };
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

// Fetch the three collections once and index them by user. Shared by the CSV
// export and the Clients table so a figure can never mean one thing in the
// table and another in the export. ~640 docs at current volume; admins may
// read all three (firestore.rules: `allow read: if isStaff()`).
async function loadUserAggregates() {
  const [bookings, txns, balances] = await Promise.all([
    getCollection('bookings'),
    getCollection('tokenTransactions'),
    // Credit balances are uid- or plate-keyed; only the uid ones can attach to
    // an account. Non-fatal — the balance column just shows 0.
    getCollection('tokenBalances').catch(() => []),
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
  const balByUid = new Map();
  for (const bal of balances) {
    if (bal.id && !String(bal.id).startsWith('plate_')) balByUid.set(bal.id, bal);
  }
  return { byCid, byEmail, txByCid, balByUid };
}

// A user's bookings: those linked by uid PLUS those matched on contact email,
// deduped — a guest who booked before registering is still their customer.
function bookingsForUser(idx, user) {
  return mergeBookings(
    idx.byCid.get(user.id) || [],
    idx.byEmail.get(String(user.email || '').toLowerCase()) || [],
  );
}

/**
 * Lifetime stats per user, keyed by uid — what the Clients tab sorts and
 * filters on. One pass over the same data the CSV export uses.
 * @returns {Promise<Map<string, ReturnType<typeof userTotals>>>}
 */
export async function buildUserStats(users) {
  const idx = await loadUserAggregates();
  const out = new Map();
  for (const u of users) {
    out.set(u.id, userTotals(bookingsForUser(idx, u), idx.txByCid.get(u.id) || [], idx.balByUid.get(u.id)));
  }
  return out;
}

// Bulk: fetch all bookings + credit txns once, index, build a row per user.
export async function buildUsersExport(users) {
  const idx = await loadUserAggregates();
  const rows = users.map((u) => userRow(u, bookingsForUser(idx, u), idx.txByCid.get(u.id) || []));
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
