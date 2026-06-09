// Firestore-trigger email senders — Phase E.
//
// Every email fires on a Firestore document create. The handler reads the
// doc, resolves recipient + locale, builds the template params, and calls
// the Brevo API wrapper. Errors are logged but never re-thrown — a failed
// email must not put a customer-facing flow in a retry loop.
//
// Triggers in this file:
//   onUserCreated                — E1: signup welcome
//   onBookingCreated             — E2: long-term reservation confirm
//                                       (branches on paymentStatus)
//   onTokenTransactionCreated    — E3: credit purchase (type=purchase)
//                                  E4: credit used (type=use)
//                                  E5: low-credit warning (when applicable)

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { BREVO_API_KEY, sendBrevoEmail, sendBrevoRaw } from './brevo.js';

const SITE_URL = process.env.SITE_URL || 'https://mangoparking.ro';

// ── Helpers ──────────────────────────────────────────────────────────────

function normalizePlate(plate) {
  return String(plate || '').toUpperCase().replace(/[\s-]/g, '');
}

function firstNameFrom(...sources) {
  for (const s of sources) {
    if (!s) continue;
    const trimmed = String(s).trim();
    if (!trimmed) continue;
    const first = trimmed.split(/\s+/)[0];
    if (first) return first;
  }
  return 'prieten';
}

function localePathOf(path, locale) {
  return locale === 'en' ? `${SITE_URL}/en${path}` : `${SITE_URL}${path}`;
}

function fmtDateTime(iso, locale) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return d.toLocaleString(locale === 'en' ? 'en-GB' : 'ro-RO', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// Cache the online discount percent for 5 min — it's set rarely and read
// on every email send. settings/global is the canonical source.
let cachedDiscount = null;
let cachedDiscountAt = 0;
async function getOnlineDiscount() {
  const now = Date.now();
  if (cachedDiscount != null && now - cachedDiscountAt < 5 * 60 * 1000) return cachedDiscount;
  try {
    const snap = await getFirestore().collection('settings').doc('global').get();
    const v = snap.exists ? snap.data().onlineDiscountPercent : null;
    cachedDiscount = Number.isFinite(v) ? v : 10;
  } catch {
    cachedDiscount = 10;
  }
  cachedDiscountAt = now;
  return cachedDiscount;
}

// Resolve recipient (email, name, locale) from a customerId (uid),
// a license plate (guest), or explicit fallback contact data on the doc.
async function resolveRecipient({ customerId, licensePlate, contact }) {
  const db = getFirestore();
  // 1. Logged-in customer — users/{uid} is the source of truth.
  if (customerId) {
    try {
      const u = await db.collection('users').doc(customerId).get();
      if (u.exists) {
        const data = u.data();
        if (data.email) {
          return {
            email: data.email,
            name: data.displayName || contact?.name || '',
            firstName: firstNameFrom(data.displayName, contact?.name, data.email),
            locale: data.locale === 'en' ? 'en' : 'ro',
          };
        }
      }
    } catch (err) {
      console.warn('resolveRecipient: users lookup failed', err?.message);
    }
  }
  // 2. Guest plate-keyed balance — tokenBalances/plate_X stores email.
  if (licensePlate) {
    try {
      const b = await db.collection('tokenBalances').doc(`plate_${normalizePlate(licensePlate)}`).get();
      if (b.exists) {
        const data = b.data();
        if (data.email) {
          return {
            email: data.email,
            name: data.displayName || contact?.name || '',
            firstName: firstNameFrom(data.displayName, contact?.name, data.email),
            locale: 'ro',
          };
        }
      }
    } catch (err) {
      console.warn('resolveRecipient: plate lookup failed', err?.message);
    }
  }
  // 3. Explicit contact (e.g. booking.contact.email).
  if (contact?.email) {
    return {
      email: contact.email,
      name: contact.name || '',
      firstName: firstNameFrom(contact.name, contact.email),
      locale: 'ro',
    };
  }
  return null;
}

// ── E1: signup-welcome ───────────────────────────────────────────────────

export const onUserCreated = onDocumentCreated(
  { document: 'users/{uid}', region: 'europe-west1', secrets: [BREVO_API_KEY] },
  async (event) => {
    const data = event.data?.data();
    if (!data?.email) return;

    // Admin invites already trigger the branded admin-invite email — skip
    // the signup-welcome so invitees don't get two emails on the same
    // event. The pendingInvites doc is created by adminSendInvite and
    // deleted by finishInviteSignup, so its presence here is the signal.
    const db = getFirestore();
    const inviteRef = db.collection('pendingInvites').doc(data.email.toLowerCase());
    const inviteSnap = await inviteRef.get();
    if (inviteSnap.exists) {
      console.log('onUserCreated: skip welcome (invite path)', event.params.uid);
      return;
    }

    // Idempotency claim on users/{uid} via welcomeEmailSentAt.
    const userRef = db.collection('users').doc(event.params.uid);
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) return false;
      if (snap.data().welcomeEmailSentAt) return false;
      tx.update(userRef, { welcomeEmailSentAt: FieldValue.serverTimestamp() });
      return true;
    }).catch((err) => {
      console.warn('onUserCreated: claim failed', err?.message);
      return false;
    });
    if (!claimed) {
      console.log('onUserCreated: skip (duplicate)', event.params.uid);
      return;
    }

    const locale = data.locale === 'en' ? 'en' : 'ro';
    console.log(`onUserCreated: sending welcome to=${data.email} locale=${locale}`);
    await sendBrevoEmail({
      to: data.email,
      name: data.displayName || '',
      templateName: 'signup-welcome',
      locale,
      params: {
        firstName: firstNameFrom(data.displayName, data.email),
      },
    });
  }
);

