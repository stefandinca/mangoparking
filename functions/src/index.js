// Mango Parking Cloud Functions — Netopia Mobilpay v2 payment bridge.
//
// Flow:
//   1. Client → POST createPayment
//      → returns { action, env_key, data, cipher, iv, orderId }
//      → client auto-submits a POST form to `action` (Netopia hosted page)
//   2. User pays on Netopia.
//   3. Netopia → POST netopiaCallback (server-to-server)
//      → decrypt envelope with merchant private key
//      → parse XML, check action==='confirmed' (or 'paid')
//      → credit tokens / create booking
//      → respond with <crc>success</crc>
//   4. Netopia → redirects browser to the merchant `return_url`
//      → client-side success page reads ?orderId=... and polls status.
//
// Integration reference: https://github.com/mobilpay/Node.js (official PoC)
//
// Secrets (bind via `firebase functions:secrets:set`):
//   NETOPIA_SIGNATURE    — merchant POS signature string (goes in XML <signature>)
//   NETOPIA_PUBLIC_KEY   — PEM, used to encrypt outgoing requests
//   NETOPIA_PRIVATE_KEY  — PEM, used to decrypt IPN callbacks
//   NETOPIA_ENV          — 'sandbox' or 'live' (defaults to sandbox)
//   NETOPIA_API_KEY      — currently unused; reserved for the v3 REST API

import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { defineSecret } from 'firebase-functions/params';
import {
  NETOPIA_ENDPOINTS,
  encryptRequest,
  decryptIpn,
  buildRequestXml,
  crcSuccess,
  crcError,
} from './netopia.js';
import { BREVO_API_KEY, sendBrevoEmail } from './brevo.js';
import { sendRepayPaidEmail, sendRefundIssuedEmail } from './emails.js';
import { notifyAdminPasswordReset } from './adminNotifications.js';
import { computeAuthoritativeLongTermTotal, computeAuthoritativePackPrice, resolveVoucher } from './pricingValidate.js';

// Email triggers (Phase E) — re-exported so firebase deploy picks them up.
export { onUserCreated, onBookingCreated, onTokenTransactionCreated, onContactMessageCreated, onPromoVoucherAssigned } from './emails.js';

// Internal ops alerts to rezervari@ — customer activity (signup, reservation,
// cancellation, credit purchase). Inline-HTML sends, no Brevo template.
export {
  adminNotifyUserCreated,
  adminNotifyBookingCreated,
  adminNotifyBookingCancelled,
  adminNotifyCreditPurchase,
} from './adminNotifications.js';

// ANAF CUI lookup callable (Phase B4).
export { lookupCui } from './cui.js';

// Scheduled jobs (Phase F).
export { daily24hReminders, commuter7PMCheck, expireStaleHolds, markNoShows } from './scheduled.js';

initializeApp();
setGlobalOptions({ region: 'europe-west1', maxInstances: 10 });

const NETOPIA_SIGNATURE   = defineSecret('NETOPIA_SIGNATURE');
const NETOPIA_PUBLIC_KEY  = defineSecret('NETOPIA_PUBLIC_KEY');
const NETOPIA_PRIVATE_KEY = defineSecret('NETOPIA_PRIVATE_KEY');
const NETOPIA_ENV         = defineSecret('NETOPIA_ENV');       // 'sandbox' | 'live'
const NETOPIA_API_KEY     = defineSecret('NETOPIA_API_KEY');   // reserved

const SITE_URL = process.env.SITE_URL || 'https://mangoparking.ro';
// `netopiaCallback` is a separate Cloud Run service in Gen 2 — its hostname
// differs from `createPayment`, so we can't derive it from `req.host`.
// Override per environment via NETOPIA_CALLBACK_URL when redeploying.
const CALLBACK_URL =
  process.env.NETOPIA_CALLBACK_URL
  || 'https://netopiacallback-zddpe6b7fa-ew.a.run.app';

function normalizePlate(plate) {
  return String(plate || '').toUpperCase().replace(/[\s-]/g, '');
}

