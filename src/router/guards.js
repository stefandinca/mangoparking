import { getCurrentUser, getUserProfile } from '../firebase/auth.js';
import { getLocale, localePath } from '../i18n/index.js';
import { hasPermission, hasAdminAccess } from '../utils/permissions.js';

/**
 * Check if user passes all guards for a route.
 * Returns null if allowed, or a redirect path if blocked.
 *
 * Supported guards:
 *   'auth'         — must be signed in
 *   'admin'        — must have any admin-side access (admin / agent / driver)
 *   'perm:<name>'  — must have the named permission (see utils/permissions.js)
 */
export function checkGuards(guards) {
  if (!guards || guards.length === 0) return null;

  const user = getCurrentUser();
  const profile = getUserProfile();

  if (guards.includes('auth') && !user) {
    return localePath('/login');
  }

  if (guards.includes('admin')) {
    if (!profile || !hasAdminAccess(profile.role)) {
      return localePath('/');
    }
  }

  for (const g of guards) {
    if (typeof g === 'string' && g.startsWith('perm:')) {
      const perm = g.slice(5);
      if (!profile || !hasPermission(profile.role, perm)) {
        // Bounce role-mismatched users to the dashboard rather than home —
        // they DO have admin access, just not for this specific section.
        return localePath(hasAdminAccess(profile?.role) ? '/admin' : '/');
      }
    }
  }

  return null;
}
