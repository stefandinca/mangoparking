// Phase F — Scheduled Cloud Functions.
//
// Three daily jobs, all in europe-west1:
//   daily24hReminders  — 10:00 Europe/Bucharest
//                        E8 reminder-checkin-24h   (24h before dropoff)
//                        E9 reminder-checkout-24h  (24h before pickup)
//   commuter7PMCheck   — 19:00 Europe/Bucharest
//                        E10 reminder-commuter-7pm (commuter still checked in
//                        late afternoon → 1-hour-warning before overnight fee)
//   expireStaleHolds   — 02:00 Europe/Bucharest
//                        Flips pendingOrders older than 14 days still in
//                        awaiting-payment/pending → expired (housekeeping).
//
// Idempotency: each job stamps a per-day field on the source doc
// (reminderCheckinSentAt, reminderCheckoutSentAt, reminderCommuterSentAt)
// so a manual re-run doesn't double-send.

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { BREVO_API_KEY, sendBrevoEmail } from './brevo.js';
import { SMARTBILL_SECRETS, deleteEstimate } from './smartbill.js';
import { PARKVIA_SECRETS } from './parkvia.js';
import { runParkviaSync, reportParkviaNoShowSafe } from './index.js';

const REGION = 'europe-west1';
const TZ = 'Europe/Bucharest';

// v1.2 Phase 4: drop the (non-fiscal) SmartBill proforma of a doc that will
// never be paid (no-show, expired hold). Best-effort — fiscal housekeeping
// must never block the job. `mirrorRef` is the linked order/booking doc that
// carries the SAME proforma block — stamp it too, or the other sweep would
// re-attempt the delete against a document that's already gone.
async function dropProforma(ref, data, label, mirrorRef = null) {
  const p = data?.smartbill?.proforma;
  if (!p?.number || data?.smartbill?.proformaDeleted) return;
  try {
    await deleteEstimate(p.series, p.number);
    await ref.update({ 'smartbill.proformaDeleted': true }).catch(() => {});
    if (mirrorRef) await mirrorRef.update({ 'smartbill.proformaDeleted': true }).catch(() => {});
  } catch (err) {
    console.warn(`${label}: proforma delete failed`, err?.message);
  }
}

function isoDayPart(iso) {
  // 'YYYY-MM-DD' interpreted in Europe/Bucharest, so the 7PM commuter
  // check correctly compares the check-in's local calendar day with
  // "today" — using string slice(0,10) of a UTC ISO would drop the day
  // around midnight (UTC+2/3 offset).
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}