// `hour`:00 Europe/Bucharest on the local calendar day of `iso`, as an ISO
// string. Commuter (credit) check-ins use this as their pick-up deadline —
// "leave by 8 PM the same day" — instead of mirroring the drop-off time.
// DST-correct: anchors the wall-clock hour via the zone's offset at that day.
function bucharestCutoffIso(iso, hour = 20) {
  const base = iso ? new Date(iso) : new Date();
  if (Number.isNaN(base.getTime())) return null;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(base); // YYYY-MM-DD
  const guessUtc = Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00Z`);
  if (!Number.isFinite(guessUtc)) return null;
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Bucharest', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = dtf.formatToParts(new Date(guessUtc)).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  const h = +p.hour === 24 ? 0 : +p.hour;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, h, +p.minute, +p.second);
  const offMin = Math.round((asUtc - guessUtc) / 60000);
  return new Date(guessUtc - offMin * 60000).toISOString();
}

function balanceDocId({ customerId, licensePlate }) {
  return customerId || `plate_${normalizePlate(licensePlate)}`;
}

// Reservation codes — mirror of src/utils/bookingCode.js. Kept inline so
// the function bundle doesn't depend on the client tree. Ambiguous chars
// I/O/0/1 removed so the code reads cleanly over the phone.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateBookingCode(type) {
  const prefix = type === 'longTerm' ? 'LT' : type === 'credit' ? 'CR' : 'MNG';
  let suffix = '';
  for (let i = 0; i < 5; i++) {
    suffix += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `${prefix}-${suffix}`;
}

async function creditTokens({ packId, quantity, amount = 0, customerData, source = 'netopia', paidBy = null, grantedBy = null }) {
  const db = getFirestore();
  const docId = balanceDocId(customerData);
  const plate = normalizePlate(customerData.licensePlate);
  const ref = db.collection('tokenBalances').doc(docId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const data = snap.data();
      const plates = data.plates?.includes(plate) ? data.plates : [...(data.plates || []), plate];
      // Patch contact details on the existing doc if they were missing —
      // a guest plate doc may have been created without an email, and
      // later signed up: we want resolveRecipient to find them.
      const patch = {
        balance: FieldValue.increment(quantity),
        totalPurchased: FieldValue.increment(quantity),
        plates,
      };
      if (!data.email && customerData.email) patch.email = customerData.email;
      if (!data.displayName && customerData.name) patch.displayName = customerData.name;
      if (!data.phone && customerData.phone) patch.phone = customerData.phone;
      tx.update(ref, patch);
    } else {
      tx.set(ref, {
        balance: quantity,
        totalPurchased: quantity,
        plates: [plate],
        email: customerData.email || '',
        displayName: customerData.name || '',
        phone: customerData.phone || '',
      });
    }
  });

  await db.collection('tokenTransactions').add({
    customerId: customerData.customerId || null,
    licensePlate: plate,
    type: 'purchase',
    quantity,
    // Total RON paid for this batch — required by the credit-purchase
    // email template; blank otherwise.
    amount: Number(amount) || 0,
    packId: packId || null,
    timestamp: new Date().toISOString(),
    source,
    paidBy,
    grantedBy,
    billing: customerData.billing || { type: 'PF' },
  });

  // Cache billing on the user profile for future pre-fill on subsequent purchases.
  if (customerData.customerId && customerData.billing) {
    await db.collection('users')
      .doc(customerData.customerId)
      .set({ billing: customerData.billing }, { merge: true })
      .catch((err) => console.warn('billing profile cache failed:', err?.message));
  }

  return docId;
}

// Pick the first available spot and flip it to `reserved`, then return
// its id. Returns null if no spot is free — callers should treat that
// as "all reserved" and continue without a spotId (admin can assign
// manually from the capacity page).
//
// Uses a Firestore transaction so two concurrent reservations don't
// grab the same spot.
async function reserveAvailableSpot(bookingId) {
  const db = getFirestore();
  const snap = await db.collection('spots')
    .where('status', '==', 'available')
    .limit(1)
    .get();
  if (snap.empty) return null;

  const candidateId = snap.docs[0].id;
  const ref = db.collection('spots').doc(candidateId);

  try {
    return await db.runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      if (!cur.exists || cur.data().status !== 'available') {
        return null;
      }
      tx.update(ref, {
        status: 'reserved',
        currentBookingId: bookingId || null,
      });
      return candidateId;
    });
  } catch (err) {
    console.warn('reserveAvailableSpot transaction failed:', err?.message);
    return null;
  }
}

async function createBookingFromOrder(orderId, order) {
  const db = getFirestore();
  const nowIso = new Date().toISOString();
  // Branch on the payment method so the booking is written with the
  // correct paymentStatus atomically — the onBookingCreated trigger
  // reads this exact snapshot to pick the email-template branch.
  const isPickup = order.paymentMethod === 'pay-at-pickup';
  // The booking total is what the customer is actually charged: online =
  // standard price minus the online discount (and any voucher), pay-at-pickup
  // = the standard price. `order.amount` carries that; fall back to the
  // standard total only for older orders that predate the field.
  const chargedAmount = Number.isFinite(Number(order.amount))
    ? Math.round(Number(order.amount))
    : Number(order.totalPrice);
  const bookingRef = await db.collection('bookings').add({
    code: generateBookingCode('longTerm'),
    type: 'longTerm',
    customerId: order.customerData.customerId || null,
    licensePlate: normalizePlate(order.customerData.licensePlate),
    // Date-only fields kept for backward compat with older admin views
    // and existing booking docs. New canonical fields are dropoffAt/pickupAt.
    startDate: order.startDate,
    endDate: order.endDate,
    dropoffAt: order.dropoffAt || null,
    pickupAt: order.pickupAt || null,
    days: order.days,
    basePrice: chargedAmount,
    latePrice: 0,
    totalPrice: chargedAmount,
    status: 'upcoming',
    contact: {
      name: order.customerData.name || '',
      email: order.customerData.email || '',
      phone: order.customerData.phone || '',
    },
    billing: order.customerData.billing || { type: 'PF' },
    // Always reference the pendingOrders doc — admin "Mark paid" and the
    // pay-online repay link both need it. Field is no longer "paid via X"
    // semantics; it's just the order reference.
    paymentId: orderId,
    paymentMethod: isPickup ? 'pay-at-pickup' : 'online',
    paymentStatus: isPickup ? 'unpaid' : 'paid',
    paidAt: isPickup ? null : nowIso,
    // 'voucher' when a days-type voucher fully covered the amount (free
    // order — no Netopia charge happened); 'netopia' otherwise.
    paidBy: isPickup ? null : (order.paidBy || 'netopia'),
    spotId: null,
    createdAt: nowIso,
    completedAt: null,
    source: 'web',
  });

  // Reserve a spot only when the booking is already paid. Pay-at-pickup
  // bookings reserve later, when admin flips them to paid.
  if (!isPickup) {
    const spotId = await reserveAvailableSpot(bookingRef.id);
    if (spotId) {
      await bookingRef.update({ spotId });
    }
  }

  // Cache billing on the user profile for future pre-fill. Only when a
  // logged-in customer placed the order — guests have no profile to write to.
  if (order.customerData.customerId && order.customerData.billing) {
    await db.collection('users')
      .doc(order.customerData.customerId)
      .set({ billing: order.customerData.billing }, { merge: true })
      .catch((err) => console.warn('billing profile cache failed:', err?.message));
  }

  return bookingRef.id;
}

// ── POST /createPayment ──────────────────────────────────────────────────
// Body (credits):   { orderType:'credits',  packId, quantity, customerData }
// Body (longTerm):  { orderType:'longTerm', startDate, endDate, days, totalPrice, customerData }
// customerData: { customerId?, licensePlate, name, email, phone }
//
// Returns: { action, env_key, data, cipher, iv, orderId }
//   → client builds a POST form with those three/four fields and submits to `action`.
export const createPayment = onRequest(
  {
    cors: true,
    secrets: [NETOPIA_SIGNATURE, NETOPIA_PUBLIC_KEY, NETOPIA_ENV],
  },
  async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('Method not allowed');

    const body = req.body || {};
    const orderType = body.orderType || 'credits';
    const cd = body.customerData || {};
    if (!cd.licensePlate) return res.status(400).json({ error: 'Missing licensePlate' });
    if (orderType === 'credits' && (!body.packId || !body.quantity)) {
      return res.status(400).json({ error: 'credits order requires packId + quantity' });
    }
    if (orderType === 'longTerm' && (!body.days || !body.totalPrice)) {
      return res.status(400).json({ error: 'longTerm order requires days + totalPrice' });
    }

    const orderId = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const paymentMethod = body.paymentMethod === 'pay-at-pickup' ? 'pay-at-pickup' : 'online';

    // Compute amount (RON) per funnel. Stored prices are the STANDARD
    // (on-site) price; online orders get the online-payment discount
    // applied below, pay-at-pickup orders pay the standard price unchanged.
    let amount;
    let details;
    // Authoritative day-count + daily rate from the long-term recompute —
    // consumed by days-type vouchers (N free days × this rate).
    let authoritativeDays = null;
    let authoritativePerDay = null;
    if (orderType === 'longTerm') {
      // Server-authoritative recomputation — re-derive the expected
      // online total from the canonical rates + seasonal periods and
      // require an exact match against what the client sent. Without
      // this, a tampered totalPrice would be charged as-is.
      const check = await computeAuthoritativeLongTermTotal({
        dropoffAt: body.dropoffAt,
        pickupAt: body.pickupAt,
      }).catch((err) => ({ ok: false, error: `compute-failed:${err?.message || 'unknown'}` }));
      if (!check.ok) {
        console.warn('createPayment longTerm price validation refused:', check.error, { dropoffAt: body.dropoffAt, pickupAt: body.pickupAt });
        return res.status(400).json({ error: `price validation failed: ${check.error}` });
      }
      const submitted = Number(body.totalPrice);
      if (!Number.isFinite(submitted) || submitted <= 0) {
        return res.status(400).json({ error: 'invalid totalPrice' });
      }
      if (submitted !== check.expected) {
        console.warn('createPayment longTerm price mismatch:', { submitted, expected: check.expected, days: check.days, periodId: check.periodId, plate: cd.licensePlate });
        return res.status(400).json({
          error: 'price mismatch — refresh the page and try again',
          expected: check.expected,
        });
      }
      amount = check.expected;
      authoritativeDays = check.days;
      authoritativePerDay = check.perDay;
      details = `Mango Parking — parcare pe termen lung (${check.days} zile)`;
    } else {
      // Credits — recompute against the canonical token pack to
      // prevent submitting a discounted price for a premium pack.
      const packCheck = await computeAuthoritativePackPrice({
        packId: body.packId,
        quantity: body.quantity,
      }).catch((err) => ({ ok: false, error: `compute-failed:${err?.message || 'unknown'}` }));
      if (!packCheck.ok) {
        console.warn('createPayment credits price validation refused:', packCheck.error, { packId: body.packId, quantity: body.quantity });
        return res.status(400).json({ error: `pack validation failed: ${packCheck.error}` });
      }
      const submitted = Number(body.packPrice || body.totalPrice || 0);
      if (!Number.isFinite(submitted) || submitted <= 0) {
        return res.status(400).json({ error: 'invalid packPrice' });
      }
      if (submitted !== packCheck.expectedPrice) {
        console.warn('createPayment credits price mismatch:', { submitted, expected: packCheck.expectedPrice, packId: body.packId, plate: cd.licensePlate });
        return res.status(400).json({
          error: 'price mismatch — refresh the page and try again',
          expected: packCheck.expectedPrice,
        });
      }
      amount = packCheck.expectedPrice;
      details = `Mango Parking — pachet ${packCheck.expectedQty} credite`;
    }
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Missing or invalid amount' });
    }

    if (paymentMethod === 'online') {
      // Apply the live online-payment discount on top of the standard price.
      // Runs BEFORE voucher resolution so the voucher subtracts from the
      // already-discounted online amount. Pay-at-pickup skips this entirely
      // and is charged the standard price.
      const settingsSnap = await getFirestore().collection('settings').doc('global').get();
      const discountPct = Number(settingsSnap.exists ? settingsSnap.data().onlineDiscountPercent : 10);
      if (Number.isFinite(discountPct) && discountPct > 0 && discountPct < 100) {
        amount = Math.round(amount * (1 - discountPct / 100));
      }
    }

    // Voucher application — supports BOTH the legacy `vouchers/{uid}`
    // signup-bonus (already-issued users) AND the new `promoVouchers/{code}`
    // system (admin-created codes). Promo wins when both are submitted —
    // vouchers cannot be combined.
    //
    // Applied to BOTH online and pay-at-pickup orders. `amount` is already
    // method-correct here (online = discounted, pickup = standard), so the
    // voucher subtracts from the right base; for pickup the reduced amount is
    // what the agent collects at the lot.
    let voucherAmount = 0;
    let voucherId = null;       // legacy signup voucher id (== uid)
    let promoVoucherCode = null; // new promoVouchers code
    let promoVoucherDoc = null;  // resolved voucher details for the redemption record

    {
      // Establish caller identity once — used by both voucher paths.
      const idToken = (req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      let authedUid = null;
      if (idToken) {
        try {
          const decoded = await getAuth().verifyIdToken(idToken);
          authedUid = decoded.uid;
        } catch (err) {
          console.warn('createPayment: bad ID token, ignoring vouchers:', err?.message);
        }
      }

      // NEW path: promo voucher code.
      if (body.voucherCode) {
        const promoRes = await resolveVoucher({
          code: body.voucherCode,
          plate: cd.licensePlate,
          baseAmount: amount,
          authedUid,
          orderType,
          days: authoritativeDays,
          perDay: authoritativePerDay,
        });
        if (promoRes.ok) {
          voucherAmount = promoRes.discountAmount;
          promoVoucherCode = promoRes.voucher.code;
          promoVoucherDoc = {
            ...promoRes.voucher,
            identityKey: promoRes.identityKey,
            // Days vouchers: how many days this order consumes from the
            // identity's balance (null for fixed/percent).
            daysUsed: promoRes.daysUsed ?? null,
          };
          amount = amount - voucherAmount;
        } else {
          // The booking page previewed the code, so a refusal here means
          // it expired or got fully redeemed between preview and pay.
          // Surface clearly so the client can drop the code and retry.
          console.warn('createPayment promo voucher refused:', promoRes.error, { code: body.voucherCode, plate: cd.licensePlate });
          return res.status(400).json({ error: `voucher: ${promoRes.error}` });
        }
      }
      // LEGACY path: signup bonus (only when no promo code was applied).
      else if (body.voucherId && cd.customerId && body.voucherId === cd.customerId && authedUid && authedUid === cd.customerId) {
        try {
          const v = await getFirestore().collection('vouchers').doc(body.voucherId).get();
          if (v.exists) {
            const data = v.data();
            if (data.userId === authedUid
                && data.status === 'unused'
                && Number(data.amount) > 0
                && Number(data.amount) < amount) {  // strict <: keep amount > 0 for Netopia
              voucherAmount = Number(data.amount);
              voucherId = body.voucherId;
              amount = amount - voucherAmount;
            }
          }
        } catch (err) {
          console.warn('Voucher lookup failed (ignoring):', err);
        }
      }
    }

    // Persist pending order. The IPN callback replays it for online
    // orders; adminMarkOrderPaid replays it for pay-at-pickup orders.
    const pendingDoc = {
      orderType,
      ...body,
      amount,
      voucherId,                 // legacy signup voucher; null otherwise
      voucherAmount,             // RON discount, regardless of which voucher path
      promoVoucherCode,          // new promo voucher code; null when not used
      voucherDaysUsed: promoVoucherDoc?.daysUsed ?? null, // days vouchers: days consumed by this order
      status: 'pending',
      paymentMethod,
      paymentStatus: 'unpaid',
      paidAt: null,
      paidBy: null,
      createdAt: new Date().toISOString(),
    };

    // Atomic redemption record + counter increment for the promo voucher.
    // Done BEFORE writing the pending order so a stampede on the same code
    // can't get two requests past the duplicate-check inside resolveVoucher.
    // If the transaction throws (e.g. someone else just claimed the last
    // slot of a capped voucher), surface 409 so the customer can re-enter.
    if (promoVoucherCode && promoVoucherDoc) {
      try {
        await getFirestore().runTransaction(async (tx) => {
          const voucherRef = getFirestore().collection('promoVouchers').doc(promoVoucherCode);
          const vSnap = await tx.get(voucherRef);
          if (!vSnap.exists) throw new HttpsError('not-found', 'voucher disappeared mid-flight');
          const vData = vSnap.data();
          const isDays = promoVoucherDoc.type === 'days';

          // Race-safe usage guard — resolveVoucher already checked but a
          // concurrent createPayment from the same identity could slip.
          // Fixed/percent: one redemption per identity. Days: the
          // per-identity balance doc is read INSIDE the transaction so
          // two concurrent splits can't overdraw (doc-level locking).
          let isFirstUse = true;
          let balanceRef = null;
          let newDaysUsed = null;
          if (isDays) {
            balanceRef = getFirestore().collection('voucherDayBalances')
              .doc(`${promoVoucherCode}_${promoVoucherDoc.identityKey}`);
            const balSnap = await tx.get(balanceRef);
            const used = balSnap.exists ? Number(balSnap.data().daysUsed) || 0 : 0;
            isFirstUse = !balSnap.exists;
            const grant = Number(promoVoucherDoc.daysUsed);
            if (used + grant > Number(vData.value)) {
              throw new HttpsError('already-exists', 'voucher day balance exhausted');
            }
            newDaysUsed = used + grant;
          } else {
            const dupSnap = await getFirestore().collection('voucherRedemptions')
              .where('voucherCode', '==', promoVoucherCode)
              .where('identityKey', '==', promoVoucherDoc.identityKey)
              .limit(1)
              .get();
            if (!dupSnap.empty) throw new HttpsError('already-exists', 'voucher already redeemed by this identity');
          }

          // Total cap: counts one-shot redemptions, or distinct holders
          // for days vouchers — a returning holder splitting their
          // remaining days doesn't consume another cap slot.
          const cap = Number(vData.maxRedemptionsTotal);
          if (isFirstUse && Number.isFinite(cap) && cap > 0 && Number(vData.redeemedCount || 0) >= cap) {
            throw new HttpsError('already-exists', 'voucher fully redeemed');
          }

          if (isDays) {
            tx.set(balanceRef, {
              voucherCode: promoVoucherCode,
              identityKey: promoVoucherDoc.identityKey,
              daysUsed: newDaysUsed,
              updatedAt: new Date().toISOString(),
            });
          }

          // Days vouchers split across bookings (many redemptions per
          // identity) → auto-id, with the balance doc above as the lock.
          // Fixed/percent are one-shot per identity → deterministic id so a
          // concurrent second redemption hits tx.create's already-exists and
          // is rejected (the plain `where` query above isn't transactional).
          const redemptionRef = isDays
            ? getFirestore().collection('voucherRedemptions').doc()
            : getFirestore().collection('voucherRedemptions').doc(`${promoVoucherCode}_${promoVoucherDoc.identityKey}`);
          const redemptionData = {
            voucherCode: promoVoucherCode,
            identityKey: promoVoucherDoc.identityKey,
            userId: cd.customerId || null,
            plate: cd.licensePlate || null,
            orderId,
            bookingId: null,             // patched by IPN handler for online
            amount: voucherAmount,
            type: promoVoucherDoc.type,
            value: promoVoucherDoc.value,
            daysUsed: isDays ? Number(promoVoucherDoc.daysUsed) : null,
            redeemedAt: new Date().toISOString(),
          };
          if (isDays) tx.set(redemptionRef, redemptionData);
          else tx.create(redemptionRef, redemptionData);
          if (isFirstUse) {
            tx.update(voucherRef, { redeemedCount: (Number(vData.redeemedCount) || 0) + 1 });
          }
        });
      } catch (err) {
        console.warn('createPayment voucher redemption failed:', err?.message);
        return res.status(409).json({ error: `voucher: ${err?.message || 'redemption-failed'}` });
      }
    }

    // Free-order short-circuit: a days-type voucher can cover the WHOLE
    // amount (fixed/percent are capped at base-1, credits can never reach
    // 0). Nothing to charge online and nothing to collect at the lot, so
    // fulfil immediately regardless of the chosen method — create the booking
    // as paid (paidBy='voucher') and send the client to the confirmation
    // page. The redemption record was already written atomically above.
    if (amount <= 0) {
      if (orderType !== 'longTerm') {
        // Defensive — resolveVoucher refuses days vouchers on credits.
        console.warn('createPayment: zero amount on non-longTerm order refused', { orderId, orderType });
        return res.status(400).json({ error: 'voucher: no-discount' });
      }
      const nowIso = new Date().toISOString();
      const bookingId = await createBookingFromOrder(orderId, {
        ...body,
        paymentMethod: 'online',
        paidBy: 'voucher',
        amount: 0, // fully covered by the days voucher — nothing charged
      });
      pendingDoc.amount = 0;
      pendingDoc.status = 'paid';
      pendingDoc.paymentStatus = 'paid';
      pendingDoc.paidAt = nowIso;
      pendingDoc.paidBy = 'voucher';
      pendingDoc.bookingId = bookingId;
      await getFirestore().collection('pendingOrders').doc(orderId).set(pendingDoc);
      // Stamp the redemption with the booking it produced (best-effort —
      // the IPN handler does the same for paid-via-Netopia orders).
      try {
        const redSnap = await getFirestore().collection('voucherRedemptions')
          .where('orderId', '==', orderId).limit(1).get();
        if (!redSnap.empty) await redSnap.docs[0].ref.update({ bookingId });
      } catch (err) {
        console.warn('free-order redemption bookingId stamp failed:', err?.message);
      }
      return res.json({
        orderId,
        free: true,
        redirectUrl: `${SITE_URL}/booking/return?orderId=${orderId}`,
      });
    }

    // For pay-at-pickup longTerm bookings, create the booking doc now so
    // the customer's reservation is confirmed at the lot. Credits aren't
    // credited until cash is collected (admin flips status via the
    // adminMarkOrderPaid callable). createBookingFromOrder writes the
    // correct paymentStatus from order.paymentMethod, no override needed.
    if (paymentMethod === 'pay-at-pickup' && orderType === 'longTerm') {
      // `amount` here is the standard price (pay-at-pickup gets no discount) —
      // that's what the customer will owe at the lot.
      const bookingId = await createBookingFromOrder(orderId, { ...body, paymentMethod, amount });
      pendingDoc.bookingId = bookingId;
    }

    await getFirestore().collection('pendingOrders').doc(orderId).set(pendingDoc);

    // Pay-at-pickup short-circuit: no Netopia handoff, just tell the
    // client to navigate to the confirmation page. The return page sees
    // paymentMethod=pay-at-pickup and shows the lot-payment copy.
    if (paymentMethod === 'pay-at-pickup') {
      return res.json({
        orderId,
        paymentMethod,
        redirectUrl: `${SITE_URL}/booking/return?orderId=${orderId}`,
      });
    }

    const [firstName, ...rest] = (cd.name || 'Customer').trim().split(/\s+/);
    const lastName = rest.join(' ') || firstName;

    const xml = buildRequestXml({
      orderId,
      amount,
      currency: 'RON',
      signature: NETOPIA_SIGNATURE.value(),
      returnUrl: `${SITE_URL}/booking/return?orderId=${orderId}`,
      confirmUrl: CALLBACK_URL,
      details,
      billing: {
        first_name: firstName,
        last_name: lastName,
        email: cd.email || '',
        mobile_phone: cd.phone || '',
        address: 'N/A',
      },
    });

    const encrypted = encryptRequest(NETOPIA_PUBLIC_KEY.value(), xml);

    const env = (NETOPIA_ENV.value?.() || 'sandbox').toLowerCase();
    const action = NETOPIA_ENDPOINTS[env] || NETOPIA_ENDPOINTS.sandbox;

    return res.json({
      action,
      env_key: encrypted.env_key,
      data: encrypted.data,
      cipher: encrypted.cipher,
      iv: encrypted.iv,
      orderId,
    });
  }
);

// ── POST /netopiaCallback ────────────────────────────────────────────────
// Server-to-server IPN from Netopia. Expects form-urlencoded fields:
//   env_key, data, cipher, iv
// Responds with <crc>success</crc> or <crc error_type=... error_code=...>msg</crc>.
export const netopiaCallback = onRequest(
  {
    cors: false,
    secrets: [NETOPIA_PRIVATE_KEY],
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.set('Content-Type', 'application/xml');
      return res.status(405).send(crcError('0x01', 'method not allowed'));
    }

    const { env_key, data, cipher, iv } = req.body || {};
    if (!env_key || !data) {
      res.set('Content-Type', 'application/xml');
      return res.status(400).send(crcError('0x02', 'missing env_key or data'));
    }

    let decoded;
    try {
      decoded = await decryptIpn(NETOPIA_PRIVATE_KEY.value(), { env_key, data, cipher, iv });
    } catch (err) {
      console.error('Netopia IPN decrypt failed:', err);
      res.set('Content-Type', 'application/xml');
      return res.status(400).send(crcError('0x03', 'decrypt failed'));
    }

    // Netopia's decoded XML shape:
    //   { order: { $: {id, timestamp, type}, mobilpay: { action, customer, error, ... } } }
    const order = decoded?.order;
    const mobilpay = order?.mobilpay || {};
    const action = String(mobilpay.action || '').toLowerCase();
    const orderId = order?.$?.id;
    const errorCode = mobilpay.error?.$?.code || '0';

    res.set('Content-Type', 'application/xml');
    if (!orderId) return res.status(400).send(crcError('0x04', 'missing orderId'));

    const db = getFirestore();
    const orderRef = db.collection('pendingOrders').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return res.status(404).send(crcError('0x05', 'unknown order'));

    const pending = orderSnap.data();
    if (pending.status === 'paid') return res.status(200).send(crcSuccess()); // idempotent

    // action = 'confirmed' or 'confirmed_pending' on success, 'canceled' / 'credit' on others.
    if ((action === 'confirmed' || action === 'paid') && errorCode === '0') {
      try {
        const nowIso = new Date().toISOString();
        const isRepay = pending.paymentMethod === 'pay-at-pickup' && pending.bookingId;
        if (pending.orderType === 'longTerm') {
          // Repay path: a pay-at-pickup booking was already created at
          // order time; this IPN is the online repay coming through.
          // Update the existing booking instead of creating a duplicate.
          let bookingId = pending.bookingId;
          if (bookingId) {
            // Reserve a spot now that the booking is paid (it had none
            // because pay-at-pickup bookings don't reserve until paid).
            const bookingRef = db.collection('bookings').doc(bookingId);
            const bookingSnap = await bookingRef.get();
            const patch = {
              paymentStatus: 'paid',
              paidAt: nowIso,
              paidBy: 'netopia',
              paymentMethod: 'online',
              paymentId: orderId,
            };
            // Repay charges the online-discounted amount, but the booking was
            // pre-created (pay-at-pickup) at the STANDARD price. Reconcile the
            // booking to what was actually charged so revenue/invoicing aren't
            // overstated. `repayAmount` is stamped by repayOrder.
            const chargedNow = Number(pending.repayAmount);
            if (Number.isFinite(chargedNow) && chargedNow > 0) {
              patch.totalPrice = chargedNow;
              patch.basePrice = chargedNow;
            }
            if (bookingSnap.exists && !bookingSnap.data().spotId) {
              const spotId = await reserveAvailableSpot(bookingId);
              if (spotId) patch.spotId = spotId;
            }
            await bookingRef.update(patch);
          } else {
            bookingId = await createBookingFromOrder(orderId, pending);
          }
          await orderRef.update({
            status: 'paid',
            bookingId,
            netopiaAction: action,
            paymentMethod: 'online',
            paymentStatus: 'paid',
            paidAt: nowIso,
            paidBy: 'netopia',
            // Keep the order's amount in step with what was charged on repay.
            ...(Number.isFinite(Number(pending.repayAmount)) && Number(pending.repayAmount) > 0
              ? { amount: Number(pending.repayAmount) }
              : {}),
            repayInProgress: FieldValue.delete(),
          });
          // Stamp the promo redemption (if any) with the booking it produced —
          // online longTerm orders only reach here after payment. Mirrors the
          // free-order path; best-effort, never blocks fulfilment.
          try {
            const redSnap = await db.collection('voucherRedemptions')
              .where('orderId', '==', orderId).limit(1).get();
            if (!redSnap.empty && !redSnap.docs[0].data().bookingId) {
              await redSnap.docs[0].ref.update({ bookingId });
            }
          } catch (err) {
            console.warn('IPN redemption bookingId stamp failed:', err?.message);
          }
          // For repays, the onBookingCreated trigger already fired (with
          // paid=false). Send a fresh "payment received" email so the
          // customer gets confirmation. New bookings get this email via
          // the trigger automatically.
          if (isRepay) {
            try {
              await sendRepayPaidEmail(bookingId);
            } catch (err) {
              console.warn('repay paid-email failed (booking still updated):', err?.message);
            }
          }
        } else {
          const balanceDocId = await creditTokens({
            packId: pending.packId,
            quantity: pending.quantity,
            amount: pending.amount,
            customerData: pending.customerData,
          });
          await orderRef.update({
            status: 'paid',
            balanceDocId,
            netopiaAction: action,
            paymentStatus: 'paid',
            paidAt: nowIso,
            paidBy: 'netopia',
          });
        }
        // Consume the applied voucher (if any) — flip status to 'redeemed'.
        // Best-effort: a failure here doesn't undo the order. Idempotent
        // (a transaction guards against double-redeem on IPN retries).
        if (pending.voucherId) {
          try {
            await getFirestore().runTransaction(async (tx) => {
              const ref = getFirestore().collection('vouchers').doc(pending.voucherId);
              const snap = await tx.get(ref);
              if (snap.exists && snap.data().status === 'unused') {
                tx.update(ref, {
                  status: 'redeemed',
                  redeemedAt: new Date().toISOString(),
                  redeemedOn: orderId,
                });
              }
            });
          } catch (err) {
            console.warn('Voucher consumption failed (order still credited):', err);
          }
        }
        return res.status(200).send(crcSuccess());
      } catch (err) {
        console.error('Fulfilment failed:', err);
        return res.status(500).send(crcError('0x06', 'fulfilment failed'));
      }
    }

    // Non-success outcomes — record but still ack to stop retries.
    await orderRef.update({
      status: action || 'failed',
      netopiaErrorCode: errorCode,
      processedAt: new Date().toISOString(),
    });
    return res.status(200).send(crcSuccess());
  }
);

// ── mergeGuestData (callable) ───────────────────────────────────────────
// On signup / first login post-launch the client invokes this to reconcile
// any prior guest activity tied to the user's email:
//   - tokenBalances/plate_X   → merged into tokenBalances/{uid}, plate doc deleted
//   - tokenTransactions       → customerId stamped on those linked to the merged plates
//   - bookings                → customerId stamped on guest bookings whose contact.email matches
//
// Idempotent: a second invocation finds nothing to merge and returns zero counts.
// Safe-by-default: matches purely on email and customerId == null. We never touch
// data already linked to another user.
export const mergeGuestData = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be authenticated');
    }
    const uid = request.auth.uid;
    const email = (request.auth.token?.email || '').toLowerCase();
    if (!email) {
      return { mergedBalance: 0, mergedTransactions: 0, mergedBookings: 0 };
    }

    const db = getFirestore();

    // 1. Plate-keyed balances belonging to this email
    const balanceSnap = await db.collection('tokenBalances')
      .where('email', '==', email)
      .get();
    const guestDocs = balanceSnap.docs.filter((d) => d.id.startsWith('plate_'));

    let totalBalance = 0;
    let totalPurchased = 0;
    const allPlates = [];
    let guestPhone = '';
    let guestDisplayName = '';

    for (const doc of guestDocs) {
      const data = doc.data();
      totalBalance += Number(data.balance) || 0;
      totalPurchased += Number(data.totalPurchased) || 0;
      if (Array.isArray(data.plates)) allPlates.push(...data.plates);
      if (!guestPhone && data.phone) guestPhone = data.phone;
      if (!guestDisplayName && data.displayName) guestDisplayName = data.displayName;
    }
    const uniquePlates = [...new Set(allPlates)];

    // 2. Transfer + delete (atomic). Skip when nothing to merge.
    if (guestDocs.length > 0) {
      await db.runTransaction(async (tx) => {
        const userRef = db.collection('tokenBalances').doc(uid);
        const userSnap = await tx.get(userRef);
        if (userSnap.exists) {
          const existing = userSnap.data();
          const mergedPlates = [...new Set([...(existing.plates || []), ...uniquePlates])];
          tx.update(userRef, {
            balance: FieldValue.increment(totalBalance),
            totalPurchased: FieldValue.increment(totalPurchased),
            plates: mergedPlates,
          });
        } else {
          tx.set(userRef, {
            balance: totalBalance,
            totalPurchased,
            plates: uniquePlates,
            email,
          });
        }
        for (const doc of guestDocs) {
          tx.delete(doc.ref);
        }
      });
    }

    // 3. Stamp customerId on the merged plates' transactions (only those still null)
    let mergedTransactions = 0;
    for (const plate of uniquePlates) {
      const txnsSnap = await db.collection('tokenTransactions')
        .where('licensePlate', '==', plate)
        .get();
      const orphans = txnsSnap.docs.filter((d) => !d.data().customerId);
      if (orphans.length === 0) continue;
      const batch = db.batch();
      for (const o of orphans) {
        batch.update(o.ref, { customerId: uid });
      }
      await batch.commit();
      mergedTransactions += orphans.length;
    }

    // 4. Stamp customerId on guest bookings whose contact.email matches.
    //    Also pull phone/name out of the most recent guest booking as a
    //    fallback if the plate-keyed balances didn't carry them.
    const bookingsSnap = await db.collection('bookings')
      .where('contact.email', '==', email)
      .get();
    const guestBookings = bookingsSnap.docs.filter((d) => !d.data().customerId);
    let mergedBookings = 0;
    if (guestBookings.length > 0) {
      const batch = db.batch();
      for (const b of guestBookings) {
        batch.update(b.ref, { customerId: uid });
        const c = b.data().contact || {};
        if (!guestPhone && c.phone) guestPhone = c.phone;
        if (!guestDisplayName && c.name) guestDisplayName = c.name;
      }
      await batch.commit();
      mergedBookings = guestBookings.length;
    }

    // 5. Patch users/{uid} with merged plates as vehicles + fill in any
    //    blanks (phone, displayName) from the guest data. Existing values
    //    on the profile are preserved — we never overwrite what the user
    //    has already set.
    const userRef = db.collection('users').doc(uid);
    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      const existing = userSnap.exists ? userSnap.data() : {};
      const existingVehicles = Array.isArray(existing.vehicles) ? existing.vehicles : [];
      const existingPlates = new Set(
        existingVehicles
          .map((v) => String(v.plate || '').toUpperCase().replace(/[\s-]/g, ''))
      );
      const newVehicles = uniquePlates
        .filter((p) => !existingPlates.has(String(p).toUpperCase().replace(/[\s-]/g, '')))
        .map((p) => ({ plate: p, make: '', model: '' }));

      const patch = {};
      if (newVehicles.length > 0) {
        patch.vehicles = [...existingVehicles, ...newVehicles];
      }
      if (!existing.phone && guestPhone) patch.phone = guestPhone;
      if (!existing.displayName && guestDisplayName) patch.displayName = guestDisplayName;
      // email lives in the auth token; we don't touch users.email here.

      if (Object.keys(patch).length > 0) {
        if (userSnap.exists) {
          tx.update(userRef, patch);
        } else {
          // New users created via Google sign-in sometimes hit this branch
          // before the auth helper has materialised the users/{uid} doc.
          tx.set(userRef, { ...patch, role: 'customer', email });
        }
      }
    });

    console.log(`mergeGuestData: uid=${uid} email=${email} balance=${totalBalance} txns=${mergedTransactions} bookings=${mergedBookings} plates=${uniquePlates.length}`);
    return {
      mergedBalance: totalBalance,
      mergedTransactions,
      mergedBookings,
      mergedPlates: uniquePlates.length,
    };
  }
);

// ── Cashbook helpers ────────────────────────────────────────────────────
// One ledger row per cash payment collected at the lot. Powers /admin/cashbook
// for both the "my open day" view and the close-and-generate-report flow.
// Only CASH is recorded here — card payments are tracked on the source doc
// (booking / pendingOrder / tokenTransaction) but never reach the cashbook.
async function recordCashEntry({
  agentUid,
  amount,
  source,
  plate = null,
  payerName = null,
  bookingId = null,
  orderId = null,
  tokenBalanceDocId = null,
}) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return null;
  if (!agentUid) return null;
  const db = getFirestore();
  let agentName = agentUid;
  try {
    const snap = await db.collection('users').doc(agentUid).get();
    const d = snap.exists ? snap.data() : null;
    agentName = d?.displayName || d?.email || agentUid;
  } catch { /* fall through with uid as name */ }
  const nowIso = new Date().toISOString();
  const ref = await db.collection('cashEntries').add({
    agentUid,
    agentName,
    amount: amt,
    paidBy: 'cash',
    paidAt: nowIso,
    paidAtDay: nowIso.slice(0, 10),
    source,
    plate,
    payerName,
    bookingId,
    orderId,
    tokenBalanceDocId,
    closedAt: null,
    closedBy: null,
    closedReportId: null,
  });
  return ref.id;
}

// ── Admin auth gates ────────────────────────────────────────────────────
// Roles: admin > agent (was 'staff') > driver > customer.
// `assertStaff` is the most permissive backoffice gate — allows any role
// with admin-side access (driver included), for check-in/check-out ops.
// `assertAgent` excludes drivers — use for money-bearing ops (mark-paid,
// cashbook handover, etc.).
async function assertStaff(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be authenticated');
  }
  const uid = request.auth.uid;
  const snap = await getFirestore().collection('users').doc(uid).get();
  const role = snap.exists ? snap.data().role : null;
  if (!['admin', 'agent', 'staff', 'driver'].includes(role)) {
    throw new HttpsError('permission-denied', 'Backoffice access required');
  }
  return { uid, role };
}

async function assertAgent(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be authenticated');
  }
  const uid = request.auth.uid;
  const snap = await getFirestore().collection('users').doc(uid).get();
  const role = snap.exists ? snap.data().role : null;
  if (!['admin', 'agent', 'staff'].includes(role)) {
    throw new HttpsError('permission-denied', 'Agent or admin only');
  }
  return { uid, role };
}

// ── adminMarkOrderPaid (callable) ───────────────────────────────────────
// Admin/staff flips a pay-at-pickup pendingOrders doc to paid. Idempotent.
// For credit orders, credits the tokens at the same time. For longTerm
// orders, also creates the bookings doc if one doesn't already exist
// (the pay-at-pickup flow may persist the booking immediately or defer
// to this step — we handle both shapes).
export const adminMarkOrderPaid = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { uid } = await assertStaff(request);
    const { orderId, paidBy, payerDetails } = request.data || {};
    if (!orderId) throw new HttpsError('invalid-argument', 'Missing orderId');
    if (!['cash', 'card'].includes(paidBy)) {
      throw new HttpsError('invalid-argument', 'paidBy must be cash or card');
    }

    // payerDetails are required for cashbook reconciliation — without
    // them, fiscal audit on a cash payment is impossible. Optional only
    // for backward compat (e.g. an admin reusing an older client).
    const payer = payerDetails && typeof payerDetails === 'object' ? {
      firstName: String(payerDetails.firstName || '').trim(),
      lastName: String(payerDetails.lastName || '').trim(),
      locality: String(payerDetails.locality || '').trim(),
      address: String(payerDetails.address || '').trim(),
    } : null;

    const db = getFirestore();
    const orderRef = db.collection('pendingOrders').doc(orderId);
    const snap = await orderRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found');

    const pending = snap.data();
    if (pending.paymentStatus === 'paid' || pending.status === 'paid') {
      // Idempotent — already paid, just confirm.
      return { ok: true, alreadyPaid: true };
    }

    const nowIso = new Date().toISOString();
    const paymentMark = {
      paymentStatus: 'paid',
      paidAt: nowIso,
      paidBy: paidBy === 'cash' ? 'admin-cash' : 'admin-card',
      status: 'paid',
      collectedByUid: uid,
      ...(payer ? { payerDetails: payer } : {}),
    };

    if (pending.orderType === 'credits') {
      const docId = await creditTokens({
        packId: pending.packId,
        quantity: pending.quantity,
        amount: pending.amount,
        customerData: pending.customerData,
      });
      await orderRef.update({ ...paymentMark, balanceDocId: docId });
    } else if (pending.orderType === 'longTerm') {
      // If the booking was pre-created at order time (pay-at-pickup
      // longTerm path), flip its payment fields. Otherwise create it now.
      const bookingId = pending.bookingId || await createBookingFromOrder(orderId, pending);
      const bookingRef = db.collection('bookings').doc(bookingId);
      const bookingSnap = await bookingRef.get();
      const patch = {
        paymentStatus: 'paid',
        paidAt: nowIso,
        paidBy: paymentMark.paidBy,
        collectedByUid: uid,
      };
      // If admin captured payer details (the "Încasează acum" form), patch
      // the booking's billing field so cashbook + future invoicing have
      // a complete picture. Merge with the existing billing (e.g. PJ
      // company info captured earlier) rather than overwriting it.
      if (payer) {
        const existing = bookingSnap.exists ? (bookingSnap.data().billing || {}) : {};
        patch.billing = {
          ...existing,
          type: existing.type || 'PF',
          firstName: payer.firstName,
          lastName: payer.lastName,
          locality: payer.locality,
          address: payer.address,
        };
      }
      // The reservation is now real (payment confirmed) — reserve a spot
      // if one isn't already assigned. createBookingFromOrder skips this
      // for unpaid pay-at-pickup bookings to avoid orphaning a spot if
      // the customer never shows up.
      if (bookingSnap.exists && !bookingSnap.data().spotId) {
        const spotId = await reserveAvailableSpot(bookingId);
        if (spotId) patch.spotId = spotId;
      }
      await bookingRef.update(patch);
      await orderRef.update({ ...paymentMark, bookingId });
    } else {
      throw new HttpsError('invalid-argument', `Unknown orderType: ${pending.orderType}`);
    }

    await db.collection('auditLog').add({
      action: 'order_marked_paid',
      entityType: 'pendingOrder',
      entityId: orderId,
      actorUid: uid,
      payload: { paidBy: paymentMark.paidBy, orderType: pending.orderType },
      timestamp: nowIso,
    });

    // Cashbook ledger — only cash. Card payments stay on the order doc
    // but don't enter the cashbook (per ops requirement).
    if (paidBy === 'cash') {
      // Record what's actually collected: pending.amount is the standard
      // price minus any voucher (and is what the collect dialog shows). Using
      // totalPrice here would ignore a pay-at-pickup voucher and overstate.
      const cashAmount = Number(pending.amount) || 0;
      await recordCashEntry({
        agentUid: uid,
        amount: cashAmount,
        source: pending.orderType === 'credits' ? 'credits-markpaid' : 'longterm-markpaid',
        plate: pending.customerData?.licensePlate || null,
        payerName: payer ? `${payer.firstName} ${payer.lastName}`.trim() : (pending.customerData?.name || null),
        orderId,
        bookingId: pending.bookingId || null,
      });
    }

    return { ok: true };
  }
);

// ── adminMarkOrderUnpaid (callable) ─────────────────────────────────────
// Misclick recovery. Reverses an admin-cash/card "Mark paid" action.
// Refuses to reverse Netopia-paid orders (that's a refund, not a
// misclick). For longTerm, requires the booking to still be 'upcoming'
// (refuses reversal once the customer has been checked in). For credits,
// requires the balance to still cover the granted quantity (refuses if
// any of the granted tokens have already been used).
export const adminMarkOrderUnpaid = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { uid } = await assertStaff(request);
    const { orderId } = request.data || {};
    if (!orderId) throw new HttpsError('invalid-argument', 'Missing orderId');

    const db = getFirestore();
    const orderRef = db.collection('pendingOrders').doc(orderId);
    const snap = await orderRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found');

    const pending = snap.data();
    if (pending.paymentStatus !== 'paid') {
      // Idempotent — nothing to reverse.
      return { ok: true, alreadyUnpaid: true };
    }
    if (pending.paidBy !== 'admin-cash' && pending.paidBy !== 'admin-card') {
      throw new HttpsError(
        'failed-precondition',
        'Only cash/card admin-payments can be reversed here. Netopia payments require a refund.'
      );
    }

    const nowIso = new Date().toISOString();
    const reversalMark = {
      paymentStatus: 'unpaid',
      paidAt: null,
      paidBy: null,
      status: 'pending',
      reversedAt: nowIso,
      reversedBy: uid,
    };

    if (pending.orderType === 'longTerm') {
      const bookingId = pending.bookingId;
      if (!bookingId) {
        throw new HttpsError('failed-precondition', 'Order has no linked booking');
      }
      const bookingRef = db.collection('bookings').doc(bookingId);
      const bookingSnap = await bookingRef.get();
      if (!bookingSnap.exists) {
        throw new HttpsError('not-found', 'Booking not found');
      }
      const booking = bookingSnap.data();
      if (booking.status !== 'upcoming') {
        throw new HttpsError(
          'failed-precondition',
          'Booking has already been checked in — reversal not allowed.'
        );
      }
      // Release the reserved spot — the booking is no longer paid, so
      // the reservation isn't real anymore. Capacity map flips it back
      // to green/available.
      const reservedSpot = booking.spotId;
      await bookingRef.update({
        paymentStatus: 'unpaid',
        paidAt: null,
        paidBy: null,
        spotId: null,
      });
      if (reservedSpot) {
        try {
          const spotRef = db.collection('spots').doc(reservedSpot);
          const spotSnap = await spotRef.get();
          if (spotSnap.exists && spotSnap.data().status === 'reserved') {
            await spotRef.update({ status: 'available', currentBookingId: null });
          }
        } catch (err) {
          console.warn('adminMarkOrderUnpaid: spot release failed', err?.message);
        }
      }
      await orderRef.update(reversalMark);
    } else if (pending.orderType === 'credits') {
      const balanceDocId = pending.balanceDocId;
      const quantity = Number(pending.quantity) || 0;
      if (!balanceDocId || !quantity) {
        throw new HttpsError('failed-precondition', 'Order is missing balance info');
      }
      await db.runTransaction(async (tx) => {
        const balRef = db.collection('tokenBalances').doc(balanceDocId);
        const balSnap = await tx.get(balRef);
        if (!balSnap.exists) {
          throw new HttpsError('failed-precondition', 'Token balance no longer exists');
        }
        const current = balSnap.data();
        if ((current.balance || 0) < quantity) {
          throw new HttpsError(
            'failed-precondition',
            'Some of the granted credits have already been used — reversal not allowed.'
          );
        }
        tx.update(balRef, {
          balance: FieldValue.increment(-quantity),
          totalPurchased: FieldValue.increment(-quantity),
        });
        tx.update(orderRef, reversalMark);
      });
    } else {
      throw new HttpsError('invalid-argument', `Unknown orderType: ${pending.orderType}`);
    }

    // Reverse the cash-drawer entry that adminMarkOrderPaid created for cash
    // payments (this function is the "misclick recovery"). Only delete OPEN
    // entries — a closed/handed-over entry lives in a generated report and
    // mustn't be silently removed. Single-field query → no composite index.
    if (pending.paidBy === 'admin-cash') {
      try {
        const cashSnap = await db.collection('cashEntries').where('orderId', '==', orderId).get();
        const dels = [];
        cashSnap.forEach((d) => { if (!d.data().closedAt) dels.push(d.ref.delete()); });
        await Promise.all(dels);
      } catch (err) {
        console.warn('adminMarkOrderUnpaid: cash entry cleanup failed', err?.message);
      }
    }

    await db.collection('auditLog').add({
      action: 'order_marked_unpaid',
      entityType: 'pendingOrder',
      entityId: orderId,
      actorUid: uid,
      payload: { orderType: pending.orderType, originalPaidBy: pending.paidBy },
      timestamp: nowIso,
    });

    return { ok: true };
  }
);

// ── cancelPendingCreditOrder (callable) ─────────────────────────────────
// Customer self-cancel for an UNPAID pay-at-pickup credit-pack order.
// No money has moved yet, so this just flips the pendingOrders doc to
// `cancelled`. We refuse cancellation once the order is paid — those go
// through the regular refund flow because tokens have already been
// credited and may have been used.
//
// The owner check matches by customerId (logged-in user) OR by email on
// the customerData blob (guest who placed the order while not signed in
// and later returns).
export const cancelPendingCreditOrder = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be authenticated');
    }
    const callerUid = request.auth.uid;
    const callerEmail = (request.auth.token?.email || '').toLowerCase();
    const { orderId } = request.data || {};
    if (!orderId) throw new HttpsError('invalid-argument', 'Missing orderId');

    const db = getFirestore();
    const orderRef = db.collection('pendingOrders').doc(orderId);
    const snap = await orderRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found');
    const order = snap.data();

    // Ownership: customerId match OR email match on the customerData blob.
    // Any backoffice user (admin/agent/driver) can cancel any order.
    const cd = order.customerData || {};
    const ownsByUid = cd.customerId && cd.customerId === callerUid;
    const ownsByEmail = callerEmail && String(cd.email || '').toLowerCase() === callerEmail;
    const owns = ownsByUid || ownsByEmail;
    if (!owns) {
      const userSnap = await db.collection('users').doc(callerUid).get();
      const role = userSnap.exists ? userSnap.data().role : null;
      if (!['admin', 'agent', 'staff', 'driver'].includes(role)) {
        throw new HttpsError('permission-denied', 'Not your order');
      }
    }

    if (order.status === 'cancelled') {
      return { ok: true, alreadyCancelled: true };
    }
    if (order.orderType !== 'credits') {
      throw new HttpsError('failed-precondition', 'Only credit orders can be cancelled here');
    }
    if (order.paymentStatus === 'paid') {
      throw new HttpsError(
        'failed-precondition',
        'This order has already been paid — credits may have been issued. Contact support for a refund.'
      );
    }

    const nowIso = new Date().toISOString();
    await orderRef.update({
      status: 'cancelled',
      cancelledAt: nowIso,
      cancelledBy: callerUid,
    });

    await db.collection('auditLog').add({
      action: 'pending_order_cancelled',
      entityType: 'pendingOrder',
      entityId: orderId,
      actorUid: callerUid,
      payload: { orderType: order.orderType, bySelf: owns },
      timestamp: nowIso,
    });

    return { ok: true };
  }
);

// ── closeCashbook (callable) ────────────────────────────────────────────
// An agent (or admin) closes their open cash entries. Snapshots them into
// a `cashbookReports/{auto}` doc, then marks each cashEntry as closed so
// it doesn't appear in the open list anymore. The generated report stays
// readable for audit / printing later.
//
// Without arguments, closes the CALLER's own open cashbook (the common
// case). Admins may pass `{ agentUid }` to close another agent's day.
export const closeCashbook = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { uid: callerUid, role } = await assertStaff(request);
    const targetUid = request.data?.agentUid || callerUid;
    // Only admin can close another agent's cashbook.
    if (targetUid !== callerUid && role !== 'admin') {
      throw new HttpsError('permission-denied', 'Only admin can close another agent\'s cashbook');
    }
    // Driver role is checked-in only — they shouldn't be cashing up either.
    if (role === 'driver') {
      throw new HttpsError('permission-denied', 'Drivers do not handle cash');
    }

    const db = getFirestore();
    const open = await db.collection('cashEntries')
      .where('agentUid', '==', targetUid)
      .where('closedAt', '==', null)
      .get();

    if (open.empty) {
      throw new HttpsError('failed-precondition', 'No open cash entries to close');
    }

    const entries = open.docs.map((d) => ({ id: d.id, ...d.data() }));
    entries.sort((a, b) => String(a.paidAt || '').localeCompare(String(b.paidAt || '')));

    const totalAmount = entries.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
    const rangeFromIso = entries[0]?.paidAt || null;
    const rangeToIso = entries[entries.length - 1]?.paidAt || null;
    const agentName = entries[0]?.agentName || targetUid;

    // Pull any handovers for the matching days so the report stands on
    // its own without cross-referencing cashHandovers separately.
    const days = [...new Set(entries.map((e) => e.paidAtDay))];
    const handovers = [];
    const seenHandovers = new Set();
    for (const day of days) {
      // Match the cash OWNER (forAgentUid), not who physically recorded it —
      // an admin recording a handover on an agent's behalf sets handedBy=admin
      // but forAgentUid=agent, so a handedBy filter dropped it from the agent's
      // report. Filter in code (single-field day query, no composite index)
      // and fall back to handedBy for legacy rows without forAgentUid.
      const h = await db.collection('cashHandovers').where('day', '==', day).get();
      h.forEach((doc) => {
        const d = doc.data();
        const owner = d.forAgentUid || d.handedBy;
        if (owner === targetUid && !seenHandovers.has(doc.id)) {
          seenHandovers.add(doc.id);
          handovers.push({ id: doc.id, ...d });
        }
      });
    }

    const nowIso = new Date().toISOString();
    const reportRef = await db.collection('cashbookReports').add({
      agentUid: targetUid,
      agentName,
      generatedAt: nowIso,
      generatedBy: callerUid,
      rangeFromIso,
      rangeToIso,
      totalAmount,
      entryCount: entries.length,
      entries: entries.map((e) => ({
        cashEntryId: e.id,
        paidAt: e.paidAt,
        amount: e.amount,
        source: e.source,
        plate: e.plate || null,
        payerName: e.payerName || null,
        bookingId: e.bookingId || null,
        orderId: e.orderId || null,
      })),
      handovers,
    });

    // Flip each open entry to closed in a batched write.
    const batch = db.batch();
    for (const e of entries) {
      batch.update(db.collection('cashEntries').doc(e.id), {
        closedAt: nowIso,
        closedBy: callerUid,
        closedReportId: reportRef.id,
      });
    }
    await batch.commit();

    await db.collection('auditLog').add({
      action: 'cashbook_closed',
      entityType: 'cashbookReport',
      entityId: reportRef.id,
      actorUid: callerUid,
      payload: { targetUid, entryCount: entries.length, totalAmount },
      timestamp: nowIso,
    });

    return {
      ok: true,
      reportId: reportRef.id,
      entryCount: entries.length,
      totalAmount,
    };
  }
);

// ── recordCashHandover (callable) ───────────────────────────────────────
// Records a single staff-to-manager cash handover entry. Simple ledger —
// no approval workflow, no double-entry checks, no reversal. Per v1.1
// client decision: it's a logbook, not a finance system.
//
// Fields: day (YYYY-MM-DD), amount (RON), handedTo (manager name), notes?
// `forAgentUid` is optional — admins may record a handover on behalf of
// another agent (e.g. closing out their day for them). Defaults to the
// caller's uid otherwise. `handedBy` always records the actual actor;
// `forAgentUid` is what the cashbook UI filters on so the entry shows up
// under the right agent's section.
export const recordCashHandover = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { uid, role } = await assertStaff(request);
    const { day, amount, handedTo, notes, forAgentUid } = request.data || {};
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw new HttpsError('invalid-argument', 'day must be YYYY-MM-DD');
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new HttpsError('invalid-argument', 'amount must be positive');
    }
    if (!handedTo || !String(handedTo).trim()) {
      throw new HttpsError('invalid-argument', 'handedTo required');
    }
    let owner = uid;
    if (forAgentUid && forAgentUid !== uid) {
      if (role !== 'admin') {
        throw new HttpsError('permission-denied', 'Only admin can record a handover for another agent');
      }
      owner = String(forAgentUid);
    }
    const db = getFirestore();
    // One handover per (agent, day) — if the agent miscounted or
    // mistyped, they roll back the existing one via cancelCashHandover
    // and re-record. Server-side enforcement; the UI matches.
    const existing = await db.collection('cashHandovers')
      .where('forAgentUid', '==', owner)
      .where('day', '==', day)
      .limit(1)
      .get();
    if (!existing.empty) {
      throw new HttpsError(
        'already-exists',
        'A handover already exists for this agent on this day. Cancel it before recording a new one.'
      );
    }

    const nowIso = new Date().toISOString();
    const ref = await db.collection('cashHandovers').add({
      day,
      amount: amt,
      handedTo: String(handedTo).trim(),
      notes: String(notes || '').trim() || null,
      forAgentUid: owner,
      handedBy: uid,
      handedAt: nowIso,
    });
    await db.collection('auditLog').add({
      action: 'cash_handover',
      entityType: 'cashHandover',
      entityId: ref.id,
      actorUid: uid,
      payload: { day, amount: amt, handedTo, forAgentUid: owner },
      timestamp: nowIso,
    });
    return { ok: true, id: ref.id };
  }
);

// ── cancelCashHandover (callable) ───────────────────────────────────────
// Rollback for a mistakenly recorded handover. Permitted to the owning
// agent (matched against forAgentUid, falling back to handedBy for legacy
// rows) and to admins. The doc is hard-deleted; the action is audit-logged
// so the trail survives.
export const cancelCashHandover = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { uid, role } = await assertStaff(request);
    const { handoverId } = request.data || {};
    if (!handoverId) throw new HttpsError('invalid-argument', 'Missing handoverId');
    const db = getFirestore();
    const ref = db.collection('cashHandovers').doc(handoverId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Handover not found');
    const h = snap.data();
    const owner = h.forAgentUid || h.handedBy;
    if (owner !== uid && role !== 'admin') {
      throw new HttpsError('permission-denied', 'Not your handover');
    }
    await ref.delete();
    await db.collection('auditLog').add({
      action: 'cash_handover_cancelled',
      entityType: 'cashHandover',
      entityId: handoverId,
      actorUid: uid,
      payload: {
        forAgentUid: owner,
        day: h.day || null,
        amount: h.amount || null,
        handedTo: h.handedTo || null,
      },
      timestamp: new Date().toISOString(),
    });
    return { ok: true };
  }
);

// ── cancelBookingWithRefund (callable) ──────────────────────────────────
// Customer self-service cancellation for an upcoming long-term booking.
// Three branches keyed off paymentStatus + paidBy:
//
//   paid via Netopia          → paymentStatus 'refund-pending' (online refund
//                               is handled out-of-band by admin since
//                               Netopia's refund API isn't wired in yet).
//   paid via admin-cash/card  → paymentStatus 'refund-pending' (cash refund
//                               at the lot, surfaced in the cashbook queue).
//   unpaid (pay-at-pickup)    → no money to refund; just cancel.
//
// In every branch we flip status to 'cancelled', release the reserved spot
// (so the capacity map updates immediately), and write an audit log.
// Staff/admin may cancel any booking; customers may cancel only their own.
export const cancelBookingWithRefund = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be authenticated');
    }
    const callerUid = request.auth.uid;
    const { bookingId } = request.data || {};
    if (!bookingId) throw new HttpsError('invalid-argument', 'Missing bookingId');

    const db = getFirestore();
    const bookingRef = db.collection('bookings').doc(bookingId);
    const snap = await bookingRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Booking not found');
    const booking = snap.data();

    // Authorization: customer can cancel their own; backoffice users
    // (admin/agent) can cancel any booking. Drivers explicitly excluded
    // — paid-cancellation routes funds into the refund queue which is
    // financially sensitive (v1.7 spec).
    const ownsBooking = booking.customerId && booking.customerId === callerUid;
    if (!ownsBooking) {
      const userSnap = await db.collection('users').doc(callerUid).get();
      const role = userSnap.exists ? userSnap.data().role : null;
      if (!['admin', 'agent', 'staff'].includes(role)) {
        throw new HttpsError('permission-denied', 'Not your booking');
      }
    }

    if (booking.status === 'cancelled' || booking.status === 'no-show') {
      // Idempotent for both terminal-states.
      return { ok: true, alreadyCancelled: booking.status === 'cancelled', alreadyNoShow: booking.status === 'no-show' };
    }
    // v1.7 relaxes from upcoming-only → allow cancelling active bookings
    // too (Check-out tab + Overdue tab need this for emergency aborts).
    // Completed bookings stay locked.
    if (!['upcoming', 'active'].includes(booking.status)) {
      throw new HttpsError(
        'failed-precondition',
        `Cannot cancel a booking in status ${booking.status}`,
      );
    }

    const nowIso = new Date().toISOString();

    // v1.7 business rule: if the customer never arrived AND drop-off is
    // more than 12h in the past, this isn't a cancellation — it's a
    // no-show. Per company policy, paid no-shows forfeit the booking
    // fee, so we route to the no-show terminal state (no refund flag).
    // This mirrors the markNoShows scheduled function exactly; the
    // schedule might just not have fired yet for the current row.
    if (booking.status === 'upcoming' && (booking.dropoffAt || booking.startDate)) {
      const dropMs = new Date(booking.dropoffAt || booking.startDate).getTime();
      if (Number.isFinite(dropMs) && Date.now() > dropMs + 12 * 60 * 60 * 1000) {
        await bookingRef.update({
          status: 'no-show',
          noShowAt: nowIso,
          noShowDetectedBy: 'admin-cancel',
          spotId: null,
        });
        // Release the spot (same logic as markNoShows / the cancel path below).
        if (booking.spotId) {
          try {
            const spotRef = db.collection('spots').doc(booking.spotId);
            const spotSnap = await spotRef.get();
            if (spotSnap.exists && ['reserved', 'occupied'].includes(spotSnap.data().status)) {
              await spotRef.update({ status: 'available', currentBookingId: null });
            }
          } catch (err) {
            console.warn('cancelBookingWithRefund (no-show path) spot release failed', err?.message);
          }
        }
        await db.collection('auditLog').add({
          action: 'booking_no_show',
          entityType: 'booking',
          entityId: bookingId,
          actorUid: callerUid,
          payload: {
            triggeredBy: 'admin-cancel',
            wasPaid: booking.paymentStatus === 'paid',
            paidBy: booking.paidBy || null,
            // Explicitly note that no refund was issued for the paid case.
            refundOutcome: 'forfeited',
          },
          timestamp: nowIso,
        });
        return { ok: true, noShow: true };
      }
    }

    const paid = booking.paymentStatus === 'paid';
    const paidViaNetopia = paid && booking.paidBy === 'netopia';
    const paidViaAdmin = paid && (booking.paidBy === 'admin-cash' || booking.paidBy === 'admin-card');

    const patch = {
      status: 'cancelled',
      cancelledAt: nowIso,
      cancelledBy: callerUid,
      spotId: null,
    };
    let refundOutcome = 'none';
    if (paidViaNetopia || paidViaAdmin) {
      patch.paymentStatus = 'refund-pending';
      patch.refundRequestedAt = nowIso;
      refundOutcome = paidViaNetopia ? 'netopia-pending' : 'cash-pending';
    }
    await bookingRef.update(patch);

    // Release the spot so the capacity map flips it back to green.
    // For upcoming bookings the spot is `reserved`; for active ones it's
    // `occupied`. Both flip back to available.
    if (booking.spotId) {
      try {
        const spotRef = db.collection('spots').doc(booking.spotId);
        const spotSnap = await spotRef.get();
        if (spotSnap.exists && ['reserved', 'occupied'].includes(spotSnap.data().status)) {
          await spotRef.update({ status: 'available', currentBookingId: null });
        }
      } catch (err) {
        console.warn('cancelBookingWithRefund: spot release failed', err?.message);
      }
    }

    // For active bookings, also remove the activeCheckIns row so the
    // plate stops showing up in the "in parking now" view and another
    // car can use the same plate later if needed.
    if (booking.status === 'active' && booking.licensePlate) {
      try {
        // Must match normalizePlate exactly (strips spaces AND hyphens) or a
        // hyphenated plate's activeCheckIns row is never deleted → stale "checked in".
        const plate = normalizePlate(booking.licensePlate);
        await db.collection('activeCheckIns').doc(plate).delete().catch(() => {});
      } catch (err) {
        console.warn('cancelBookingWithRefund: activeCheckIns cleanup failed', err?.message);
      }
    }

    // Mirror the cancel onto the pendingOrders doc (admin views key off it
    // for the pay-at-pickup queue and the cashbook refund queue).
    if (booking.paymentId) {
      await db.collection('pendingOrders').doc(booking.paymentId)
        .update({
          status: 'cancelled',
          cancelledAt: nowIso,
          ...(refundOutcome !== 'none' ? { paymentStatus: 'refund-pending', refundRequestedAt: nowIso } : {}),
        })
        .catch((err) => console.warn('pendingOrders cancel mirror failed:', err?.message));
    }

    await db.collection('auditLog').add({
      action: 'booking_cancelled',
      entityType: 'booking',
      entityId: bookingId,
      actorUid: callerUid,
      payload: {
        wasPaid: paid,
        paidBy: booking.paidBy || null,
        refundOutcome,
        bySelf: ownsBooking,
      },
      timestamp: nowIso,
    });

    return { ok: true, refundOutcome };
  }
);

// ── adminMarkRefunded (callable) ────────────────────────────────────────
// Flips a booking from `paymentStatus: 'refund-pending'` to `'refunded'`
// after the admin has manually processed the refund (in Netopia admin
// panel for online payments, or cash-back at the lot for admin-cash/card
// payments). Stamps `refundedAt`, `refundedBy`, `refundedVia`, and an
// optional `refundNotes`, mirrors onto `pendingOrders`, audit-logs the
// action, and fires the customer-facing refund email via the Brevo
// trigger collection.
//
// Idempotent: if the booking is already 'refunded', returns ok without
// re-mailing.
export const adminMarkRefunded = onCall(
  { region: 'europe-west1', cors: true, secrets: [BREVO_API_KEY] },
  async (request) => {
    const { uid, role } = await assertStaff(request);
    const { bookingId, refundedVia, notes } = request.data || {};
    if (!bookingId) throw new HttpsError('invalid-argument', 'Missing bookingId');
    const allowedVia = ['netopia-panel', 'cash-returned', 'card-terminal'];
    if (!allowedVia.includes(refundedVia)) {
      throw new HttpsError('invalid-argument', `refundedVia must be one of ${allowedVia.join('|')}`);
    }

    const db = getFirestore();
    const ref = db.collection('bookings').doc(bookingId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Booking not found');
    const booking = snap.data();

    if (booking.paymentStatus === 'refunded') {
      return { ok: true, alreadyRefunded: true };
    }
    if (booking.paymentStatus !== 'refund-pending') {
      throw new HttpsError(
        'failed-precondition',
        `Only refund-pending bookings can be marked refunded — current status: ${booking.paymentStatus}`
      );
    }

    const nowIso = new Date().toISOString();
    const patch = {
      paymentStatus: 'refunded',
      refundedAt: nowIso,
      refundedBy: uid,
      refundedVia,
      refundNotes: String(notes || '').trim() || null,
    };
    await ref.update(patch);

    if (booking.paymentId) {
      await db.collection('pendingOrders').doc(booking.paymentId)
        .update({
          paymentStatus: 'refunded',
          refundedAt: nowIso,
          refundedBy: uid,
          refundedVia,
        })
        .catch((err) => console.warn('pendingOrders refund mirror failed:', err?.message));
    }

    await db.collection('auditLog').add({
      action: 'booking_refunded',
      entityType: 'booking',
      entityId: bookingId,
      actorUid: uid,
      payload: {
        refundedVia,
        amount: booking.totalPrice || null,
        paidBy: booking.paidBy || null,
        notes: patch.refundNotes,
      },
      timestamp: nowIso,
    });

    // Fire customer email. Best-effort: if it fails, the refund stands.
    try {
      await sendRefundIssuedEmail(bookingId);
    } catch (err) {
      console.warn('refund email failed (booking still marked refunded):', err?.message);
    }

    return { ok: true };
  }
);

// ── validateVoucherCode (callable) ──────────────────────────────────────
// Client-side preview of voucher eligibility. Booking pages call this
// when the user types/applies a code to surface the discount before pay.
// Stateless — no redemption, no counter increment. createPayment
// re-runs the same validation atomically when the payment is committed,
// so a successful preview here is not a binding promise.
export const validateVoucherCode = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { code, plate, baseAmount, orderType, days, perDay } = request.data || {};
    const authedUid = request.auth?.uid || null;
    // days/perDay are client-supplied here (preview only) — pay time
    // re-resolves with the server-recomputed values inside createPayment.
    const res = await resolveVoucher({ code, plate, baseAmount, authedUid, orderType, days, perDay });
    if (!res.ok) return { ok: false, error: res.error };
    return {
      ok: true,
      voucherCode: res.voucher.code,
      name: res.voucher.name,
      type: res.voucher.type,
      value: res.voucher.value,
      discountAmount: res.discountAmount,
      // Days vouchers: days this booking would consume + balance available
      // BEFORE consuming (splittable across bookings). Null otherwise.
      daysUsed: res.daysUsed ?? null,
      daysAvailable: res.daysAvailable ?? null,
    };
  }
);

// ── adminResendRefundEmail (callable) ───────────────────────────────────
// Manual re-trigger of the customer-facing refund email. Used when the
// automatic send from adminMarkRefunded failed (Brevo outage, template
// ID was missing at the time, bad recipient that the admin has since
// corrected, etc.) or when the customer claims they never received it.
// Idempotent at the customer's mailbox level — sends another copy
// regardless of prior status.
export const adminResendRefundEmail = onCall(
  { region: 'europe-west1', cors: true, secrets: [BREVO_API_KEY] },
  async (request) => {
    const { uid } = await assertStaff(request);
    const { bookingId } = request.data || {};
    if (!bookingId) throw new HttpsError('invalid-argument', 'Missing bookingId');

    const db = getFirestore();
    const ref = db.collection('bookings').doc(bookingId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Booking not found');
    const booking = snap.data();
    if (booking.paymentStatus !== 'refunded') {
      throw new HttpsError(
        'failed-precondition',
        `Only refunded bookings can resend the email — current status: ${booking.paymentStatus}`,
      );
    }

    const result = await sendRefundIssuedEmail(bookingId);
    await db.collection('auditLog').add({
      action: 'refund_email_resent',
      entityType: 'booking',
      entityId: bookingId,
      actorUid: uid,
      payload: { ok: !!result?.ok, reason: result?.reason || null, recipient: result?.recipient || null },
      timestamp: new Date().toISOString(),
    });

    if (!result?.ok) {
      throw new HttpsError('internal', `Email send failed: ${result?.reason || 'unknown'}`);
    }
    return { ok: true, recipient: result.recipient };
  }
);

// ── grantCreditsForCash (callable) ──────────────────────────────────────
// Admin/staff grants tokens directly to a plate (or registered customer)
// after collecting cash/card at the lot. No Netopia involvement. Reuses
// the same creditTokens path as the IPN callback so the resulting docs
// are shape-identical to an online purchase (with source='admin-cash').
// ── adminCreateLongtermBooking (callable) ───────────────────────────────
// Lets staff/admin record a long-term reservation paid in cash/card at
// the lot — bypasses the Netopia flow entirely. Creates a paid booking
// (status='upcoming', paymentStatus='paid', paidBy='admin-cash'|'admin-card')
// without going through pendingOrders. The bookings doc still triggers
// the booking-longterm-confirm email (paid branch).
export const adminCreateLongtermBooking = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { uid } = await assertStaff(request);
    const {
      plate, dropoffAt, pickupAt, days, totalPrice,
      payerEmail, payerName, payerPhone,
      customerId,
      paidBy = 'cash',
      brokerName,           // broker/prepaid reservations (e.g. ParkVia)
      autoCheckIn = false,  // walk-in flow: car is at the lot now
    } = request.data || {};

    if (!plate) throw new HttpsError('invalid-argument', 'Missing plate');
    if (!dropoffAt || !pickupAt) throw new HttpsError('invalid-argument', 'Missing dates');
    const d = Number(days);
    const total = Number(totalPrice);
    if (!Number.isFinite(d) || d <= 0) {
      throw new HttpsError('invalid-argument', 'days must be positive');
    }
    if (!Number.isFinite(total) || total <= 0) {
      throw new HttpsError('invalid-argument', 'totalPrice must be positive');
    }
    if (!['cash', 'card', 'broker'].includes(paidBy)) {
      throw new HttpsError('invalid-argument', 'paidBy must be cash, card or broker');
    }

    // paidBy → stored marker + booking source. Broker/prepaid reservations
    // already collected the money off-lot (ParkVia et al.), so they carry a
    // 'broker' marker (no cashbook entry) and a 'broker' source for separate
    // tracking; cash/card walk-ins keep their admin- markers.
    const storedPaidBy = paidBy === 'cash' ? 'admin-cash'
      : paidBy === 'card' ? 'admin-card'
      : 'broker';
    const bookingSource = paidBy === 'broker' ? 'broker' : 'admin';

    const db = getFirestore();
    const nowIso = new Date().toISOString();
    const bookingRef = await db.collection('bookings').add({
      code: generateBookingCode('longTerm'),
      type: 'longTerm',
      customerId: customerId || null,
      licensePlate: normalizePlate(plate),
      startDate: dropoffAt,
      endDate: pickupAt,
      dropoffAt,
      pickupAt,
      days: d,
      basePrice: total,
      latePrice: 0,
      totalPrice: total,
      status: 'upcoming',
      contact: {
        name: payerName || '',
        email: payerEmail || '',
        phone: payerPhone || '',
      },
      billing: { type: 'PF' },
      paymentId: null,
      paymentMethod: paidBy === 'broker' ? 'broker' : 'admin',
      paymentStatus: 'paid',
      paidAt: nowIso,
      paidBy: storedPaidBy,
      brokerName: paidBy === 'broker' ? (String(brokerName || '').trim() || null) : null,
      spotId: null,
      createdAt: nowIso,
      completedAt: null,
      source: bookingSource,
      createdBy: uid,
    });

    // Auto-reserve a spot — admin-created bookings are always paid, so the
    // reservation is real immediately. Surfaces as a blue tile on the
    // capacity map until check-in flips it to occupied.
    const spotId = await reserveAvailableSpot(bookingRef.id);
    if (spotId) {
      await bookingRef.update({ spotId });
    }

    await db.collection('auditLog').add({
      action: 'booking_created',
      entityType: 'booking',
      entityId: bookingRef.id,
      actorUid: uid,
      payload: { plate, days: d, totalPrice: total, paidBy, spotId, source: bookingSource, brokerName: brokerName || null },
      timestamp: nowIso,
    });

    // Cash drawer only for physically-collected cash. Card is reconciled by
    // the terminal; broker/prepaid money never touches the lot.
    if (paidBy === 'cash') {
      await recordCashEntry({
        agentUid: uid,
        amount: total,
        source: 'longterm-direct',
        plate: normalizePlate(plate),
        payerName: payerName || null,
        bookingId: bookingRef.id,
      });
    }

    // Walk-in shortcut: customer is at the gate now, flip the booking to
    // active and stamp checkinTimestamp. Spot is already assigned above
    // (reservation auto-happens for paid admin bookings), so we just need
    // to mark it occupied and write the activeCheckIns row.
    let checkedIn = false;
    if (autoCheckIn) {
      const checkinIso = new Date().toISOString();
      await bookingRef.update({
        status: 'active',
        checkinTimestamp: checkinIso,
      });
      if (spotId) {
        try {
          await db.collection('spots').doc(spotId)
            .update({ status: 'occupied', currentBookingId: bookingRef.id })
            .catch((err) => console.warn('walk-in spot occupy failed:', err?.message));
        } catch (_) { /* swallow — booking still flipped */ }
      }
      try {
        await db.collection('activeCheckIns').doc(normalizePlate(plate)).set({
          plate: normalizePlate(plate),
          bookingId: bookingRef.id,
          type: 'longTerm',
          customerId: customerId || null,
          checkinTime: checkinIso,
          checkinTimestamp: checkinIso,
          source: 'walk-in',
        });
      } catch (err) {
        console.warn('walk-in activeCheckIns write failed:', err?.message);
      }
      await db.collection('auditLog').add({
        action: 'booking_checkin',
        entityType: 'booking',
        entityId: bookingRef.id,
        actorUid: uid,
        payload: { plate: normalizePlate(plate), spotId, source: 'walk-in' },
        timestamp: checkinIso,
      });
      checkedIn = true;
    }

    return { bookingId: bookingRef.id, spotId, checkedIn };
  }
);

export const grantCreditsForCash = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { uid } = await assertStaff(request);
    const {
      plate, quantity, packId, amount,
      payerEmail, payerName, payerPhone,
      customerId,
      paidBy = 'cash',
      autoCheckIn = false,  // walk-in flow: consume one token immediately
    } = request.data || {};
    if (!plate) throw new HttpsError('invalid-argument', 'Missing plate');
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new HttpsError('invalid-argument', 'quantity must be a positive number');
    }
    if (!['cash', 'card'].includes(paidBy)) {
      throw new HttpsError('invalid-argument', 'paidBy must be cash or card');
    }

    const adminPaidBy = paidBy === 'cash' ? 'admin-cash' : 'admin-card';
    const docId = await creditTokens({
      packId: packId || null,
      quantity: qty,
      amount: Number(amount) || 0,
      customerData: {
        customerId: customerId || null,
        licensePlate: plate,
        email: payerEmail || '',
        name: payerName || '',
        phone: payerPhone || '',
      },
      source: 'admin-cash',
      paidBy: adminPaidBy,
      grantedBy: uid,
    });

    const nowIso = new Date().toISOString();
    await getFirestore().collection('auditLog').add({
      action: 'admin_credits_granted',
      entityType: 'tokenBalance',
      entityId: docId,
      actorUid: uid,
      // Coerce optionals to null — Firestore rejects `undefined`, and the
      // walk-in modal omits packId entirely (that omission was the original
      // 500: "Cannot use undefined ... in field payload.packId").
      payload: {
        plate,
        quantity: qty,
        packId: packId || null,
        paidBy,
        payerEmail: payerEmail || null,
      },
      timestamp: nowIso,
    });

    if (paidBy === 'cash') {
      await recordCashEntry({
        agentUid: uid,
        amount: Number(amount) || 0,
        source: 'credits-direct',
        plate: normalizePlate(plate),
        payerName: payerName || null,
        tokenBalanceDocId: docId,
      });
    }

    // Walk-in shortcut: customer is at the gate now. Consume one token
    // and create the activeCheckIns row in the same call so the agent
    // doesn't have to switch screens.
    let checkedIn = false;
    if (autoCheckIn) {
      const normPlate = normalizePlate(plate);
      const existingActive = await getFirestore().collection('activeCheckIns').doc(normPlate).get();
      if (!existingActive.exists) {
        // Decrement balance.
        try {
          await getFirestore().collection('tokenBalances').doc(docId)
            .update({ balance: FieldValue.increment(-1) });
        } catch (err) {
          console.warn('walk-in token decrement failed:', err?.message);
        }
        // Find the first available spot (best-effort — no spot = still allow check-in).
        let assignedSpotId = null;
        try {
          const spotsSnap = await getFirestore().collection('spots')
            .where('status', '==', 'available')
            .limit(1)
            .get();
          if (!spotsSnap.empty) assignedSpotId = spotsSnap.docs[0].id;
        } catch (err) {
          console.warn('walk-in spot lookup failed:', err?.message);
        }
        const checkinIso = new Date().toISOString();
        // Booking doc so the commuter shows on the Check-out tab + capacity map.
        const bookingId = await createCreditCheckInBooking(getFirestore(), {
          plate: normPlate,
          customerId: customerId || (docId.startsWith('plate_') ? null : docId),
          contact: { name: payerName || '', email: payerEmail || '', phone: payerPhone || '' },
          spotId: assignedSpotId,
          source: 'walk-in',
        });
        if (assignedSpotId) {
          try {
            await getFirestore().collection('spots').doc(assignedSpotId)
              .update({ status: 'occupied', currentBookingId: bookingId });
          } catch (err) { console.warn('walk-in spot occupy failed:', err?.message); }
        }
        // activeCheckIns row keyed by plate (matches client pattern).
        await getFirestore().collection('activeCheckIns').doc(normPlate).set({
          balanceDocId: docId,
          bookingId,
          licensePlate: normPlate,
          spotId: assignedSpotId,
          checkinTime: checkinIso,
          source: 'walk-in',
        });
        // Transaction row so it shows up in ledger.
        await getFirestore().collection('tokenTransactions').add({
          customerId: docId.startsWith('plate_') ? null : docId,
          licensePlate: normPlate,
          type: 'use',
          quantity: -1,
          spotId: assignedSpotId,
          bookingId,
          timestamp: checkinIso,
          source: 'walk-in',
        });
        checkedIn = true;
      }
    }

    return { ok: true, balanceDocId: docId, checkedIn };
  }
);

// Surface a credit (commuter) check-in as a `bookings` doc so it appears on
// the Check-out tab and the capacity map (the dashboard reads `bookings`,
// not `activeCheckIns`). The Check-out tab buckets commuters by their
// check-in time (they leave the day they arrive), so dates are stamped at
// "now" — no scheduled pick-up. Returns the new booking id.
async function createCreditCheckInBooking(db, { plate, customerId, contact, spotId, source }) {
  const nowIso = new Date().toISOString();
  // Commuters park for the day and must leave by 8 PM — pick-up is that day's
  // 20:00 cutoff, not the drop-off time. Falls back to now if the cutoff can't
  // be computed (never expected).
  const pickupIso = bucharestCutoffIso(nowIso, 20) || nowIso;
  const ref = await db.collection('bookings').add({
    code: generateBookingCode('credit'),
    type: 'credit',
    customerId: customerId || null,
    licensePlate: plate,
    startDate: nowIso,
    endDate: pickupIso,
    dropoffAt: nowIso,
    pickupAt: pickupIso,
    days: 1,
    basePrice: 0,
    latePrice: 0,
    totalPrice: 0,
    status: 'active',
    contact: contact || {},
    billing: { type: 'PF' },
    paymentId: null,
    paymentMethod: 'credit',
    paymentStatus: 'paid',
    paidAt: nowIso,
    paidBy: 'credit',
    checkinTimestamp: nowIso,
    spotId: spotId || null,
    createdAt: nowIso,
    completedAt: null,
    source: source || 'admin',
  });
  return ref.id;
}

// ── checkInWithCredits (callable) ───────────────────────────────────────
// Manual commuter (navetist) check-in that consumes EXISTING credits — no
// money movement, no new credits granted. Used by the walk-in flow when an
// agent/driver picks a customer who already has a balance. Mirrors the
// walk-in branch of grantCreditsForCash (spot assignment + activeCheckIns +
// `use` transaction) but deducts from the balance the customer already
// holds. Allowed for any backoffice role (drivers included) since it's a
// pure on-the-lot operation.
export const checkInWithCredits = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { uid } = await assertStaff(request);
    const { plate, customerId = null, credits = 1 } = request.data || {};
    if (!plate) throw new HttpsError('invalid-argument', 'Missing plate');
    const qty = Number(credits);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new HttpsError('invalid-argument', 'credits must be a positive integer');
    }

    const db = getFirestore();
    const normPlate = normalizePlate(plate);

    // Resolve the balance doc: prefer the registered customer's doc, then a
    // plate-keyed guest doc, then a customer doc that merely tracks this
    // plate in its `plates` array (matches the client lookupByPlate order).
    let docId = null;
    if (customerId) {
      const snap = await db.collection('tokenBalances').doc(customerId).get();
      if (snap.exists) docId = customerId;
    }
    if (!docId) {
      const plateDocId = `plate_${normPlate}`;
      const snap = await db.collection('tokenBalances').doc(plateDocId).get();
      if (snap.exists) docId = plateDocId;
    }
    if (!docId) {
      const arr = await db.collection('tokenBalances')
        .where('plates', 'array-contains', normPlate)
        .limit(1)
        .get();
      if (!arr.empty) docId = arr.docs[0].id;
    }
    if (!docId) throw new HttpsError('not-found', 'NO_BALANCE');

    // Already on the lot — refuse rather than double-charge.
    const existingActive = await db.collection('activeCheckIns').doc(normPlate).get();
    if (existingActive.exists) {
      throw new HttpsError('failed-precondition', 'ALREADY_CHECKED_IN');
    }

    // Deduct atomically so two agents can't overdraw the same balance.
    const ref = db.collection('tokenBalances').doc(docId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError('not-found', 'NO_BALANCE');
      const bal = Number(snap.data().balance || 0);
      if (bal < qty) throw new HttpsError('failed-precondition', 'INSUFFICIENT_CREDITS');
      tx.update(ref, { balance: FieldValue.increment(-qty) });
    });

    // Find the first free spot (best-effort — no spot still allows check-in).
    let assignedSpotId = null;
    try {
      const spotsSnap = await db.collection('spots')
        .where('status', '==', 'available')
        .limit(1)
        .get();
      if (!spotsSnap.empty) assignedSpotId = spotsSnap.docs[0].id;
    } catch (err) {
      console.warn('checkInWithCredits spot lookup failed:', err?.message);
    }

    const checkinIso = new Date().toISOString();
    const bookingCustomerId = customerId || (docId.startsWith('plate_') ? null : docId);
    // Contact from the balance doc (best-effort) for a friendlier check-out row.
    let contact = {};
    try {
      const bd = (await ref.get()).data() || {};
      contact = { name: bd.displayName || '', email: bd.email || '', phone: bd.phone || '' };
    } catch (_) { /* swallow */ }

    // Booking doc so the commuter shows on the Check-out tab + capacity map.
    const bookingId = await createCreditCheckInBooking(db, {
      plate: normPlate, customerId: bookingCustomerId, contact, spotId: assignedSpotId, source: 'manual',
    });
    if (assignedSpotId) {
      try {
        await db.collection('spots').doc(assignedSpotId)
          .update({ status: 'occupied', currentBookingId: bookingId });
      } catch (err) { console.warn('checkInWithCredits spot occupy failed:', err?.message); }
    }

    await db.collection('activeCheckIns').doc(normPlate).set({
      balanceDocId: docId,
      bookingId,
      licensePlate: normPlate,
      customerId: bookingCustomerId,
      spotId: assignedSpotId,
      checkinTime: checkinIso,
      source: 'manual',
    });

    await db.collection('tokenTransactions').add({
      customerId: bookingCustomerId,
      licensePlate: normPlate,
      type: 'use',
      quantity: -qty,
      spotId: assignedSpotId,
      bookingId,
      timestamp: checkinIso,
      source: 'manual',
    });

    await db.collection('auditLog').add({
      action: 'token_used',
      entityType: 'tokenBalance',
      entityId: docId,
      actorUid: uid,
      payload: { plate: normPlate, credits: qty, spotId: assignedSpotId, source: 'manual' },
      timestamp: checkinIso,
    });

    return { ok: true, balanceDocId: docId, credits: qty, spotId: assignedSpotId, bookingId, checkedIn: true };
  }
);

// ── adminChargeOverstay (callable) ──────────────────────────────────────
// Records an overstay (late-pickup) charge on a booking. The client suggests
// an amount (extra days × the booking's own daily rate) but the agent can
// edit it. Adds to the booking's latePrice, writes a `lateFee` ledger row,
// records a cash-drawer entry when paid in cash, and audit-logs. Money op →
// agent gate (drivers excluded).
export const adminChargeOverstay = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { uid } = await assertAgent(request);
    const { bookingId, amount, paidBy = 'cash' } = request.data || {};
    if (!bookingId) throw new HttpsError('invalid-argument', 'Missing bookingId');
    const amt = Math.round(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new HttpsError('invalid-argument', 'amount must be a positive number');
    }
    if (!['cash', 'card'].includes(paidBy)) {
      throw new HttpsError('invalid-argument', 'paidBy must be cash or card');
    }

    const db = getFirestore();
    const ref = db.collection('bookings').doc(bookingId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Booking not found');
    const b = snap.data();
    const nowIso = new Date().toISOString();
    const storedPaidBy = paidBy === 'cash' ? 'admin-cash' : 'admin-card';
    const newLate = (Number(b.latePrice) || 0) + amt;

    await ref.update({
      latePrice: newLate,
      overstayChargedAt: nowIso,
      overstayChargedBy: uid,
      overstayPaidBy: storedPaidBy,
    });

    // Ledger row (shows in /admin/transactions as a late-fee).
    await db.collection('tokenTransactions').add({
      customerId: b.customerId || null,
      licensePlate: b.licensePlate || null,
      bookingId,
      type: 'lateFee',
      amount: amt,
      paidBy: storedPaidBy,
      timestamp: nowIso,
      source: 'overstay',
    });

    // Cash drawer only for physically-collected cash.
    if (paidBy === 'cash') {
      await recordCashEntry({
        agentUid: uid,
        amount: amt,
        source: 'overstay',
        plate: b.licensePlate || null,
        payerName: b.contact?.name || null,
        bookingId,
      });
    }

    await db.collection('auditLog').add({
      action: 'booking_overstay_charged',
      entityType: 'booking',
      entityId: bookingId,
      actorUid: uid,
      payload: { amount: amt, paidBy, latePrice: newLate },
      timestamp: nowIso,
    });

    return { ok: true, latePrice: newLate };
  }
);

// ── requestPasswordReset (callable) ──────────────────────────────────────
// Replaces Firebase Auth's built-in password-reset email so we can use the
// branded Brevo template. Uses Admin SDK to mint the action link, then
// sends it via Brevo. Always returns ok — we never leak whether an email
// is registered (timing-safe behavior matches Firebase Auth's default).
export const requestPasswordReset = onCall(
  { region: 'europe-west1', cors: true, secrets: [BREVO_API_KEY] },
  async (request) => {
    const { email } = request.data || {};
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      throw new HttpsError('invalid-argument', 'Missing or invalid email');
    }
    try {
      const link = await getAuth().generatePasswordResetLink(email, {
        url: 'https://mangoparking.ro/',
        handleCodeInApp: false,
      });
      let displayName = '';
      let locale = 'ro';
      try {
        const userRecord = await getAuth().getUserByEmail(email);
        displayName = userRecord.displayName || '';
        const u = await getFirestore().collection('users').doc(userRecord.uid).get();
        if (u.exists) {
          const data = u.data();
          displayName = data.displayName || displayName;
          if (data.locale === 'en') locale = 'en';
        }
      } catch (err) {
        // User lookup failure — still send (the action link works on
        // its own; we just use generic copy).
      }
      const firstName = (displayName || email.split('@')[0]).split(/\s+/)[0];
      await sendBrevoEmail({
        to: email,
        name: displayName,
        templateName: 'password-reset',
        locale,
        params: {
          firstName,
          resetLink: link,
          expiresIn: locale === 'en' ? '1 hour' : '1 oră',
        },
      });
      // Alert staff — only reached when the link generated, i.e. the account
      // exists; never fires for unknown emails.
      await notifyAdminPasswordReset({ email, displayName }).catch(() => {});
    } catch (err) {
      // Swallow — never reveal whether the email exists.
      console.warn('requestPasswordReset:', err?.message);
    }
    return { ok: true };
  }
);

// ── assertAdmin: stricter than assertStaff (admin role required) ────────
async function assertAdmin(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be authenticated');
  }
  const uid = request.auth.uid;
  const snap = await getFirestore().collection('users').doc(uid).get();
  const role = snap.exists ? snap.data().role : null;
  if (role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin only');
  }
  return { uid, role };
}

// ── adminCreateUser (callable) ──────────────────────────────────────────
// Admin creates a user with email + password directly, bypassing the
// signup flow. Useful for back-office accounts (staff, ops) where the
// person has no inbox they want to reveal.
export const adminCreateUser = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { uid: actorUid } = await assertAdmin(request);
    let { email, password, displayName, role = 'customer' } = request.data || {};
    if (!email || !password) {
      throw new HttpsError('invalid-argument', 'email + password required');
    }
    // Map legacy 'staff' → 'agent' so old admin UIs keep working.
    if (role === 'staff') role = 'agent';
    if (!['customer', 'agent', 'driver', 'admin'].includes(role)) {
      throw new HttpsError('invalid-argument', `Invalid role: ${role}`);
    }
    if (String(password).length < 8) {
      throw new HttpsError('invalid-argument', 'password must be at least 8 characters');
    }

    const userRecord = await getAuth().createUser({
      email,
      password,
      displayName: displayName || email.split('@')[0],
    });

    const nowIso = new Date().toISOString();
    await getFirestore().collection('users').doc(userRecord.uid).set({
      email,
      displayName: displayName || email.split('@')[0],
      role,
      locale: 'ro',
      loyaltyPoints: 0,
      loyaltyTier: 'bronze',
      vehicles: [],
      createdAt: nowIso,
      createdBy: actorUid,
    });

    await getFirestore().collection('auditLog').add({
      action: 'admin_user_created',
      entityType: 'user',
      entityId: userRecord.uid,
      actorUid,
      payload: { email, role },
      timestamp: nowIso,
    });

    return { uid: userRecord.uid };
  }
);

// ── adminDeleteUser (callable) ──────────────────────────────────────────
// Removes a user from Firebase Auth + the users/{uid} doc. Their historical
// data (bookings, tokenTransactions, tokenBalances) is left intact — those
// reference customerId by uid and orphaning them is safer than cascading
// deletes that could disturb financial records.
//
// Safety guards: an admin cannot delete their own account; we refuse to
// delete the only remaining admin.
export const adminDeleteUser = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { uid: actorUid } = await assertAdmin(request);
    const { uid } = request.data || {};
    if (!uid) throw new HttpsError('invalid-argument', 'Missing uid');
    if (uid === actorUid) {
      throw new HttpsError('failed-precondition', 'Cannot delete your own account');
    }

    const db = getFirestore();
    const targetRef = db.collection('users').doc(uid);
    const targetSnap = await targetRef.get();
    const targetData = targetSnap.exists ? targetSnap.data() : null;

    if (targetData?.role === 'admin') {
      const admins = await db.collection('users').where('role', '==', 'admin').get();
      if (admins.size <= 1) {
        throw new HttpsError('failed-precondition', 'Cannot delete the last admin');
      }
    }

    try {
      await getAuth().deleteUser(uid);
    } catch (err) {
      // Orphaned Firestore doc (no matching Auth user) — continue.
      console.warn('adminDeleteUser: Auth deleteUser:', err?.message);
    }
    if (targetSnap.exists) await targetRef.delete();

    await db.collection('auditLog').add({
      action: 'admin_user_deleted',
      entityType: 'user',
      entityId: uid,
      actorUid,
      payload: { email: targetData?.email || null, role: targetData?.role || null },
      timestamp: new Date().toISOString(),
    });

    return { ok: true };
  }
);

// ── adminChangeUserRole (callable) ──────────────────────────────────────
// Admin updates the role on another user's profile. Allowed values:
// 'admin' | 'agent' | 'driver' | 'customer'. The legacy 'staff' value is
// silently mapped to 'agent' if a client somehow sends it.
//
// Refuses to demote the last admin (otherwise the org could lock itself
// out) and refuses to change the caller's own role (use a second admin
// for that — defense against accidental self-demotion).
export const adminChangeUserRole = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const { uid: actorUid } = await assertAdmin(request);
    const { uid, role: requestedRole } = request.data || {};
    if (!uid) throw new HttpsError('invalid-argument', 'Missing uid');
    if (uid === actorUid) {
      throw new HttpsError('failed-precondition', 'Cannot change your own role');
    }
    let role = String(requestedRole || '').trim();
    if (role === 'staff') role = 'agent';
    if (!['admin', 'agent', 'driver', 'customer'].includes(role)) {
      throw new HttpsError('invalid-argument', `Invalid role: ${role}`);
    }

    const db = getFirestore();
    const targetRef = db.collection('users').doc(uid);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) throw new HttpsError('not-found', 'User not found');
    const targetData = targetSnap.data();
    const previousRole = targetData.role || 'customer';
    if (previousRole === role) {
      return { ok: true, unchanged: true };
    }

    // Last-admin guard: demoting the only admin would lock the org out.
    if (previousRole === 'admin' && role !== 'admin') {
      const admins = await db.collection('users').where('role', '==', 'admin').get();
      if (admins.size <= 1) {
        throw new HttpsError('failed-precondition', 'Cannot demote the last admin');
      }
    }

    await targetRef.update({ role });
    await db.collection('auditLog').add({
      action: 'admin_user_role_changed',
      entityType: 'user',
      entityId: uid,
      actorUid,
      payload: { from: previousRole, to: role, email: targetData.email || null },
      timestamp: new Date().toISOString(),
    });

    return { ok: true, role };
  }
);

// ── adminSendInvite (callable) ──────────────────────────────────────────
// Admin sends a magic-link signup invite. The recipient clicks the link
// in their inbox, lands on /auth/finish-signup, sets a password, and is
// signed in.
export const adminSendInvite = onCall(
  { region: 'europe-west1', cors: true, secrets: [BREVO_API_KEY] },
  async (request) => {
    const { uid: actorUid } = await assertAdmin(request);
    let { email, displayName, role = 'customer', locale = 'ro' } = request.data || {};
    if (!email || !email.includes('@')) {
      throw new HttpsError('invalid-argument', 'valid email required');
    }
    if (role === 'staff') role = 'agent';
    if (!['customer', 'agent', 'driver', 'admin'].includes(role)) {
      throw new HttpsError('invalid-argument', `Invalid role: ${role}`);
    }

    const link = await getAuth().generateSignInWithEmailLink(email, {
      url: `${SITE_URL}/auth/finish-signup?email=${encodeURIComponent(email)}`,
      handleCodeInApp: true,
    });

    // Stash the assigned role so finish-signup can read it after the
    // magic-link auth completes (no good way to pass it through the link
    // body itself).
    await getFirestore().collection('pendingInvites').doc(email.toLowerCase()).set({
      email,
      displayName: displayName || '',
      role,
      invitedBy: actorUid,
      invitedAt: new Date().toISOString(),
      locale,
    });

    // Resolve the inviter's display name for the email greeting — falls
    // back to a generic "Mango Parking admin" when the profile is sparse.
    let invitedByName = 'Mango Parking';
    try {
      const inviterSnap = await getFirestore().collection('users').doc(actorUid).get();
      if (inviterSnap.exists) {
        const data = inviterSnap.data();
        invitedByName = data.displayName || data.email || invitedByName;
      }
    } catch (_) { /* swallow — email still useful without the name */ }

    const firstName = (displayName || email.split('@')[0]).split(/\s+/)[0];
    await sendBrevoEmail({
      to: email,
      name: displayName || '',
      templateName: 'admin-invite',
      locale: locale === 'en' ? 'en' : 'ro',
      params: {
        firstName,
        signupLink: link,
        invitedByName,
        role,
      },
    });

    await getFirestore().collection('auditLog').add({
      action: 'admin_invite_sent',
      entityType: 'invite',
      entityId: email.toLowerCase(),
      actorUid,
      payload: { email, role },
      timestamp: new Date().toISOString(),
    });

    return { ok: true };
  }
);

// ── finishInviteSignup (callable) ───────────────────────────────────────
// Called by the /auth/finish-signup page after the user completes the
// magic-link auth handshake. Stamps users/{uid} with the role + display
// name captured at invite time, then deletes the pendingInvites doc.
// Idempotent — running twice is harmless.
export const finishInviteSignup = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be authenticated');
    }
    const uid = request.auth.uid;
    const email = (request.auth.token?.email || '').toLowerCase();
    if (!email) return { ok: false, reason: 'no-email' };

    const db = getFirestore();
    const inviteRef = db.collection('pendingInvites').doc(email);
    const inviteSnap = await inviteRef.get();
    const invite = inviteSnap.exists ? inviteSnap.data() : null;

    const role = invite?.role || 'customer';
    const displayName = invite?.displayName || email.split('@')[0];
    const nowIso = new Date().toISOString();

    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    if (userSnap.exists) {
      // Only patch role if the doc was a default-customer placeholder.
      const data = userSnap.data();
      const patch = {};
      if (!data.role || data.role === 'customer') patch.role = role;
      if (!data.displayName && displayName) patch.displayName = displayName;
      if (Object.keys(patch).length > 0) await userRef.update(patch);
    } else {
      await userRef.set({
        email,
        displayName,
        role,
        locale: invite?.locale === 'en' ? 'en' : 'ro',
        loyaltyPoints: 0,
        loyaltyTier: 'bronze',
        vehicles: [],
        createdAt: nowIso,
        createdBy: invite?.invitedBy || null,
      });
    }

    if (inviteSnap.exists) {
      await inviteRef.delete();
    }

    return { ok: true, role };
  }
);

// ── repayOrder (HTTP) ────────────────────────────────────────────────────
// Customer-facing self-service repay for a pay-at-pickup order. Looks up
// the existing pendingOrders doc, validates it's still unpaid + pay-at-
// pickup, recomputes the discounted online amount, and returns a fresh
// Netopia handoff envelope. Reuses the same orderId so the IPN routes the
// confirmation to the existing booking (the IPN handler now updates an
// existing bookingId rather than creating a duplicate).
//
// No auth required — the orderId itself is the secret (delivered via the
// confirmation email).
export const repayOrder = onRequest(
  {
    cors: true,
    secrets: [NETOPIA_SIGNATURE, NETOPIA_PUBLIC_KEY, NETOPIA_ENV],
  },
  async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('Method not allowed');
    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

    const db = getFirestore();
    const orderRef = db.collection('pendingOrders').doc(orderId);
    const snap = await orderRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'Order not found' });
    const pending = snap.data();

    if (pending.paymentStatus === 'paid' || pending.status === 'paid') {
      return res.status(409).json({ error: 'already_paid' });
    }
    if (pending.paymentMethod !== 'pay-at-pickup') {
      return res.status(400).json({ error: 'not_repayable' });
    }

    // pending.amount is the STANDARD (on-site) price. Apply the live
    // online-discount percent to land on the online price the customer pays
    // now by choosing to pay online instead of at the lot.
    const settingsSnap = await db.collection('settings').doc('global').get();
    const discountPct = Number(settingsSnap.exists ? settingsSnap.data().onlineDiscountPercent : 10);
    let amount = Number(pending.amount);
    if (Number.isFinite(discountPct) && discountPct > 0 && discountPct < 100) {
      amount = Math.round(amount * (1 - discountPct / 100));
    }
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'bad_amount' });
    }

    const cd = pending.customerData || {};
    const details = pending.orderType === 'longTerm'
      ? `Mango Parking — parcare pe termen lung (${pending.days} zile)`
      : `Mango Parking — pachet ${pending.quantity} credite`;

    const [firstName, ...rest] = (cd.name || 'Customer').trim().split(/\s+/);
    const lastName = rest.join(' ') || firstName;

    const xml = buildRequestXml({
      orderId,
      amount,
      currency: 'RON',
      signature: NETOPIA_SIGNATURE.value(),
      returnUrl: `${SITE_URL}/booking/return?orderId=${orderId}`,
      confirmUrl: CALLBACK_URL,
      details,
      billing: {
        first_name: firstName,
        last_name: lastName,
        email: cd.email || '',
        mobile_phone: cd.phone || '',
        address: 'N/A',
      },
    });

    const encrypted = encryptRequest(NETOPIA_PUBLIC_KEY.value(), xml);
    const env = (NETOPIA_ENV.value?.() || 'sandbox').toLowerCase();
    const action = NETOPIA_ENDPOINTS[env] || NETOPIA_ENDPOINTS.sandbox;

    // Stamp `repayInProgress` so the IPN knows this confirmation is a
    // repay (and should patch the existing booking instead of creating a
    // new one). Do NOT flip paymentMethod yet — only on IPN success.
    // Abandoned repays leave the order in its original pay-at-pickup state.
    await orderRef.update({
      repayInProgress: true,
      repayAmount: amount,
      repayStartedAt: new Date().toISOString(),
    });

    return res.json({
      action,
      env_key: encrypted.env_key,
      data: encrypted.data,
      cipher: encrypted.cipher,
      iv: encrypted.iv,
      orderId,
    });
  }
);
