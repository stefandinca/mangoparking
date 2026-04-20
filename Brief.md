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
- **SEO**: Puppeteer build-time prerender for public routes (`scripts/prerender.mjs`)
- **Backend**: Firebase (Auth, Firestore, Storage, Hosting, Functions Gen 2 / Node 20 / europe-west1)
- **Fonts**: Space Grotesk (headings), DM Sans (body), JetBrains Mono (mono)
- **Colors**: Mango #F28C28, Charcoal #2D4A47, Leaf #34D399, Frost #F0F2F5
- **i18n**: Romanian (default) + English, locale prefix routing (/en/...)
- **Deployment**: Firebase Hosting + Functions (target); Plesk legacy — see §9 migration plan
- **Payments**: Netopia via Cloud Functions bridge (skeleton in `functions/`, stubbed — awaiting merchant creds)

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
scripts/
└── prerender.mjs    — Puppeteer crawler → static HTML for public routes (SEO)
functions/           — Cloud Functions (Gen 2) bridging Netopia → Firestore
└── src/index.js     — createPayment + netopiaCallback
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

## 8. Netopia Payment Integration (Skeleton ready, stubbed)

**Skeleton lives in `functions/src/index.js`** (Gen 2, europe-west1). The booking page still uses the local 1.5s stub until secrets land and client is wired to the Function.

**Architecture**
1. Client → `POST createPayment { packId, quantity, customerData }`
2. `createPayment` writes `pendingOrders/{orderId}` + returns Netopia hosted-page redirect URL
3. User pays on Netopia
4. Netopia → server-to-server `POST netopiaCallback` (IPN)
5. `netopiaCallback` verifies HMAC signature, runs `creditTokens()` in a Firestore transaction (mirrors `tokenService.purchaseTokens`), marks order `paid`
6. Client returns to `/booking?status=success&orderId=...`

**Secrets** (stored via `firebase functions:secrets:set`, never in source):
- `NETOPIA_API_KEY` — merchant API key
- `NETOPIA_SIGNATURE` — HMAC secret for IPN verification

**TODO markers**: `// TODO(netopia)` blocks in `functions/src/index.js` call out the two real API integration points.

**Waiting on**: Netopia merchant credentials + sandbox access from client. See `functions/README.md` for setup/deploy.

---

## 9. Deployment

### Current commands
- **Frontend**: `npm run build` → Vite bundle + Puppeteer prerender of 10 public routes into `dist/`
- **Firestore rules/indexes**: `firebase deploy --only firestore:rules,firestore:indexes`
- **SPA routing**: `firebase.json` rewrites `**` → `/index.html`; prerendered routes are served as-is when they exist at `dist/{route}/index.html`

### Migration: Plesk → Firebase Hosting (step-by-step)
The long-term plan is to move web hosting off Plesk onto Firebase Hosting (email stays on Plesk). `firebase.json` already has the `hosting` block pointing at `dist/`, and `.firebaserc` binds to project `mango-parking`. Remaining steps (user-executed):

**1. Install & authenticate**
```bash
npm install -g firebase-tools      # or use `npx firebase-tools` ad-hoc
firebase login
firebase projects:list             # confirm mango-parking is visible
```

**2. Dry-run to a preview channel** (no DNS change yet)
```bash
npm run build
firebase hosting:channel:deploy preview --expires 7d
```
Firebase returns a temporary `https://mango-parking--preview-xxxx.web.app` URL. Open it, click around RO + EN public pages, verify prerender (view-source should show rendered HTML), verify SPA navigation still works.

**3. Wire Cloud Functions (optional, do once)**
```bash
cd functions && npm install && cd ..
firebase functions:secrets:set NETOPIA_API_KEY
firebase functions:secrets:set NETOPIA_SIGNATURE
firebase deploy --only functions        # requires Blaze plan
```

**4. Deploy to the default channel**
```bash
firebase deploy --only hosting
```
Site is now live at `mango-parking.web.app` + `mango-parking.firebaseapp.com`. Still not on mangoparking.ro.

**5. Add custom domain in Firebase Console**
Console → Hosting → **Add custom domain** → `mangoparking.ro`. Firebase gives two records:
- 1× TXT record (ownership)
- 2× A records (e.g. `151.101.1.195`, `151.101.65.195`)

**6. Update DNS at the registrar** (NOT Plesk DNS — the registrar that controls `mangoparking.ro`)
- Add the TXT record → wait for Firebase to verify ownership (minutes to hours)
- Replace the existing A records (the ones pointing to Plesk) with Firebase's two A records
- **Leave all MX records untouched** — email keeps flowing through Plesk
- Leave any `mail.mangoparking.ro` / webmail subdomains alone

**7. Wait for SSL provisioning** (up to 24h, usually <1h). Firebase auto-issues a Let's Encrypt cert once DNS resolves.

**8. Verify + decommission**
- Test `https://mangoparking.ro` on mobile + desktop, RO + EN
- Test `/pricing`, `/en/about`, etc. — prerendered HTML should load instantly
- Confirm email still works (send/receive a test)
- Leave Plesk webspace alone for ~1 week as fallback, then decommission web (not mail)

### CI/CD (follow-up, not MVP)
Add `.github/workflows/deploy.yml` that runs `npm ci && npm run build && firebase deploy --only hosting` on push to `main`, authenticated via `FIREBASE_TOKEN` secret from `firebase login:ci`.
