// Role-based permissions. One source of truth shared by route guards,
// the admin sidebar, and (where applicable) Firestore rule logic.
//
// Roles:
//   admin    — full access. Sees and edits everything, including the
//              configuration surfaces (pricing, users, legal, vouchers,
//              promotions).
//   agent    — backoffice operations (renamed from "staff"). Sees the
//              day-to-day surfaces — dashboard, activity, check-ins,
//              transactions, cashbook, capacity, shuttle, refunds, help —
//              but NOT the configuration surfaces, and NOT reviews (reviews
//              moved under the admin-only Website hub). Cannot change prices.
//   driver   — shuttle driver at the lot. Sees dashboard, activity,
//              check-ins (the reservations view, where they perform
//              check-in / check-out), capacity, shuttle, and help.
//   customer — no admin access.
//
// Legacy `role: 'staff'` docs are treated as `agent` for backwards
// compatibility — no migration needed.

export const ROLE_ADMIN = 'admin';
export const ROLE_AGENT = 'agent';
export const ROLE_DRIVER = 'driver';
export const ROLE_CUSTOMER = 'customer';

export const ALL_ROLES = [ROLE_ADMIN, ROLE_AGENT, ROLE_DRIVER, ROLE_CUSTOMER];

// Permission identifiers — match the corresponding admin section.
export const PERM = Object.freeze({
  DASHBOARD:    'dashboard',
  ACTIVITY:     'activity',
  CHECKINS:     'checkins',
  TRANSACTIONS: 'transactions',
  CASHBOOK:     'cashbook',
  CAPACITY:     'capacity',
  PRICING:      'pricing',
  SHUTTLE:      'shuttle',
  REVIEWS:      'reviews',
  USERS:        'users',
  LEGAL:        'legal',
  REFUNDS:      'refunds',
  VOUCHERS:     'vouchers',
  PROMOTIONS:   'promotions',
  WEBSITE:      'website',
  HELP:         'help',
  AUDIT:        'audit',
});

const ROLE_PERMISSIONS = {
  [ROLE_ADMIN]:    Object.values(PERM),
  [ROLE_AGENT]:    [
    PERM.DASHBOARD, PERM.ACTIVITY, PERM.CHECKINS, PERM.TRANSACTIONS, PERM.CASHBOOK,
    PERM.CAPACITY, PERM.SHUTTLE, PERM.REFUNDS, PERM.HELP, PERM.AUDIT,
    // Intentionally excluded: PRICING, USERS, LEGAL, VOUCHERS, PROMOTIONS,
    // REVIEWS, WEBSITE — agents see ops, not configuration / public-site
    // content (reviews moved under the admin-only Public website section).
    // Firestore rules also gate writes to settings docs to isAdmin() so even
    // direct API access fails.
    // AUDIT is included: every admin-access role already sees the same feed
    // (shortened) on its dashboard, and firestore.rules lets any isStaff()
    // read auditLog — restricting the page would be cosmetic only.
  ],
  [ROLE_DRIVER]:   [PERM.DASHBOARD, PERM.ACTIVITY, PERM.CHECKINS, PERM.CAPACITY, PERM.SHUTTLE, PERM.HELP, PERM.AUDIT],
  [ROLE_CUSTOMER]: [],
};

// Normalize legacy 'staff' to 'agent' so old docs keep working.
export function normalizeRole(role) {
  if (role === 'staff') return ROLE_AGENT;
  if (ALL_ROLES.includes(role)) return role;
  return ROLE_CUSTOMER;
}

export function rolePermissions(role) {
  return ROLE_PERMISSIONS[normalizeRole(role)] || [];
}

export function hasPermission(role, perm) {
  return rolePermissions(role).includes(perm);
}

// Any admin-side section access — used to gate the /admin/* base route.
export function hasAdminAccess(role) {
  return rolePermissions(role).length > 0;
}
