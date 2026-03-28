# Mango Parking — MVP Brief
## Daily Travel Token Parking — Otopeni Airport

---

## 1. Project Overview

Mango Parking is a parking facility near Henri Coandă International Airport (Otopeni), Romania. The MVP operates on a **Daily Travel Token** system — customers buy tokens online and use them to park on any weekday.

**Token Model**
- 1 token = 1 day of parking (Mon–Fri, 6 AM – 8 PM)
- Tokens are sold in admin-configurable packs (e.g. 5, 10, 20 tokens)
- Tokens are flexible — not tied to specific dates, never expire
- Validation at the lot: staff looks up license plate → sees token balance → deducts 1 token

**Customer Segments**
- **Guest customers** — buy tokens without creating an account (guest checkout)
- **Registered customers** — create account for saved vehicles, profile, and purchase history
- **Admin/Staff** — manage token packs, look up plates, use/refund tokens, manage capacity and shuttle

---

## 2. Tech Stack

- **Frontend**: Vanilla JS SPA, Vite 7, TailwindCSS 4 (PostCSS)
- **Backend**: Firebase (Auth, Firestore, Storage, Hosting)
- **Fonts**: Space Grotesk (headings), DM Sans (body), JetBrains Mono (mono)
- **Colors**: Mango #F28C28, Charcoal #2D4A47, Leaf #34D399, Frost #F0F2F5
- **i18n**: Romanian (default) + English, locale prefix routing (/en/...)
- **Deployment**: Plesk (mangoparking.ro), Firestore rules/indexes via Firebase CLI
- **Payments**: Netopia (integration pending — currently stubbed)

---

## 3. Architecture

```
src/
├── router/          — History API router, locale prefix, route guards
├── i18n/            — t() function, ro.js & en.js locale files
├── firebase/        — config, auth (Google + email), db helpers, storage
├── components/
│   ├── core/        — Navbar, Footer, Toast, Modal
│   ├── widgets/     — icons.js (shared SVG strings)
│   ├── account/     — AccountLayout (sidebar + mobile nav)
│   └── admin/       — AdminLayout (dark sidebar + mobile nav)
├── pages/
│   ├── public/      — Home, Booking (token purchase), Pricing, Shuttle, About, Contact
│   ├── auth/        — Login, Register
│   ├── account/     — Dashboard, Token History, Vehicles
│   └── admin/       — Dashboard, Token Management, Token Packs, Capacity, Shuttle
├── services/        — tokenService, capacityService, shuttleService, auditService, contactService
└── utils/           — dom.js (html tagged template), date, validators, seo, constants
```

**Key Patterns**
- Pages export `default function(container)` — receive DOM node, mount content
- Components are factory functions returning DOM elements via `html` tagged template
- Route guards: `['auth']` or `['auth', 'admin']` per route definition
- Firestore data with client-side filtering/sorting for small collections

---

## 4. Pages — MVP Scope

### Public Pages
| Page | Route | Purpose |
|------|-------|---------|
| Home | `/` | Landing page — hero, how-it-works, pricing preview, shuttle, reviews, FAQ |
| Booking | `/booking` | Token purchase flow — select pack, vehicle, contact, pay (stubbed) |
| Pricing | `/pricing` | Token pack cards with "how tokens work" explainer |
| Shuttle | `/shuttle` | Public shuttle schedule (parking ↔ airport ↔ train station) |
| About | `/about` | Company story, security features, amenities |
| Contact | `/contact` | Contact form + info |

### Auth Pages
| Page | Route | Purpose |
|------|-------|---------|
| Login | `/login` | Email/password + Google OAuth sign-in |
| Register | `/register` | Account creation |

### Account Pages (auth required)
| Page | Route | Purpose |
|------|-------|---------|
| Dashboard | `/account` | Profile (editable), token balance, recent transactions, shuttle |
| Token History | `/account/bookings` | Full transaction list with type filters |
| Vehicles | `/account/vehicles` | Add/remove vehicles (persisted to Firestore) |

