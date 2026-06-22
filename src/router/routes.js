export const routes = [
  // Public pages
  {
    path: '/',
    component: () => import('../pages/public/Home.js'),
    guards: [],
  },
  {
    path: '/booking',
    component: () => import('../pages/public/Booking.js'),
    guards: [],
  },
  {
    path: '/booking/credits',
    component: () => import('../pages/public/BookingCredits.js'),
    guards: [],
  },
  {
    path: '/booking/long-term',
    component: () => import('../pages/public/BookingLongTerm.js'),
    guards: [],
  },
  {
    path: '/booking/return',
    component: () => import('../pages/public/BookingReturn.js'),
    guards: [],
  },
  {
    path: '/pay',
    component: () => import('../pages/public/PayOrder.js'),
    guards: [],
  },
  {
    path: '/pricing',
    component: () => import('../pages/public/Pricing.js'),
    guards: [],
  },
  {
    path: '/shuttle',
    component: () => import('../pages/public/Shuttle.js'),
    guards: [],
  },
  // MVP: hidden
  // {
  //   path: '/commuter',
  //   component: () => import('../pages/public/Commuter.js'),
  //   guards: [],
  // },
  {
    path: '/about',
    component: () => import('../pages/public/About.js'),
    guards: [],
  },
  {
    path: '/contact',
    component: () => import('../pages/public/Contact.js'),
    guards: [],
  },
  {
    path: '/promotions',
    component: () => import('../pages/public/Promotions.js'),
    guards: [],
  },

  // Legal pages (required for Netopia / ANPC compliance)
  {
    path: '/terms',
    component: () => import('../pages/public/Terms.js'),
    guards: [],
  },
  {
    path: '/privacy',
    component: () => import('../pages/public/Privacy.js'),
    guards: [],
  },
  {
    path: '/gdpr',
    component: () => import('../pages/public/GDPR.js'),
    guards: [],
  },
  {
    path: '/delivery',
    component: () => import('../pages/public/Delivery.js'),
    guards: [],
  },
  {
    path: '/cancellation',
    component: () => import('../pages/public/Cancellation.js'),
    guards: [],
  },

  // Auth pages
  {
    path: '/login',
    component: () => import('../pages/auth/Login.js'),
    guards: [],
  },
  {
    path: '/register',
    component: () => import('../pages/auth/Register.js'),
    guards: [],
  },
  {
    path: '/auth/finish-signup',
    component: () => import('../pages/auth/FinishSignup.js'),
    guards: [],
  },

  // Customer account
  {
    path: '/account',
    component: () => import('../pages/account/Dashboard.js'),
    guards: ['auth'],
  },
  {
    path: '/account/bookings',
    component: () => import('../pages/account/BookingHistory.js'),
    guards: ['auth'],
  },
  {
    path: '/account/vouchers',
    component: () => import('../pages/account/Vouchers.js'),
    guards: ['auth'],
  },
  // MVP: hidden
  // {
  //   path: '/account/subscription',
  //   component: () => import('../pages/account/Subscription.js'),
  //   guards: ['auth'],
  // },
  {
    path: '/account/vehicles',
    component: () => import('../pages/account/Vehicles.js'),
    guards: ['auth'],
  },
  // MVP: hidden
  // {
  //   path: '/account/loyalty',
  //   component: () => import('../pages/account/Loyalty.js'),
  //   guards: ['auth'],
  // },

  // Admin panel — per-route permissions filter what each role can reach.
  // See src/utils/permissions.js for the role→permission map.
  {
    path: '/admin',
    component: () => import('../pages/admin/AdminDashboard.js'),
    guards: ['auth', 'admin', 'perm:dashboard'],
  },
  {
    path: '/admin/checkins',
    component: () => import('../pages/admin/AdminCheckIns.js'),
    guards: ['auth', 'admin', 'perm:checkins'],
  },
  {
    path: '/admin/transactions',
    component: () => import('../pages/admin/AdminTransactions.js'),
    guards: ['auth', 'admin', 'perm:transactions'],
  },
  {
    path: '/admin/cashbook',
    component: () => import('../pages/admin/AdminCashbook.js'),
    guards: ['auth', 'admin', 'perm:cashbook'],
  },
  {
    path: '/admin/refunds',
    component: () => import('../pages/admin/AdminRefunds.js'),
    guards: ['auth', 'admin', 'perm:refunds'],
  },
  {
    path: '/admin/vouchers',
    component: () => import('../pages/admin/AdminVouchers.js'),
    guards: ['auth', 'admin', 'perm:vouchers'],
  },
  {
    path: '/admin/promotions',
    component: () => import('../pages/admin/AdminPromotions.js'),
    guards: ['auth', 'admin', 'perm:promotions'],
  },
  {
    path: '/admin/legal',
    component: () => import('../pages/admin/AdminLegal.js'),
    guards: ['auth', 'admin', 'perm:legal'],
  },
  {
    path: '/admin/capacity',
    component: () => import('../pages/admin/AdminCapacity.js'),
    guards: ['auth', 'admin', 'perm:capacity'],
  },
  {
    path: '/admin/pricing',
    component: () => import('../pages/admin/AdminPricing.js'),
    guards: ['auth', 'admin', 'perm:pricing'],
  },
  {
    path: '/admin/shuttle',
    component: () => import('../pages/admin/AdminShuttle.js'),
    guards: ['auth', 'admin', 'perm:shuttle'],
  },
  {
    path: '/admin/reviews',
    component: () => import('../pages/admin/AdminReviews.js'),
    guards: ['auth', 'admin', 'perm:reviews'],
  },
  {
    path: '/admin/users',
    component: () => import('../pages/admin/AdminUsers.js'),
    guards: ['auth', 'admin', 'perm:users'],
  },
  {
    path: '/admin/website',
    component: () => import('../pages/admin/AdminWebsite.js'),
    guards: ['auth', 'admin', 'perm:website'],
  },
  {
    path: '/admin/help',
    component: () => import('../pages/admin/AdminHelp.js'),
    guards: ['auth', 'admin', 'perm:help'],
  },
  // MVP: hidden
  // {
  //   path: '/admin/reports',
  //   component: () => import('../pages/admin/AdminReports.js'),
  //   guards: ['auth', 'admin'],
  // },
  // {
  //   path: '/admin/audit',
  //   component: () => import('../pages/admin/AdminAudit.js'),
  //   guards: ['auth', 'admin'],
  // },
];