// ── E2: booking-longterm-confirm ────────────────────────────────────────

export const onBookingCreated = onDocumentCreated(
  { document: 'bookings/{id}', region: 'europe-west1', secrets: [BREVO_API_KEY] },
  async (event) => {
    const booking = event.data?.data();
    if (!booking) return;
    // Credit-type bookings don't get a confirmation email here — the
    // credit-purchase transaction trigger covers that path.
    if (booking.type !== 'longTerm') return;

    // Idempotency claim — v2 Firestore triggers can fire twice. The
    // transaction either marks the booking as "confirm email sent" and
    // lets us proceed, or sees the mark and tells us to bail.
    const db = getFirestore();
    const bookingRef = db.collection('bookings').doc(event.params.id);
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(bookingRef);
      if (!snap.exists) return false;
      if (snap.data().confirmEmailSentAt) return false;
      tx.update(bookingRef, { confirmEmailSentAt: FieldValue.serverTimestamp() });
      return true;
    }).catch((err) => {
      console.warn('onBookingCreated: claim transaction failed', err?.message);
      return false;
    });
    if (!claimed) {
      console.log('onBookingCreated: skip (duplicate or already sent)', event.params.id);
      return;
    }

    const recipient = await resolveRecipient({
      customerId: booking.customerId,
      licensePlate: booking.licensePlate,
      contact: booking.contact,
    });
    if (!recipient) {
      console.warn('onBookingCreated: no recipient resolvable', event.params.id);
      return;
    }
    console.log(`onBookingCreated: sending to=${recipient.email} locale=${recipient.locale} bookingId=${event.params.id}`);

    const paid = booking.paymentStatus !== 'unpaid';
    const discountPct = paid ? 0 : await getOnlineDiscount();
    // Pay-online recovery link — the orderId is in the URL; the /pay page
    // re-enters Netopia for an existing pay-at-pickup order, applying the
    // online discount.
    const payOrderId = booking.paymentId || event.params.id;
    const payOnlineLink = paid ? '' : `${SITE_URL}/pay?orderId=${payOrderId}`;

    await sendBrevoEmail({
      to: recipient.email,
      name: recipient.name,
      templateName: 'booking-longterm-confirm',
      locale: recipient.locale,
      // Admin copy is handled by adminNotifyBookingCreated (a dedicated ops
      // alert), so no BCC here — avoids double-emailing rezervari@.
      params: {
        firstName: recipient.firstName,
        code: booking.code || `LT-${event.params.id.slice(0, 5).toUpperCase()}`,
        plate: booking.licensePlate,
        days: booking.days,
        dropoffAt: fmtDateTime(booking.dropoffAt || booking.startDate, recipient.locale),
        pickupAt: fmtDateTime(booking.pickupAt || booking.endDate, recipient.locale),
        totalAmount: booking.totalPrice,
        paid,
        payOnlineLink,
        discountPct,
      },
    });
  }
);

