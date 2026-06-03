// Role-based permissions. One source of truth shared by route guards,
// the admin sidebar, and (where applicable) Firestore rule logic.
//
// Roles:
//   admin    — full access. Sees and edits everything, including the
//              configuration surfaces (pricing, users, legal, vouchers,
//              promotions).
//   agent    — backoffice operations (renamed from "staff"). Sees every
//              day-to-day surface — dashboard, check-ins, transactions,
//              cashbook, capacity, shuttle, reviews, refunds — but NOT
//              the configuration surfaces. Cannot change prices.
//   driver   — shuttle driver at the lot. Sees dashboard, check-ins
//              (the reservations view, where they perform check-in /
//              check-out), capacity, and shuttle.
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
});

const ROLE_PERMISSIONS = {
  [ROLE_ADMIN]:    Object.values(PERM),
  [ROLE_AGENT]:    [
    PERM.DASHBOARD, PERM.CHECKINS, PERM.TRANSACTIONS, PERM.CASHBOOK,
    PERM.CAPACITY, PERM.SHUTTLE, PERM.REVIEWS, PERM.REFUNDS,
    // Intentionally excluded: PRICING, USERS, LEGAL, VOUCHERS, PROMOTIONS
    // — agents see ops, not configuration. Firestore rules also gate
    // writes to settings docs to isAdmin() so even direct API access fails.
  ],
  [ROLE_DRIVER]:   [PERM.DASHBOARD, PERM.CHECKINS, PERM.CAPACITY, PERM.SHUTTLE],
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
