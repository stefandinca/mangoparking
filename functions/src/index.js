// Mango Parking Cloud Functions — Netopia payment bridge.
// Flow:
//   1. Client → POST createPayment  → returns Netopia hosted-page redirect URL
//   2. User pays on Netopia → Netopia → POST netopiaCallback (server-to-server)
//      → verify signature → credit tokens via creditTokens()
//   3. Client redirected back to /booking?status=success
//
// Both endpoints are stubbed until Netopia merchant credentials land.
// Replace the `// TODO(netopia)` blocks with real API calls per Netopia docs.

import { onRequest } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';

initializeApp();
setGlobalOptions({ region: 'europe-west1', maxInstances: 10 });

const NETOPIA_SIGNATURE = defineSecret('NETOPIA_SIGNATURE');
const NETOPIA_API_KEY = defineSecret('NETOPIA_API_KEY');

const SITE_URL = process.env.SITE_URL || 'https://mangoparking.ro';

function normalizePlate(plate) {
  return String(plate || '').toUpperCase().replace(/[\s-]/g, '');
}

function balanceDocId({ customerId, licensePlate }) {
  return customerId || `plate_${normalizePlate(licensePlate)}`;
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
  });

  return docId;
}

// ── POST /createPayment ──────────────────────────────────────────────────
// Body (credits funnel):   { orderType: 'credits', packId, quantity, customerData }
// Body (long-term funnel): { orderType: 'longTerm', startDate, endDate, days,
//                             totalPrice, customerData }
// customerData: { customerId?, licensePlate, name, email, phone }
// Returns: { redirectUrl, orderId }
export const createPayment = onRequest(
  { cors: true, secrets: [NETOPIA_API_KEY] },
  async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('Method not allowed');

    const body = req.body || {};
    const orderType = body.orderType || 'credits';
    if (!body.customerData?.licensePlate) {
      return res.status(400).json({ error: 'Missing licensePlate' });
    }
    if (orderType === 'credits' && (!body.packId || !body.quantity)) {
      return res.status(400).json({ error: 'credits order requires packId + quantity' });
    }
    if (orderType === 'longTerm' && (!body.days || !body.totalPrice)) {
      return res.status(400).json({ error: 'longTerm order requires days + totalPrice' });
    }

    const orderId = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Persist pending order so the callback can look it up by orderId
    await getFirestore().collection('pendingOrders').doc(orderId).set({
      orderType,
      ...body,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    // TODO(netopia): Call Netopia Mobilpay API to create payment session.
    // Docs: https://doc.mobilpay.ro/
    // const netopia = await fetch('https://secure.mobilpay.ro/...', { ... });
    // const { paymentUrl } = await netopia.json();

    const redirectUrl = `${SITE_URL}/booking?status=success&orderId=${orderId}`; // stub
    return res.json({ redirectUrl, orderId });
  }
);

// ── POST /netopiaCallback ────────────────────────────────────────────────
// Server-to-server callback from Netopia after payment. Must verify signature.
// Body: Netopia-signed payload (IPN). On success → credit tokens + mark order paid.
export const netopiaCallback = onRequest(
  { cors: false, secrets: [NETOPIA_SIGNATURE, NETOPIA_API_KEY] },
  async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('Method not allowed');

    // TODO(netopia): Verify HMAC signature using NETOPIA_SIGNATURE.value() before trusting body.
    // const valid = verifyNetopiaSignature(req.rawBody, req.headers['x-netopia-signature'], NETOPIA_SIGNATURE.value());
    // if (!valid) return res.status(401).send('Invalid signature');

    const { orderId, status } = req.body || {};
    if (!orderId) return res.status(400).send('Missing orderId');

    const db = getFirestore();
    const orderRef = db.collection('pendingOrders').doc(orderId);
    const order = (await orderRef.get()).data();
    if (!order) return res.status(404).send('Order not found');
    if (order.status === 'paid') return res.status(200).send('Already processed');

    if (status === 'confirmed' || status === 'paid') {
      if (order.orderType === 'longTerm') {
        // Create a bookings/{id} doc mirroring the client's createLongTermBooking
        const bookingRef = await db.collection('bookings').add({
          type: 'longTerm',
          customerId: order.customerData.customerId || null,
          licensePlate: String(order.customerData.licensePlate || '').toUpperCase().replace(/[\s-]/g, ''),
          startDate: order.startDate,
          endDate: order.endDate,
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
          paymentId: orderId,
          createdAt: new Date().toISOString(),
          completedAt: null,
          source: 'web',
        });
        await orderRef.update({ status: 'paid', bookingId: bookingRef.id, paidAt: new Date().toISOString() });
        return res.status(200).send('OK');
      }

      // default: credits funnel
      const balanceDocId = await creditTokens({
        packId: order.packId,
        quantity: order.quantity,
        customerData: order.customerData,
      });
      await orderRef.update({ status: 'paid', balanceDocId, paidAt: new Date().toISOString() });
      return res.status(200).send('OK');
    }

    await orderRef.update({ status: status || 'failed', processedAt: new Date().toISOString() });
    return res.status(200).send('OK');
  }
);