// Called from the IPN callback when a pay-at-pickup booking gets paid
// online (repay flow). The onBookingCreated trigger already fired at
// order time with paid=false, so a follow-up email is needed to confirm
// the payment landed. No idempotency claim here — the IPN itself is
// guarded by pendingOrders.status === 'paid' upstream.
export async function sendRepayPaidEmail(bookingId) {
  const db = getFirestore();
  const snap = await db.collection('bookings').doc(bookingId).get();
  if (!snap.exists) return;
  const booking = snap.data();
  if (booking.type !== 'longTerm') return;
  const recipient = await resolveRecipient({
    customerId: booking.customerId,
    licensePlate: booking.licensePlate,
    contact: booking.contact,
  });
  if (!recipient) return;
  await sendBrevoEmail({
    to: recipient.email,
    name: recipient.name,
    templateName: 'booking-longterm-confirm',
    locale: recipient.locale,
    params: {
      firstName: recipient.firstName,
      code: booking.code || `LT-${bookingId.slice(0, 5).toUpperCase()}`,
      plate: booking.licensePlate,
      days: booking.days,
      dropoffAt: fmtDateTime(booking.dropoffAt || booking.startDate, recipient.locale),
      pickupAt: fmtDateTime(booking.pickupAt || booking.endDate, recipient.locale),
      totalAmount: booking.totalPrice,
      paid: true,
      payOnlineLink: '',
      discountPct: 0,
    },
  });
}

// Called from adminMarkRefunded (auto) or adminResendRefundEmail (manual).
// Tells the customer the refund has been issued and to expect the funds
// on their card / in cash within the usual settlement window.
//
// Persists a `refundEmail` block on the booking so the admin /refunds
// history can show the latest send status (and offer a resend when the
// auto-send fails for any reason — bad recipient, Brevo outage,
// template ID missing pre-rollout, etc.).
export async function sendRefundIssuedEmail(bookingId) {
  const db = getFirestore();
  const bookingRef = db.collection('bookings').doc(bookingId);
  const snap = await bookingRef.get();
  if (!snap.exists) return { ok: false, reason: 'booking-not-found' };
  const booking = snap.data();
  if (booking.type !== 'longTerm') return { ok: false, reason: 'wrong-type' };

  const nowIso = new Date().toISOString();
  const attempts = (booking.refundEmail?.attempts || 0) + 1;

  const writeStatus = async (status, extras = {}) =>
    bookingRef.update({
      refundEmail: {
        status,
        attempts,
        lastAttemptAt: nowIso,
        ...(status === 'sent' ? { sentAt: nowIso, lastError: null } : {}),
        ...extras,
      },
    }).catch((err) => console.warn('refundEmail status write failed:', err?.message));

  const recipient = await resolveRecipient({
    customerId: booking.customerId,
    licensePlate: booking.licensePlate,
    contact: booking.contact,
  });
  if (!recipient) {
    await writeStatus('failed', { lastError: 'no-recipient' });
    return { ok: false, reason: 'no-recipient' };
  }

  // 'card' for any online/admin-card refund (funds back to card via bank
  // settlement, 3–5 business days). 'cash' for admin-cash refunds
  // (returned at the lot, no waiting period).
  const via = booking.refundedVia;
  const channel = via === 'cash-returned' ? 'cash' : 'card';

  const result = await sendBrevoEmail({
    to: recipient.email,
    name: recipient.name,
    templateName: 'booking-refunded',
    locale: recipient.locale,
    params: {
      firstName: recipient.firstName,
      code: booking.code || `LT-${bookingId.slice(0, 5).toUpperCase()}`,
      plate: booking.licensePlate,
      totalAmount: booking.totalPrice,
      channel,
      refundedAt: fmtDateTime(booking.refundedAt, recipient.locale),
    },
  });

  if (result?.ok) {
    await writeStatus('sent', { recipient: recipient.email });
    return { ok: true, messageId: result.messageId, recipient: recipient.email };
  }
  await writeStatus('failed', { lastError: result?.reason || 'unknown' });
  return { ok: false, reason: result?.reason || 'unknown' };
}

