import { addDocument, getCollection, orderBy, limit } from '../firebase/db.js';
import { getCurrentUser } from '../firebase/auth.js';

/**
 * Log an audit entry
 */
export async function auditLog(action, entityType, entityId, oldValue, newValue) {
  const user = getCurrentUser();
  return addDocument('auditLog', {
    action,
    entityType,
    entityId,
    oldValue: oldValue || null,
    newValue: newValue || null,
    userId: user?.uid || 'anonymous',
    userEmail: user?.email || 'anonymous',
    timestamp: new Date().toISOString(),
  });
}

/**
 * Get audit log entries
 */
export async function getAuditLog(limitCount = 50) {
  try {
    const entries = await getCollection('auditLog', orderBy('timestamp', 'desc'), limit(limitCount));
    return entries.map(e => ({
      id: e.id,
      timestamp: e.timestamp,
      action: e.action,
      entityType: e.entityType || '',
      entityId: e.entityId || '',
      entity: (e.entityType || '') + ' ' + (e.entityId || ''),
      user: e.userEmail || e.userId || 'unknown',
      oldValueObj: e.oldValue || null,
      newValueObj: e.newValue || e.payload || null,
      details: e.oldValue && e.newValue
        ? JSON.stringify(e.oldValue) + ' → ' + JSON.stringify(e.newValue)
        : e.newValue ? JSON.stringify(e.newValue) : '',
    }));
  } catch {
    return [];
  }
}
