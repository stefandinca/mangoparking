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
import { defineSecret } from 'firebase-functions/params';
import {
  NETOPIA_ENDPOINTS,
  encryptRequest,
  decryptIpn,
  buildRequestXml,
  crcSuccess,
  crcError,
} from './netopia.js';

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

async function creditTokens({ packId, quantity, customerData }) {
  const db = getFirestore();
  const docId = balanceDocId(customerData);
  const plate = normalizePlate(customerData.licensePlate);
  const ref = db.collection('tokenBalances').doc(docId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const data = snap.data();
      const plates = data.plates?.includes(plate) ? data.plates : [...(data.plates || []), plate];
      tx.update(ref, {
        balance: FieldValue.increment(quantity),
        totalPurchased: FieldValue.increment(quantity),
        plates,
      });
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
    packId: packId || null,
    timestamp: new Date().toISOString(),
    source: 'netopia',
    billing: customerData.billing || { type: 'PF' },
  });

  return docId;
}

async function createBookingFromOrder(orderId, order) {
  const db = getFirestore();
  const nowIso = new Date().toISOString();
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
    basePrice: order.totalPrice,
    latePrice: 0,
    totalPrice: order.totalPrice,
    status: 'upcoming',
    contact: {
      name: order.customerData.name || '',
      email: order.customerData.email || '',
      phone: order.customerData.phone || '',
    },
    billing: order.customerData.billing || { type: 'PF' },
    paymentId: orderId,
    paymentMethod: order.paymentMethod || 'online',
    paymentStatus: 'paid',
    paidAt: nowIso,
    paidBy: 'netopia',
    createdAt: nowIso,
    completedAt: null,
    source: 'web',
  });
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

    // Compute amount (RON) per funnel.
    let amount;
    let details;
    if (orderType === 'longTerm') {
      amount = body.totalPrice;
      details = `Mango Parking — parcare pe termen lung (${body.days} zile)`;
    } else {
      amount = Number(body.packPrice || body.totalPrice || 0);
      details = `Mango Parking — pachet ${body.quantity} credite`;
    }
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Missing or invalid amount' });
    }

    // Voucher application — only honored for authenticated customers; voucher
    // doc ID equals the user's uid. Reject silently (don't apply) if anything
    // is off; the IPN consumption code is the source of truth and re-checks.
    let voucherAmount = 0;
    let voucherId = null;
    if (body.voucherId && cd.customerId && body.voucherId === cd.customerId) {
      try {
        const v = await getFirestore().collection('vouchers').doc(body.voucherId).get();
        if (v.exists) {
          const data = v.data();
          if (data.userId === cd.customerId
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

    // Persist pending order so the IPN callback can replay it by orderId.
    // paymentMethod defaults to 'online' for the existing Netopia path; the
    // pay-at-pickup branch (Phase D) flips this to 'pay-at-pickup' and skips
    // the Netopia handoff entirely.
    await getFirestore().collection('pendingOrders').doc(orderId).set({
      orderType,
      ...body,
      amount,
      voucherId,           // null when no voucher applied
      voucherAmount,       // 0 when no voucher applied
      status: 'pending',
      paymentMethod: body.paymentMethod || 'online',
      paymentStatus: 'unpaid',
      paidAt: null,
      paidBy: null,
      createdAt: new Date().toISOString(),
    });

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
        if (pending.orderType === 'longTerm') {
          const bookingId = await createBookingFromOrder(orderId, pending);
          await orderRef.update({
            status: 'paid',
            bookingId,
            netopiaAction: action,
            paymentStatus: 'paid',
            paidAt: nowIso,
            paidBy: 'netopia',
          });
        } else {
          const balanceDocId = await creditTokens({
            packId: pending.packId,
            quantity: pending.quantity,
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
