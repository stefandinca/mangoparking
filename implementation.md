# Mango Parking — Implementation Plan

## Context

We have two approved HTML design mockups (Frost theme, RO + EN) and a comprehensive Brief.md. This plan converts those static prototypes into a fully functional SPA with Firebase backend, covering all Phase 1 requirements: 7 public pages, customer account (5 sub-pages), admin panel (7 sub-pages), i18n, auth, real-time data, and SEO.

**Key decisions made:**
- Vanilla JS SPA (no framework), Vite + TailwindCSS
- Path-prefix i18n routing (`/en/booking`, `/ro/booking` or just `/booking` for RO default)
- Firebase Hosting configured from the start
- Design: Frost glassmorphic theme (Space Grotesk, DM Sans, JetBrains Mono, charcoal `#2D4A47`)

---

## Project Structure

```
mangoparking/
├── public/
│   ├── favicon.ico
│   ├── robots.txt
│   ├── sitemap.xml
│   └── images/
├── src/
│   ├── main.js                    # Entry: init router, Firebase, i18n
│   ├── style.css                  # Tailwind directives + Frost custom CSS
│   ├── router/
│   │   ├── index.js               # History API router with locale parsing
│   │   ├── routes.js              # Route definitions (lazy imports)
│   │   └── guards.js              # Auth + role guards
│   ├── i18n/
│   │   ├── index.js               # t() function, setLocale, localePath helper
│   │   ├── ro.js                  # Romanian strings (default)
│   │   └── en.js                  # English strings
│   ├── firebase/
│   │   ├── config.js              # Firebase app init (env vars)
│   │   ├── auth.js                # Login, logout, onAuthChange, user profile
│   │   ├── db.js                  # Firestore CRUD helpers + listeners
│   │   └── storage.js             # Photo upload (Firebase Storage)
│   ├── components/
│   │   ├── core/                  # Navbar, Footer, Button, Card, Modal, Toast, Loader, FormField
│   │   ├── widgets/               # CapacityWidget, ShuttleWidget, PriceCalc, DateRangePicker, FaqAccordion, ReviewCarousel, LanguageSwitcher
│   │   └── admin/                 # AdminLayout, DataTable, SpotGrid, StatCard, ChartWrapper, PhotoUpload
│   ├── pages/
│   │   ├── public/                # Home, Booking, Pricing, Shuttle, Commuter, About, Contact
│   │   ├── account/               # Dashboard, BookingHistory, Subscription, Vehicles, Loyalty
│   │   ├── admin/                 # AdminDashboard, AdminBookings, AdminCapacity, AdminPricing, AdminShuttle, AdminReports, AdminAudit
│   │   └── auth/                  # Login, Register
│   ├── services/                  # bookingService, capacityService, pricingService, shuttleService, subscriptionService, loyaltyService, auditService, contactService
│   └── utils/                     # dom.js, date.js, validators.js, seo.js, constants.js
├── index.html                     # SPA shell
├── 404.html                       # Firebase fallback
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── firebase.json                  # Hosting with SPA rewrites
├── .firebaserc
├── firestore.rules
├── firestore.indexes.json
├── storage.rules
├── package.json
├── .env.local                     # Firebase keys (gitignored)
└── .gitignore
```

---

## Architecture

### Router
- History API based, parses locale prefix from URL (`/en/...` = English, anything else = Romanian)
- Strips prefix before matching against route definitions
- Each route has a lazy `component: () => import(...)` for code-splitting
- Guards array per route (`['auth']`, `['auth', 'admin']`)
- After render: injects SEO meta tags, fires `app-rendered` event for pre-renderer

### Component System
- Factory functions returning DOM elements (no classes needed for simple components)
- `html` tagged template literal helper creates elements from strings
- Stateful widgets use `onSnapshot` listeners with MutationObserver cleanup
- Pages compose layout (Navbar/Footer) + child components, mount interactive widgets into placeholder divs

### i18n
- `t('home.hero.title')` nested key lookup with `{param}` interpolation
- `localePath('/booking')` returns `/booking` for RO or `/en/booking` for EN
- Language switcher navigates to same path with swapped prefix

### Auth
- Firebase Auth (Google + email/password)
- User profile stored in Firestore `users/{uid}` with `role` field
- Route guards check `getCurrentUser()` and redirect to login if needed
- Firestore security rules enforce role-based access server-side

---

## Firestore Data Model

| Collection | Key Fields | Access |
|---|---|---|
| `settings/global` | totalCapacity, occupiedSpots | Public read, admin write |
| `pricingTiers/{id}` | type, minDays, maxDays, pricePerDay, order | Public read, admin write |
| `addOns/{id}` | name, price, type (one_time/per_day) | Public read, admin write |
| `bookings/{id}` | code, type, status, customerId, dates, vehicle, spotId, photos, checkin/out timestamps | Customer reads own, staff/admin read all |
| `subscriptions/{id}` | customerId, status, licensePlate, startDate, monthlyRate | Customer reads own, admin read/write |
| `spots/{id}` (A-01...) | zone, number, status, currentBookingId | Public read, staff/admin write |
| `shuttleSchedule/{id}` | route, departureTime, dayOfWeek, status | Public read, staff/admin write |
| `trainSchedule/{id}` | direction, departureTime (mock data) | Public read |
| `users/{uid}` | role, loyaltyPoints, loyaltyTier, vehicles[] | Self read/write (except role), admin write |
| `auditLog/{id}` | action, entityType, entityId, oldValue, newValue, userId, timestamp | Staff/admin read, append-only write |
| `contactMessages/{id}` | name, email, subject, message, status | Public create, admin read |
| `reviews/{id}` | rating, textRo, textEn, customerType (mock) | Public read |