// ── E3 / E4 / E5: tokenTransactions branched by type ─────────────────────

export const onTokenTransactionCreated = onDocumentCreated(
  { document: 'tokenTransactions/{id}', region: 'europe-west1', secrets: [BREVO_API_KEY] },
  async (event) => {
    const tx = event.data?.data();
    if (!tx) return;
    if (tx.type !== 'purchase' && tx.type !== 'use') return;

    // Idempotency — v2 Firestore triggers can fire twice. tokenTransactions
    // is append-only per rules but Cloud Functions bypass rules. We add a
    // single non-semantic emailSentAt field; auditors can ignore it.
    const db = getFirestore();
    const txRef = db.collection('tokenTransactions').doc(event.params.id);
    const claimed = await db.runTransaction(async (innerTx) => {
      const snap = await innerTx.get(txRef);
      if (!snap.exists) return false;
      if (snap.data().emailSentAt) return false;
      innerTx.update(txRef, { emailSentAt: FieldValue.serverTimestamp() });
      return true;
    }).catch((err) => {
      console.warn('onTokenTransactionCreated: claim failed', err?.message);
      return false;
    });
    if (!claimed) {
      console.log('onTokenTransactionCreated: skip (duplicate)', event.params.id);
      return;
    }

    console.log(`onTokenTransactionCreated: handling type=${tx.type} plate=${tx.licensePlate} id=${event.params.id}`);
    if (tx.type === 'purchase') return handlePurchase(tx);
    if (tx.type === 'use') return handleUse(tx);
  }
);

async function handlePurchase(tx) {
  const recipient = await resolveRecipient({
    customerId: tx.customerId,
    licensePlate: tx.licensePlate,
    contact: tx.billing,
  });
  if (!recipient) return;

  const db = getFirestore();
  const balanceDocId = tx.customerId || `plate_${normalizePlate(tx.licensePlate)}`;
  const balSnap = await db.collection('tokenBalances').doc(balanceDocId).get();
  const balanceAfter = balSnap.exists ? Number(balSnap.data().balance || 0) : tx.quantity;

  // Brevo conditional `{% if params.paid %}` reads the boolean directly.
  // Source determines paid state: 'netopia' is always paid; 'admin-cash'
  // and 'admin-card' are paid (collected at the lot); anything else
  // defaults to paid for backward compat.
  const paid = tx.source !== 'pending-pickup'; // future: pay-at-pickup pendingOrders
  const discountPct = paid ? 0 : await getOnlineDiscount();
  const payOnlineLink = paid ? '' : `${SITE_URL}/contact`;

  // ── E3: credit-purchase email ──
  await sendBrevoEmail({
    to: recipient.email,
    name: recipient.name,
    templateName: 'credit-purchase',
    locale: recipient.locale,
    params: {
      firstName: recipient.firstName,
      quantity: tx.quantity,
      totalAmount: tx.totalAmount || tx.amount || '',
      plate: tx.licensePlate,
      balanceAfter,
      paid,
      payOnlineLink,
      discountPct,
    },
  });
}