### Admin Pages (auth + admin required)
| Page | Route | Purpose |
|------|-------|---------|
| Dashboard | `/admin` | Capacity stats, tokens used/purchased today, quick actions, recent activity |
| Token Management | `/admin/bookings` | License plate search → customer balance → use/refund tokens |
| Token Packs | `/admin/pricing` | CRUD for token packs (name EN/RO, quantity, price, active, sort order) |
| Capacity | `/admin/capacity` | Visual spot grid (4 zones), click to cycle status |
| Shuttle | `/admin/shuttle` | Manage shuttle departures and schedule |

### Hidden (code preserved, routes removed)
- Commuter subscription page + service
- Loyalty/points page + service
- Admin Reports page
- Admin Audit Log page

---

## 5. Firestore Collections

| Collection | Purpose | Access |
|-----------|---------|--------|
| `tokenPacks` | Admin-managed purchasable packs | Public read, admin write |
| `tokenBalances/{id}` | Token balance per customer or plate | Owner/plate read+write, staff full |
| `tokenTransactions` | Append-only transaction log | Owner read own, staff read all |
| `users/{uid}` | User profiles (name, email, phone, role, vehicles) | Owner read+write (no role change), staff read |
| `settings/global` | Capacity and global config | Public read, admin write |
| `spots/{id}` | Individual parking spots and status | Public read, staff write |
| `shuttleSchedule/{id}` | Shuttle departure schedule | Public read, staff write |
| `auditLog/{id}` | System audit trail | Staff read, authenticated create |
| `contactMessages/{id}` | Contact form submissions | Public create, staff read |

---

## 6. Token Purchase Flow

### Guest Flow
1. Visit `/booking`
2. Select a token pack
3. Enter license plate, name, phone, email
4. Click "Pay with Netopia" (currently stubbed — simulates 1.5s delay)
5. Tokens credited to `tokenBalances/plate_{NORMALIZED_PLATE}`
6. Confirmation screen shows balance

### Logged-in Flow
1. Visit `/booking`
2. Select a token pack
3. Select saved vehicle OR enter new plate
4. Contact info auto-filled from profile (hidden fields)
5. Click "Pay with Netopia"
6. Tokens credited to `tokenBalances/{uid}`
7. Confirmation screen shows balance

### Admin Token Use (at the lot)
1. Admin → Token Management
2. Search by license plate
3. System finds customer → shows balance
4. Click "Use 1 Token" → deducts, logs transaction
5. Or "Refund" with quantity

---

## 7. Authentication & Security

- **Providers**: Email/password + Google OAuth
- **Authorized domain**: mangoparking.ro
- **Roles**: `customer` (default), `staff`, `admin`
- **New users**: always created with `role: 'customer'` (enforced by Firestore rules)
- **Admin promotion**: only via Firebase Console (Firestore direct edit)
- **Route guards**: frontend guards + Firestore security rules
- **Token balance security**: plate-keyed docs (`plate_*`) are publicly writable for guest checkout; user-keyed docs require auth

---

## 8. Netopia Payment Integration (Pending)

Payment is currently **stubbed** — the booking page simulates a 1.5s payment delay then credits tokens directly.

**Planned real flow:**
1. Client calls Cloud Function: `POST /api/createPayment { packId, qty, customerData }`
2. Cloud Function creates Netopia payment session → returns redirect URL
3. Client redirects to Netopia hosted payment page
4. Netopia POSTs callback to Cloud Function: `POST /api/netopiaCallback`
5. Cloud Function verifies payment signature → calls `purchaseTokens()` → responds to Netopia
6. Client is redirected back to `/booking?status=success`

**Waiting on**: Netopia merchant credentials from client.

---

## 9. Deployment

- **Frontend**: `npx vite build` → upload `dist/` contents to Plesk (mangoparking.ro)
- **Firestore**: `firebase deploy --only firestore:rules,firestore:indexes --project mango-parking`
- **Base URL**: `/` (vite.config.js `base: '/'`)
- **SPA routing**: handled by Plesk/server config (all routes serve index.html)