---

## SEO Approach

- **Pre-rendering** at build time using `vite-plugin-prerender` for all 7 public pages (RO + EN = 14 static HTML files)
- Account/admin pages NOT pre-rendered (auth-gated, not crawlable)
- Schema.org structured data (ParkingFacility + LocalBusiness) on Home page
- Per-route meta tags, Open Graph, hreflang injected by `seo.js`
- `robots.txt` disallows `/account/`, `/admin/`, `/login`, `/register`
- `sitemap.xml` lists all public pages in both languages

---

## Implementation Milestones

### M0: Project Scaffolding
- `npm create vite@latest`, install Tailwind/PostCSS/autoprefixer
- Extract Frost theme CSS from mockup into `src/style.css`
- Configure `tailwind.config.js` with theme colors/fonts
- Create Firebase project, enable Auth + Firestore + Hosting + Storage
- `.env.local` with Firebase config, `firebase init`, `firebase.json` with SPA rewrites
- Create full folder structure, write `src/utils/dom.js` helpers
- Deploy blank page to Firebase Hosting to verify pipeline

### M1: Router + i18n + Layout Shell
- Build router with history API, locale parsing, lazy loading, guard system
- Build i18n runtime + RO/EN locale files (nav/footer strings first)
- Build Navbar + Footer + LanguageSwitcher from mockup HTML
- Wire all routes with placeholder pages
- **Verify:** nav links work, URL changes, language toggle switches prefix

### M2: Home Page
- Decompose `design-a-frost-ro.html` into components: Hero, HowItWorks, PricingPreview, Amenities, ShuttlePreview, Reviews, FAQ, Gallery, CTA
- Build CapacityWidget, ShuttleWidget, FaqAccordion, ReviewCarousel (mock data initially)
- Move all strings from both mockups into `ro.js` / `en.js`
- SEO: structured data, meta tags

### M3: Firebase Backend + Auth
- Seed Firestore: settings, pricingTiers, addOns, 110 spots, shuttle schedule, mock reviews
- Write Firestore security rules + Storage rules
- Build auth system (Google + email/password login/register)
- Build route guards
- Wire CapacityWidget + ShuttleWidget to real-time Firestore listeners

### M4: Booking Flow
- Build DateRangePicker (or integrate flatpickr)
- Build PriceCalc (reads tiers from Firestore, real-time calculation)
- Build Booking page: traveler flow (dates, vehicle, contact, summary, confirm)
- Build commuter subscription tab
- bookingService + subscriptionService + auditService (logs booking creation)
- Booking confirmation screen with code

### M5: Remaining Public Pages
- Pricing page (reads from Firestore, tiered table + add-ons)
- Shuttle page (full timetable, train/flight mock data, auto-refresh)
- Commuter landing page
- About page (story, security, amenities, photos)
- Contact page (form → `contactMessages`, Google Maps embed)

### M6: Customer Account
- AccountLayout (sidebar/mobile nav)
- Dashboard (active booking, next shuttle, quick re-book)
- BookingHistory (customer's bookings from Firestore)
- Subscription management (view/cancel/pause)
- Vehicles CRUD
- Loyalty (points, tiers, "Where's My Car?" widget)

### M7: Admin Panel
- AdminLayout (sidebar nav)
- DataTable component (reusable, sortable, filterable)
- AdminDashboard (today's stats, capacity alerts, quick actions)
- AdminBookings (table, filters, search, check-in/out, photo upload)
- AdminCapacity (visual spot grid, status toggles)
- AdminPricing (edit tiers/add-ons, audit trail)
- AdminShuttle (edit schedule, mark departed/delayed)
- AdminReports (Chart.js charts, CSV export)
- AdminAudit (filterable log viewer)

### M8: SEO, Polish, Deploy
- Pre-render public pages (14 static HTML files)
- sitemap.xml, robots.txt, hreflang tags
- Mobile testing, Lighthouse audit
- Final deploy to Firebase Hosting

---

## Verification

- **Router:** Navigate all routes, verify lazy loading (network tab), language switching, back/forward
- **Auth:** Login with Google, login with email, register, route guards redirect, admin-only routes blocked for customers
- **Booking flow:** Create traveler booking end-to-end, verify Firestore document, verify booking code displays, verify audit log entry
- **Real-time:** Open two tabs, change capacity in admin → see widget update on home page
- **i18n:** Switch language on every page, verify all strings change, verify URL prefix changes
- **SEO:** Run Lighthouse, verify structured data with Google's Rich Results Test, check pre-rendered HTML source
- **Admin:** Check-in/out a booking, upload photos, edit pricing (verify public page updates), export CSV
- **Mobile:** Test all pages on 375px viewport, verify touch targets, date pickers

---

## Source Files

- `design-a-frost-ro.html` — Ground truth for all visual patterns, glassmorphism, spacing, typography (RO)
- `design-a-frost.html` — EN version confirming two-language parity
- `Brief.md` — Full spec for all pages, features, data model, SEO, i18n
