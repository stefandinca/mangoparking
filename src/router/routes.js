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

  // Admin panel
  {
    path: '/admin',
    component: () => import('../pages/admin/AdminDashboard.js'),
    guards: ['auth', 'admin'],
  },
  {
    path: '/admin/bookings',
    component: () => import('../pages/admin/AdminBookings.js'),
    guards: ['auth', 'admin'],
  },
  {
    path: '/admin/capacity',
    component: () => import('../pages/admin/AdminCapacity.js'),
    guards: ['auth', 'admin'],
  },
  {
    path: '/admin/pricing',
    component: () => import('../pages/admin/AdminPricing.js'),
    guards: ['auth', 'admin'],
  },
  {
    path: '/admin/shuttle',
    component: () => import('../pages/admin/AdminShuttle.js'),
    guards: ['auth', 'admin'],
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
