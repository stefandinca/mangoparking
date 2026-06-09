// Admin activity notifications → rezervari@mangoparking.ro.
//
// Separate from the customer-facing Brevo-template emails in emails.js. These
// are internal ops alerts so staff see customer activity as it happens:
//   adminNotifyUserCreated      — a customer self-registers
//   adminNotifyBookingCreated   — a customer creates a long-term reservation
//   adminNotifyBookingCancelled — a reservation is cancelled / refund-pending / no-show
//   adminNotifyCreditPurchase   — a customer buys credits
//
// Scope is CUSTOMER-initiated only (the request was "when a USER does X"):
// admin/desk actions are skipped (walk-ins via source != 'web', credit desk
// grants via grantedBy, admin-created accounts via createdBy) so staff don't
// get pinged for things they did themselves.
//
// Like the contact-form alert, these are inline-HTML sends via sendBrevoRaw —
// no Brevo template/ID pairing, so they work the moment the function deploys.
// Each handler claims a one-shot field on the source doc so a double-firing
// v2 trigger only sends once, and every send is swallow-on-failure (an alert
// must never retry-loop a customer flow).

import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { BREVO_API_KEY, sendBrevoRaw } from './brevo.js';

const REGION = 'europe-west1';
const ADMIN_INBOX = 'rezervari@mangoparking.ro';

// ── helpers ──────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  try {
    return d.toLocaleString('ro-RO', {
      timeZone: 'Europe/Bucharest',
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return String(iso); }
}

function normalizePlate(plate) {
  return String(plate || '').toUpperCase().replace(/[\s-]/g, '');
}

function mailto(email) {
  const e = String(email || '').trim();
  if (!e.includes('@')) return '—';
  return `<a href="mailto:${escHtml(e)}">${escHtml(e)}</a>`;
}