function fmtDateTime(iso, locale) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(locale === 'en' ? 'en-GB' : 'ro-RO', {
      timeZone: TZ,
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

async function resolveRecipient({ customerId, contact, licensePlate }) {
  const db = getFirestore();
  if (customerId) {
    const snap = await db.collection('users').doc(customerId).get();
    if (snap.exists) {
      const u = snap.data();
      if (u.email) {
        return {
          email: u.email,
          name: u.displayName || u.email.split('@')[0],
          firstName: (u.displayName || u.email.split('@')[0]).split(/\s+/)[0],
          locale: u.locale === 'en' ? 'en' : 'ro',
        };
      }
    }
  }
  if (contact?.email) {
    return {
      email: contact.email,
      name: contact.name || contact.email.split('@')[0],
      firstName: (contact.name || contact.email.split('@')[0]).split(/\s+/)[0],
      locale: 'ro',
    };
  }
  if (licensePlate) {
    const snap = await db.collection('tokenBalances').doc(`plate_${licensePlate}`).get();
    if (snap.exists) {
      const tb = snap.data();
      if (tb.email) {
        return {
          email: tb.email,
          name: tb.displayName || tb.email.split('@')[0],
          firstName: (tb.displayName || tb.email.split('@')[0]).split(/\s+/)[0],
          locale: 'ro',
        };
      }
    }
  }
  return null;
}

// ── E8 / E9: 24h reminders ─────────────────────────────────────────────
// Runs at 10:00 local. Sends to any longTerm booking whose dropoffAt /
// pickupAt falls within ±1 hour of (now + 24h).
export const daily24hReminders = onSchedule(
  {
    schedule: '0 10 * * *',
    timeZone: TZ,
    region: REGION,
    secrets: [BREVO_API_KEY],
  },
  async () => {
    const db = getFirestore();
    const now = Date.now();
    const targetMin = now + 23 * 60 * 60 * 1000;
    const targetMax = now + 25 * 60 * 60 * 1000;
    const inWindow = (iso) => {
      if (!iso) return false;
      const ms = Date.parse(iso);
      return Number.isFinite(ms) && ms >= targetMin && ms <= targetMax;
    };

    // Pull a wider window than strictly needed; we filter in memory to
    // avoid composite-index churn.
    const snap = await db.collection('bookings')
      .where('status', 'in', ['upcoming', 'active'])
      .get();

    let sentCheckin = 0;
    let sentCheckout = 0;

    for (const doc of snap.docs) {
      const b = doc.data();
      if (b.type !== 'longTerm') continue;

      const dropoff = b.dropoffAt || b.startDate;
      const pickup = b.pickupAt || b.endDate;

      const recipientPromise = resolveRecipient({
        customerId: b.customerId,
        licensePlate: b.licensePlate,
        contact: b.contact,
      });

      // E8 — 24h before dropoff
      if (b.status === 'upcoming' && inWindow(dropoff)) {
        if (!b.reminderCheckinSentAt) {
          const recipient = await recipientPromise;
          if (recipient) {
            await sendBrevoEmail({
              to: recipient.email,
              name: recipient.name,
              templateName: 'reminder-checkin-24h',
              locale: recipient.locale,
              params: {
                firstName: recipient.firstName,
                code: b.code || `LT-${doc.id.slice(0, 5).toUpperCase()}`,
                plate: b.licensePlate,
                dropoffAt: fmtDateTime(dropoff, recipient.locale),
                pickupAt: fmtDateTime(pickup, recipient.locale),
              },
            });
            await doc.ref.update({ reminderCheckinSentAt: FieldValue.serverTimestamp() });
            sentCheckin++;
          }
        }
      }

      // E9 — 24h before pickup. Active bookings only — the top query also
      // returns `upcoming` ones, and a short booking created ~24h before its
      // pick-up would get a "your car is ready for pickup" email before the
      // customer even dropped the car off.
      if (b.status === 'active' && inWindow(pickup)) {
        if (!b.reminderCheckoutSentAt) {
          const recipient = await recipientPromise;
          if (recipient) {
            await sendBrevoEmail({
              to: recipient.email,
              name: recipient.name,
              templateName: 'reminder-checkout-24h',
              locale: recipient.locale,
              params: {
                firstName: recipient.firstName,
                code: b.code || `LT-${doc.id.slice(0, 5).toUpperCase()}`,
                plate: b.licensePlate,
                pickupAt: fmtDateTime(pickup, recipient.locale),
              },
            });
            await doc.ref.update({ reminderCheckoutSentAt: FieldValue.serverTimestamp() });
            sentCheckout++;
          }
        }
      }
    }

    console.log(`daily24hReminders: checkin=${sentCheckin} checkout=${sentCheckout} scanned=${snap.size}`);
  }
);

// ── E10: 19:00 commuter pickup nudge ───────────────────────────────────
// Every commuter checked in today and not yet checked out gets a 1-hour
// warning. Cutoff (20:00 default) is policy, not enforced here.
export const commuter7PMCheck = onSchedule(
  {
    schedule: '0 19 * * *',
    timeZone: TZ,
    region: REGION,
    secrets: [BREVO_API_KEY],
  },
  async () => {
    const db = getFirestore();
    const snap = await db.collection('activeCheckIns').get();
    const todayPart = new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // 'YYYY-MM-DD'

    let sent = 0;
    for (const doc of snap.docs) {
      const a = doc.data();
      if (isoDayPart(a.checkinTime) !== todayPart) continue;
      if (a.reminderCommuterSentAt) continue;

      const plate = a.licensePlate || doc.id;
      const balanceDocId = a.balanceDocId;

      // Pull the balance doc to get the customer's contact details.
      let recipient = null;
      let customerId = null;
      if (balanceDocId && !balanceDocId.startsWith('plate_')) {
        customerId = balanceDocId;
      }
      recipient = await resolveRecipient({ customerId, licensePlate: plate });
      // Fall back to the balance doc itself for guest plates.
      if (!recipient && balanceDocId) {
        const bal = await db.collection('tokenBalances').doc(balanceDocId).get();
        if (bal.exists) {
          const d = bal.data();
          if (d.email) {
            recipient = {
              email: d.email,
              name: d.displayName || d.email.split('@')[0],
              firstName: (d.displayName || d.email.split('@')[0]).split(/\s+/)[0],
              locale: 'ro',
            };
          }
        }
      }
      if (!recipient) continue;

      await sendBrevoEmail({
        to: recipient.email,
        name: recipient.name,
        templateName: 'reminder-commuter-7pm',
        locale: recipient.locale,
        params: {
          firstName: recipient.firstName,
          plate,
          cutoffTime: '20:00',
        },
      });
      await doc.ref.update({ reminderCommuterSentAt: FieldValue.serverTimestamp() });
      sent++;
    }
    console.log(`commuter7PMCheck: sent=${sent} scanned=${snap.size}`);
  }
);

// ── markNoShows ─────────────────────────────────────────────────────────
// Customers who reserved but never arrived. Hourly job — looks for
// upcoming bookings whose drop-off is more than 12h in the past with no
// matching `activeCheckIns` row. Flips status to 'no-show', stamps the
// detection metadata, releases the reserved spot, audit-logs the action.
//
// Idempotent: re-running on the same set is harmless because the query
// itself filters to status='upcoming' and the update flips it away.
//
// Why 12h: per v1.7 plan. Long enough to absorb late drop-offs (some
// customers running ~hours late from a delayed flight) without leaving
// the spot blocked for a customer who is clearly never coming.
//
// Date handling: we query only on status and filter the drop-off cutoff
// in memory on `dropoffAt || startDate`. A Firestore range query on
// `dropoffAt` silently EXCLUDES docs where that field is null — and web
// bookings written by createBookingFromOrder store `dropoffAt: null`
// (only startDate/endDate are set), so the old range query never flagged
// them and they sat in the Check-in tab forever. The bookings collection
// is small at our scale, so the in-memory scan is fine.
export const markNoShows = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeZone: TZ,
    region: REGION,
    // SmartBill for the proforma cleanup + ParkVia for the no-show report-back.
    secrets: [...SMARTBILL_SECRETS, ...PARKVIA_SECRETS],
  },
  async () => {
    const db = getFirestore();
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const snap = await db.collection('bookings')
      .where('status', '==', 'upcoming')
      .get();

    const nowIso = new Date().toISOString();
    let flagged = 0;
    let scanned = 0;
    for (const doc of snap.docs) {
      const data = doc.data();
      // Long-term reservations only — credit bookings are created already
      // 'active', never 'upcoming', so this is belt-and-suspenders.
      if (data.type && data.type !== 'longTerm') continue;
      // Drop-off cutoff, in memory so null dropoffAt falls back to startDate.
      const dropoff = data.dropoffAt || data.startDate;
      if (!dropoff || dropoff >= cutoff) continue;
      scanned++;
      // Defensive re-check: if a manual check-in raced in between the
      // query and now, skip. activeCheckIns is keyed by normalized plate
      // (spaces AND hyphens stripped — must match normalizePlate exactly,
      // else a hyphenated plate that DID check in gets falsely flagged).
      const plate = String(data.licensePlate || '').toUpperCase().replace(/[\s-]/g, '');
      if (plate) {
        const activeSnap = await db.collection('activeCheckIns').doc(plate).get();
        if (activeSnap.exists) continue;
      }

      const patch = {
        status: 'no-show',
        noShowAt: nowIso,
        noShowDetectedBy: 'scheduled',
        spotId: null,
      };
      await doc.ref.update(patch);

      // Release the spot so capacity reflects reality.
      if (data.spotId) {
        try {
          const spotRef = db.collection('spots').doc(data.spotId);
          const spotSnap = await spotRef.get();
          if (spotSnap.exists && spotSnap.data().status === 'reserved') {
            await spotRef.update({ status: 'available', currentBookingId: null });
          }
        } catch (err) {
          console.warn('markNoShows: spot release failed', err?.message);
        }
      }

      await db.collection('auditLog').add({
        action: 'booking_no_show',
        entityType: 'booking',
        entityId: doc.id,
        actorUid: 'scheduled',
        payload: {
          plate: data.licensePlate || null,
          dropoffAt: data.dropoffAt || null,
          customerId: data.customerId || null,
        },
        timestamp: nowIso,
      });
      // Unpaid no-show collected nothing → drop its proforma. Paid no-shows
      // forfeit the fee, so their fiscal invoice legitimately stands.
      if (data.paymentStatus !== 'paid') {
        await dropProforma(doc.ref, data, 'markNoShows',
          data.paymentId ? db.collection('pendingOrders').doc(data.paymentId) : null);
      }
      // ParkVia-imported booking → tell ParkVia the customer never arrived.
      await reportParkviaNoShowSafe(doc.ref, data);
      flagged++;
    }
    console.log(`markNoShows: flagged=${flagged} pastCutoff=${scanned} upcoming=${snap.size}`);
  }
);

