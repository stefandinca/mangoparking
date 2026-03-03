import { addDocument } from '../firebase/db.js';
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