// Renders the shared branded card. `rows` is [label, valueHtml] — value is
// trusted HTML (callers escape their own dynamic text / build mailto links).
function adminEmailHtml({ heading, intro, rows, note }) {
  const rowsHtml = (rows || [])
    .filter(([, v]) => v != null && v !== '')
    .map(([label, value]) => `
      <tr>
        <td style="padding:5px 16px 5px 0;color:#4B5563;white-space:nowrap;vertical-align:top"><strong>${escHtml(label)}</strong></td>
        <td style="padding:5px 0;vertical-align:top">${value}</td>
      </tr>`).join('');
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1A1A1A;line-height:1.5">
      <h2 style="color:#0F2D66;margin:0 0 ${intro ? '8px' : '16px'}">${escHtml(heading)}</h2>
      ${intro ? `<p style="margin:0 0 16px;color:#4B5563">${escHtml(intro)}</p>` : ''}
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rowsHtml}</table>
      ${note ? `<p style="font-size:13px;color:#4B5563;margin:16px 0 0">${note}</p>` : ''}
    </div>`;
}

async function notifyAdmin({ subject, heading, intro = '', rows = [], note = '', replyTo, tags = [] }) {
  return sendBrevoRaw({
    to: ADMIN_INBOX,
    name: 'Mango Parking Rezervări',
    subject,
    html: adminEmailHtml({ heading, intro, rows, note }),
    replyTo,
    tags: ['admin-notify', ...tags],
  });
}

// One-shot guard: claims `field` on `ref`; returns true only for the first
// caller. Keeps a double-firing v2 trigger from sending twice.
async function claimOnce(ref, field) {
  const db = getFirestore();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    if (snap.data()[field]) return false;
    tx.update(ref, { [field]: FieldValue.serverTimestamp() });
    return true;
  }).catch((err) => {
    console.warn(`claimOnce(${field}) failed`, err?.message);
    return false;
  });
}

function replyToOf(email, name) {
  const e = String(email || '').trim();
  return e.includes('@') ? { email: e, name: name || e } : undefined;
}

// ── new customer registration ────────────────────────────────────────────

export const adminNotifyUserCreated = onDocumentCreated(
  { document: 'users/{uid}', region: REGION, secrets: [BREVO_API_KEY] },
  async (event) => {
    const u = event.data?.data();
    if (!u?.email) return;
    // Skip admin-created accounts (adminCreateUser stamps createdBy) and
    // invite signups (adminSendInvite leaves a pendingInvites doc) — staff
    // already know about those.
    if (u.createdBy) return;
    const db = getFirestore();
    const invite = await db.collection('pendingInvites').doc(String(u.email).toLowerCase()).get().catch(() => null);
    if (invite?.exists) return;

    if (!(await claimOnce(db.collection('users').doc(event.params.uid), 'adminNotifiedAt'))) return;

    await notifyAdmin({
      subject: `Înregistrare nouă: ${u.displayName || u.email}`,
      heading: 'Cont nou creat',
      rows: [
        ['Nume', escHtml(u.displayName || '—')],
        ['Email', mailto(u.email)],
        ['Telefon', escHtml(u.phone || '—')],
        ['Rol', escHtml(u.role || 'customer')],
        ['Limbă', escHtml((u.locale || 'ro').toUpperCase())],
        ['Creat', escHtml(fmtDateTime(u.createdAt))],
      ],
      replyTo: replyToOf(u.email, u.displayName),
      tags: ['signup'],
    });
  }
);

// ── new long-term reservation (customer/web) ───────────────────────────────

export const adminNotifyBookingCreated = onDocumentCreated(
  { document: 'bookings/{id}', region: REGION, secrets: [BREVO_API_KEY] },
  async (event) => {
    const b = event.data?.data();
    if (!b) return;
    // Long-term web reservations only. Walk-in / admin / broker bookings are
    // created by staff at the desk (source !== 'web'); credit check-ins are
    // not "reservations".
    if (b.type !== 'longTerm' || b.source !== 'web') return;

    if (!(await claimOnce(getFirestore().collection('bookings').doc(event.params.id), 'adminNotifiedAt'))) return;

    const code = b.code || `LT-${event.params.id.slice(0, 5).toUpperCase()}`;
    const payState = b.paymentStatus === 'unpaid'
      ? 'Neîncasat (plată la sosire)'
      : `Încasat${b.paidBy ? ` (${b.paidBy})` : ''}`;
    await notifyAdmin({
      subject: `Rezervare nouă ${code} — ${b.licensePlate || '—'}`,
      heading: 'Rezervare termen lung nouă',
      rows: [
        ['Cod', escHtml(code)],
        ['Nume', escHtml(b.contact?.name || '—')],
        ['Email', mailto(b.contact?.email)],
        ['Telefon', escHtml(b.contact?.phone || '—')],
        ['Plăcuță', escHtml(b.licensePlate || '—')],
        ['Perioadă', `${escHtml(fmtDateTime(b.dropoffAt || b.startDate))} → ${escHtml(fmtDateTime(b.pickupAt || b.endDate))}`],
        ['Zile', escHtml(String(b.days ?? '—'))],
        ['Total', `${escHtml(String(b.totalPrice ?? 0))} lei`],
        ['Plată', escHtml(payState)],
      ],
      replyTo: replyToOf(b.contact?.email, b.contact?.name),
      tags: ['reservation'],
    });
  }
);

// ── reservation cancelled / refund-pending / no-show ───────────────────────

const CANCEL_STATES = {
  cancelled: 'Rezervare anulată',
  'refund-pending': 'Anulare cu refund de procesat',
  'no-show': 'No-show (clientul nu a venit)',
};

export const adminNotifyBookingCancelled = onDocumentUpdated(
  { document: 'bookings/{id}', region: REGION, secrets: [BREVO_API_KEY] },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after) return;
    // Only the moment a booking transitions INTO a cancel-ish status.
    if (before?.status === after.status) return;
    const heading = CANCEL_STATES[after.status];
    if (!heading) return;

    if (!(await claimOnce(getFirestore().collection('bookings').doc(event.params.id), 'adminCancelNotifiedAt'))) return;

    const code = after.code || `LT-${event.params.id.slice(0, 5).toUpperCase()}`;
    const by = after.cancelledBy || after.noShowDetectedBy || '—';
    await notifyAdmin({
      subject: `${heading}: ${code} — ${after.licensePlate || '—'}`,
      heading,
      rows: [
        ['Cod', escHtml(code)],
        ['Tip', escHtml(after.type || '—')],
        ['Nume', escHtml(after.contact?.name || '—')],
        ['Email', mailto(after.contact?.email)],
        ['Plăcuță', escHtml(after.licensePlate || '—')],
        ['Perioadă', `${escHtml(fmtDateTime(after.dropoffAt || after.startDate))} → ${escHtml(fmtDateTime(after.pickupAt || after.endDate))}`],
        ['Total', `${escHtml(String(after.totalPrice ?? 0))} lei`],
        ['Plată', escHtml(after.paymentStatus || '—')],
        ['Acțiune de', escHtml(by)],
      ],
      replyTo: replyToOf(after.contact?.email, after.contact?.name),
      tags: ['cancellation', after.status],
    });
  }
);

// ── credit purchase (customer) ─────────────────────────────────────────────

export const adminNotifyCreditPurchase = onDocumentCreated(
  { document: 'tokenTransactions/{id}', region: REGION, secrets: [BREVO_API_KEY] },
  async (event) => {
    const tx = event.data?.data();
    if (!tx || tx.type !== 'purchase') return;
    // Skip desk grants — grantCreditsForCash stamps grantedBy. Customer
    // online/pay-at-pickup purchases leave it unset.
    if (tx.grantedBy) return;

    if (!(await claimOnce(getFirestore().collection('tokenTransactions').doc(event.params.id), 'adminNotifiedAt'))) return;

    // Best-effort buyer contact from the balance doc.
    const db = getFirestore();
    const balanceDocId = tx.customerId || (tx.licensePlate ? `plate_${normalizePlate(tx.licensePlate)}` : null);
    let buyerEmail = '';
    let buyerName = '';
    if (balanceDocId) {
      const bal = await db.collection('tokenBalances').doc(balanceDocId).get().catch(() => null);
      if (bal?.exists) { buyerEmail = bal.data().email || ''; buyerName = bal.data().displayName || ''; }
    }
    const amount = tx.totalAmount ?? tx.amount;
    await notifyAdmin({
      subject: `Credite cumpărate: ${tx.quantity ?? '?'} — ${tx.licensePlate || '—'}`,
      heading: 'Credite cumpărate',
      rows: [
        ['Cantitate', `${escHtml(String(tx.quantity ?? '—'))} credite`],
        ['Sumă', amount != null ? `${escHtml(String(amount))} lei` : '—'],
        ['Plăcuță', escHtml(tx.licensePlate || '—')],
        ['Nume', escHtml(buyerName || '—')],
        ['Email', mailto(buyerEmail)],
        ['Plată', escHtml(tx.paidBy || tx.source || '—')],
        ['Data', escHtml(fmtDateTime(tx.timestamp))],
      ],
      replyTo: replyToOf(buyerEmail, buyerName),
      tags: ['credit-purchase'],
    });
  }
);