// ── Housekeeping: expire stale pay-at-pickup holds ─────────────────────
// pendingOrders that never got paid stay forever otherwise. After 14 days
// the lot has long given the spot up, the booking is cancelled by ops,
// and the doc is just clutter. Flip to expired so admin views can ignore
// it. The booking itself (if any) is the source of truth for the spot —
// expiring the pendingOrders doc doesn't touch it.
export const expireStaleHolds = onSchedule(
  {
    schedule: '0 2 * * *',
    timeZone: TZ,
    region: REGION,
    secrets: SMARTBILL_SECRETS,
  },
  async () => {
    const db = getFirestore();
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const snap = await db.collection('pendingOrders')
      .where('paymentStatus', '==', 'unpaid')
      .where('createdAt', '<', cutoff)
      .get();

    let expired = 0;
    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.status === 'paid' || data.status === 'expired') continue;
      await doc.ref.update({
        status: 'expired',
        expiredAt: new Date().toISOString(),
      });
      // The order will never be paid → its (non-fiscal) proforma goes too.
      await dropProforma(doc.ref, data, 'expireStaleHolds',
        data.bookingId ? db.collection('bookings').doc(data.bookingId) : null);
      expired++;
    }
    console.log(`expireStaleHolds: expired=${expired} scanned=${snap.size}`);
  }
);

// ── ParkVia auto-import poll ────────────────────────────────────────────
// Pull new/changed ParkVia (ParkCloud) reservations and import them as broker
// bookings, reconciling cancellations. DORMANT until ParkCloud credentials are
// configured — runParkviaSync (index.js) returns { configured:false } and this
// is a logged no-op. The real work + idempotency live in runParkviaSync; this
// is just its schedule. The admin "Sync now" button calls the same function.
export const pollParkviaBookings = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: TZ,
    region: REGION,
    secrets: PARKVIA_SECRETS,
  },
  async () => {
    const r = await runParkviaSync('scheduled');
    console.log(`pollParkviaBookings: ${JSON.stringify(r)}`);
  }
);
