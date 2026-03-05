import { addDocument, getCollection, updateDocument, query, where, orderBy, limit } from '../firebase/db.js';
import { getCurrentUser } from '../firebase/auth.js';
import { auditLog } from './auditService.js';

/**
 * Generate a subscription code (MNG-XXXXX)
 */
function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = 'MNG-';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/**
 * Create a commuter subscription
 */
export async function createSubscription(data) {
  const user = getCurrentUser();
  const code = generateCode();
  const sub = {
    code,
    customerId: user?.uid || null,
    customerName: data.name,
    customerPhone: data.phone,
    customerEmail: data.email,
    status: 'active',
    licensePlate: data.licensePlate,
    makeModel: data.makeModel || '',
    startDate: data.startMonth,
    monthlyRate: data.monthlyRate,
  };
  const id = await addDocument('subscriptions', sub);
  await auditLog('subscription_created', 'subscription', id, null, { code });
  return { id, code };
}

/**
 * Get subscriptions for the current user
 */
export async function getMySubscriptions() {
  const user = getCurrentUser();
  if (!user) return [];
  return getCollection('subscriptions', where('customerId', '==', user.uid), orderBy('createdAt', 'desc'));
}

/**
 * Get all subscriptions (admin)
 */
export async function getAllSubscriptions(limitCount = 200) {
  return getCollection('subscriptions', orderBy('createdAt', 'desc'), limit(limitCount));
}

/**
 * Cancel a subscription
 */
export async function cancelSubscription(subId) {
  await updateDocument('subscriptions', subId, { status: 'cancelled' });
  await auditLog('subscription_cancelled', 'subscription', subId, { status: 'active' }, { status: 'cancelled' });
}

/**
 * Pause a subscription
 */
export async function pauseSubscription(subId) {
  await updateDocument('subscriptions', subId, { status: 'paused' });
  await auditLog('subscription_paused', 'subscription', subId, { status: 'active' }, { status: 'paused' });
}
