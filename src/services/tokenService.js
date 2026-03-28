import { addDocument, getCollection, getDocument, updateDocument, setDocument, removeDocument, incrementField, query, where, orderBy, limit } from '../firebase/db.js';
import { getCurrentUser } from '../firebase/auth.js';
import { auditLog } from './auditService.js';
import { getAllSpots, updateSpotStatus } from './capacityService.js';

function normalizePlate(plate) {
  return plate.toUpperCase().replace(/[\s-]/g, '');
}

function balanceDocId(customerData) {
  return customerData.customerId || `plate_${normalizePlate(customerData.licensePlate)}`;
}

// ── Public / Customer ──

export async function getTokenPacks() {
  const all = await getCollection('tokenPacks');
  return all.filter(p => p.active !== false).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export async function getBalance(customerId) {
  return getDocument('tokenBalances', customerId);
}

export async function getBalanceByPlate(licensePlate) {
  return getDocument('tokenBalances', `plate_${normalizePlate(licensePlate)}`);
}

export async function purchaseTokens(packId, quantity, customerData) {
  const docId = balanceDocId(customerData);
  const plate = normalizePlate(customerData.licensePlate);

  // Check if balance doc exists
  const existing = await getDocument('tokenBalances', docId);
  if (existing) {
    await incrementField('tokenBalances', docId, 'balance', quantity);
    await incrementField('tokenBalances', docId, 'totalPurchased', quantity);
    // Add plate if not already tracked
    if (!existing.plates?.includes(plate)) {
      const plates = [...(existing.plates || []), plate];
      await updateDocument('tokenBalances', docId, { plates });
    }
  } else {
    await setDocument('tokenBalances', docId, {
      balance: quantity,
      totalPurchased: quantity,
      plates: [plate],
      email: customerData.email || '',
      displayName: customerData.name || '',
      phone: customerData.phone || '',
    });
  }

  // Log transaction
  await addDocument('tokenTransactions', {
    customerId: customerData.customerId || null,
    licensePlate: plate,
    type: 'purchase',
    quantity,
    packId: packId || null,
    timestamp: new Date().toISOString(),
  });

  await auditLog('token_purchase', 'tokenBalance', docId, null, { quantity, packId }).catch(() => {});

  const updated = await getDocument('tokenBalances', docId);
  return { balanceDocId: docId, balance: updated?.balance || quantity };
}

export async function getTransactions(customerId, limitCount = 50) {
  return getCollection('tokenTransactions', where('customerId', '==', customerId), orderBy('timestamp', 'desc'), limit(limitCount));
}

// ── Admin / Staff ──

export async function lookupByPlate(licensePlate) {
  const plate = normalizePlate(licensePlate);
  // Try array-contains on customer balances
  const results = await getCollection('tokenBalances', where('plates', 'array-contains', plate));
  if (results.length > 0) return results[0];
  // Fallback to plate-keyed doc
  return getBalanceByPlate(licensePlate);
}

export async function isCheckedIn(licensePlate) {
  const plate = normalizePlate(licensePlate);
  const doc = await getDocument('activeCheckIns', plate);
  return !!doc;
}

export async function useToken(balanceDocId, licensePlate) {
  const plate = normalizePlate(licensePlate);

  // Prevent double check-in
  const alreadyIn = await getDocument('activeCheckIns', plate);
  if (alreadyIn) throw new Error('ALREADY_CHECKED_IN');

  const doc = await getDocument('tokenBalances', balanceDocId);
  if (!doc || doc.balance < 1) throw new Error('Insufficient token balance');

  // Find first available spot
  const spots = await getAllSpots().catch(() => []);
  const availableSpot = spots.find(s => s.status === 'available');
  const spotId = availableSpot?.id || null;

  await incrementField('tokenBalances', balanceDocId, 'balance', -1);

  // Mark spot as occupied (also updates global occupiedSpots counter)
  if (spotId) {
    await updateSpotStatus(spotId, 'occupied');
  } else {
    // No spots in system — update counter directly, ensure doc exists
    const settings = await getDocument('settings', 'global');
    if (settings) {
      await incrementField('settings', 'global', 'occupiedSpots', 1);
    } else {
      await setDocument('settings', 'global', { totalCapacity: 110, occupiedSpots: 1 });
    }
  }

  // Mark as checked in with assigned spot
  await setDocument('activeCheckIns', plate, {
    balanceDocId,
    licensePlate: plate,
    spotId,
    checkinTime: new Date().toISOString(),
  });

  await addDocument('tokenTransactions', {
    customerId: balanceDocId.startsWith('plate_') ? null : balanceDocId,
    licensePlate: plate,
    type: 'use',
    quantity: -1,
    spotId,
    timestamp: new Date().toISOString(),
  });

  await auditLog('token_used', 'tokenBalance', balanceDocId, { balance: doc.balance }, { balance: doc.balance - 1, spotId });
}

export async function checkOut(licensePlate) {
  const plate = normalizePlate(licensePlate);

  // Get active check-in to find assigned spot
  const checkInDoc = await getDocument('activeCheckIns', plate);
  const spotId = checkInDoc?.spotId || null;

  // Free the spot (also updates global occupiedSpots counter)
  if (spotId) {
    await updateSpotStatus(spotId, 'available');
  } else {
    // No spot assigned — update counter directly
    const settings = await getDocument('settings', 'global');
    if (settings && (settings.occupiedSpots || 0) > 0) {
      await incrementField('settings', 'global', 'occupiedSpots', -1);
    }
  }

  // Remove active check-in
  await removeDocument('activeCheckIns', plate).catch(() => {});

  await addDocument('tokenTransactions', {
    customerId: null,
    licensePlate: plate,
    type: 'checkout',
    quantity: 0,
    spotId,
    timestamp: new Date().toISOString(),
  });

  await auditLog('token_checkout', 'tokenBalance', null, null, { licensePlate: plate, spotId }).catch(() => {});
}

export async function refundToken(balanceDocId, quantity) {
  await incrementField('tokenBalances', balanceDocId, 'balance', quantity);

  await addDocument('tokenTransactions', {
    customerId: balanceDocId.startsWith('plate_') ? null : balanceDocId,
    licensePlate: null,
    type: 'refund',
    quantity,
    timestamp: new Date().toISOString(),
  });

  await auditLog('token_refund', 'tokenBalance', balanceDocId, null, { quantity });
}

export async function getAllRecentTransactions(limitCount = 100) {
  return getCollection('tokenTransactions', orderBy('timestamp', 'desc'), limit(limitCount));
}

// ── Admin CRUD for token packs ──

export async function getAllTokenPacks() {
  const all = await getCollection('tokenPacks');
  return all.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export async function createTokenPack(data) {
  const id = await addDocument('tokenPacks', data);
  await auditLog('token_pack_created', 'tokenPack', id, null, data);
  return id;
}

export async function updateTokenPack(packId, data) {
  await updateDocument('tokenPacks', packId, data);
  await auditLog('token_pack_updated', 'tokenPack', packId, null, data);
}

export async function deleteTokenPack(packId) {
  await removeDocument('tokenPacks', packId);
  await auditLog('token_pack_deleted', 'tokenPack', packId, null, {});
}