async function handleUse(tx) {
  const recipient = await resolveRecipient({
    customerId: tx.customerId,
    licensePlate: tx.licensePlate,
    contact: null,
  });
  if (!recipient) return;

  const db = getFirestore();
  const balanceDocId = tx.customerId || `plate_${normalizePlate(tx.licensePlate)}`;
  const balSnap = await db.collection('tokenBalances').doc(balanceDocId).get();
  const balanceAfter = balSnap.exists ? Number(balSnap.data().balance || 0) : 0;
  // tx.quantity for type='use' is -1 (signed). The previous balance is
  // balanceAfter + |quantity|.
  const previousBalance = balanceAfter + Math.abs(Number(tx.quantity) || 1);

  // ── E4: credit-used email ──
  await sendBrevoEmail({
    to: recipient.email,
    name: recipient.name,
    templateName: 'credit-used',
    locale: recipient.locale,
    params: {
      firstName: recipient.firstName,
      plate: tx.licensePlate,
      balanceAfter,
      dateUsed: fmtDateTime(tx.timestamp, recipient.locale),
    },
  });

  // ── E5: low-credit warning, one-shot when crossing the 2-credit line ──
  // Skip when balance hits 0 — the customer already knows they're out,
  // and a "low credits" subject line at that point is misleading.
  if (previousBalance > 2 && balanceAfter <= 2 && balanceAfter > 0) {
    await sendBrevoEmail({
      to: recipient.email,
      name: recipient.name,
      templateName: 'low-credit-warning',
      locale: recipient.locale,
      params: {
        firstName: recipient.firstName,
        balanceRemaining: balanceAfter,
        buyMoreLink: localePathOf('/booking/credits', recipient.locale),
      },
    });
  }
}

// ── Contact form → email rezervari@ ──────────────────────────────────────
// Every contactMessages doc (from the homepage + /contact forms) emails the
// reservations inbox so submissions aren't a silent Firestore dead-drop.
// Reply-To is set to the customer, so staff can reply straight from the
// notification. Raw HTML send — no Brevo template needed.
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

export const onContactMessageCreated = onDocumentCreated(
  { document: 'contactMessages/{id}', region: 'europe-west1', secrets: [BREVO_API_KEY] },
  async (event) => {
    const m = event.data?.data();
    if (!m) return;

    // Idempotency — v2 triggers can fire more than once.
    const db = getFirestore();
    const ref = db.collection('contactMessages').doc(event.params.id);
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      if (snap.data().notifiedAt) return false;
      tx.update(ref, { notifiedAt: FieldValue.serverTimestamp() });
      return true;
    }).catch((err) => {
      console.warn('onContactMessageCreated: claim failed', err?.message);
      return false;
    });
    if (!claimed) {
      console.log('onContactMessageCreated: skip (duplicate)', event.params.id);
      return;
    }

    const name = escHtml(m.name) || '—';
    const email = escHtml(m.email) || '—';
    const subject = (m.subject && String(m.subject).trim()) ? escHtml(m.subject) : '(fără subiect)';
    const message = escHtml(m.message).replace(/\n/g, '<br>');

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1A1A1A;line-height:1.5">
        <h2 style="color:#0F2D66;margin:0 0 16px">Mesaj nou de contact</h2>
        <table cellpadding="0" cellspacing="0" style="border-collapse:collapse">
          <tr><td style="padding:4px 16px 4px 0;color:#4B5563"><strong>Nume</strong></td><td style="padding:4px 0">${name}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#4B5563"><strong>Email</strong></td><td style="padding:4px 0"><a href="mailto:${email}">${email}</a></td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#4B5563"><strong>Subiect</strong></td><td style="padding:4px 0">${subject}</td></tr>
        </table>
        <div style="margin:16px 0;padding:16px;background:#FFF8E8;border:1px solid #EDE3CC;border-radius:12px;white-space:pre-wrap">${message}</div>
        <p style="font-size:13px;color:#4B5563;margin:8px 0 0">Răspunde direct la acest email pentru a-i scrie clientului.</p>
      </div>`;

    const replyTo = (m.email && String(m.email).includes('@'))
      ? { email: String(m.email), name: m.name || String(m.email) }
      : undefined;

    console.log(`onContactMessageCreated: notifying rezervari@ for ${event.params.id} from=${email}`);
    await sendBrevoRaw({
      to: 'rezervari@mangoparking.ro',
      name: 'Mango Parking Rezervări',
      subject: `Contact site: ${subject}`,
      html,
      replyTo,
      tags: ['contact-form'],
    });
  }
);
