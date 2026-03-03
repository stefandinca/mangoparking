import { getCollection, updateDocument, query, where, orderBy } from '../firebase/db.js';
import { getCurrentUser } from '../firebase/auth.js';
import { auditLog } from './auditService.js';

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
export async function getAllSubscriptions() {
  return getCollection('subscriptions', orderBy('createdAt', 'desc'));
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
