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
    const db = getFirestore();

    if (!(await claimOnce(db.collection('users').doc(event.params.uid), 'adminNotifiedAt'))) return;

    // How the account came to be, so staff can tell self-signups apart from
    // accounts they created/invited themselves.
    const via = u.createdBy ? `creat de admin (${u.createdBy})` : 'înregistrare proprie';
    await notifyAdmin({
      subject: `Cont nou: ${u.displayName || u.email}`,
      heading: 'Cont nou creat',
      rows: [
        ['Nume', escHtml(u.displayName || '—')],
        ['Email', mailto(u.email)],
        ['Telefon', escHtml(u.phone || '—')],
        ['Rol', escHtml(u.role || 'customer')],
        ['Mod', escHtml(via)],
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
    // All long-term reservations — web, walk-in, admin and broker. Credit
    // check-ins (type 'credit') are daily operational check-ins, not
    // reservations, so they're excluded here.
    if (b.type !== 'longTerm') return;

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
        ['Sursă', escHtml(b.source || 'web') + (b.brokerName ? ` — ${escHtml(b.brokerName)}` : '')],
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
      tags: ['reservation', b.source || 'web'],
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
    if (!after || before?.status === after.status) return;

    const ref = getFirestore().collection('bookings').doc(event.params.id);
    const code = after.code || `LT-${event.params.id.slice(0, 5).toUpperCase()}`;

    // Refund completed (adminMarkRefunded: refund-pending → refunded). Its own
    // claim field, since the cancel notify already fired on the earlier
    // transition into refund-pending.
    if (after.status === 'refunded') {
      if (!(await claimOnce(ref, 'adminRefundNotifiedAt'))) return;
      await notifyAdmin({
        subject: `Refund procesat: ${code} — ${after.licensePlate || '—'}`,
        heading: 'Refund procesat',
        rows: [
          ['Cod', escHtml(code)],
          ['Nume', escHtml(after.contact?.name || '—')],
          ['Email', mailto(after.contact?.email)],
          ['Plăcuță', escHtml(after.licensePlate || '—')],
          ['Sumă', `${escHtml(String(after.totalPrice ?? 0))} lei`],
          ['Metodă refund', escHtml(after.refundedVia || '—')],
          ['Procesat de', escHtml(after.refundedBy || '—')],
          ['Data', escHtml(fmtDateTime(after.refundedAt))],
        ],
        replyTo: replyToOf(after.contact?.email, after.contact?.name),
        tags: ['refund'],
      });
      return;
    }

    const heading = CANCEL_STATES[after.status];
    if (!heading) return;

    if (!(await claimOnce(ref, 'adminCancelNotifiedAt'))) return;

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
        // Set when an agent grants credits for cash at the desk; absent for
        // customer online / pay-at-pickup purchases.
        ['Acordat de', escHtml(tx.grantedBy || '— (online)')],
        ['Data', escHtml(fmtDateTime(tx.timestamp))],
      ],
      replyTo: replyToOf(buyerEmail, buyerName),
      tags: ['credit-purchase'],
    });
  }
);

// ── password-reset request ─────────────────────────────────────────────────
// Not a Firestore trigger — called directly from the requestPasswordReset
// callable AFTER a reset link was generated (i.e. the account exists), so it
// never fires for unknown emails and can't be used to enumerate accounts.
// ── desk discount / waiver ───────────────────────────────────────────────
// Called directly from adminMarkOrderPaid (not a trigger — collecting a
// payment changes no `status`, so nothing an onDocumentUpdated watcher would
// catch, and the amounts it needs live across the order AND the booking).
//
// The one deliberate exception to the customer-initiated-only rule at the top
// of this file: this IS a staff action, and that is exactly why it is worth
// sending. Every other money event reaches rezervari@ on its own, so a
// write-off — the one movement with nothing on the other side of it — would
// otherwise be visible only to whoever thinks to open /admin/audit.
export async function notifyAdminDeskDiscount({
  code, plate, customerName, customerEmail,
  originalAmount, collectedAmount, discountAmount, reason,
  paidBy, agentName, orderType,
}) {
  const waived = Number(collectedAmount) === 0;
  const label = orderType === 'credits' ? 'Credite' : 'Rezervare';
  return notifyAdmin({
    subject: waived
      ? `GRATUIT acordat: ${code || '—'} — ${normalizePlate(plate) || '—'}`
      : `Reducere ${discountAmount} lei: ${code || '—'} — ${normalizePlate(plate) || '—'}`,
    heading: waived ? 'Rezervare oferită gratuit' : 'Reducere acordată la încasare',
    intro: waived
      ? `Nu s-a încasat nimic din cei ${originalAmount} lei.`
      : `S-au încasat ${collectedAmount} lei din ${originalAmount} lei.`,
    rows: [
      ['Tip', escHtml(label)],
      ['Cod', escHtml(code || '—')],
      ['Plăcuță', escHtml(normalizePlate(plate) || '—')],
      ['Client', escHtml(customerName || '—')],
      ['Email', mailto(customerEmail)],
      ['De plată', `${escHtml(String(originalAmount ?? 0))} lei`],
      ['Încasat', `<strong>${escHtml(String(collectedAmount ?? 0))} lei</strong>`],
      ['Reducere', `<strong>${escHtml(String(discountAmount ?? 0))} lei</strong>`],
      ['Motiv', escHtml(reason || '—')],
      ['Metodă', escHtml(paidBy === 'card' ? 'Card' : 'Numerar')],
      ['Acordată de', escHtml(agentName || '—')],
      ['Data', escHtml(fmtDateTime(new Date().toISOString()))],
    ],
    note: 'Acțiune de birou — vezi jurnalul de acțiuni (/admin/audit) pentru istoricul complet.',
    replyTo: replyToOf(customerEmail, customerName),
    tags: ['desk-discount'],
  });
}

export async function notifyAdminPasswordReset({ email, displayName }) {
  return notifyAdmin({
    subject: `Resetare parolă cerută: ${displayName || email}`,
    heading: 'Cerere de resetare parolă',
    rows: [
      ['Nume', escHtml(displayName || '—')],
      ['Email', mailto(email)],
      ['Data', escHtml(fmtDateTime(new Date().toISOString()))],
    ],
    replyTo: replyToOf(email, displayName),
    tags: ['password-reset'],
  });
}
