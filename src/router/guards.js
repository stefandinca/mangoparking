import { getCurrentUser, getUserProfile } from '../firebase/auth.js';
import { getLocale, localePath } from '../i18n/index.js';

/**
 * Check if user passes all guards for a route
 * Returns null if allowed, or a redirect path if blocked
 */
export function checkGuards(guards) {
  if (!guards || guards.length === 0) return null;

  const user = getCurrentUser();
  const profile = getUserProfile();

  if (guards.includes('auth') && !user) {
    return localePath('/login');
  }

  if (guards.includes('admin')) {
    if (!profile || (profile.role !== 'admin' && profile.role !== 'staff')) {
      return localePath('/');
    }
  }

  return null;
}
