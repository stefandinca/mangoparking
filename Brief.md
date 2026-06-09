# Mango Parking — Product & Architecture Overview
## Airport Parking + Free Shuttle — Otopeni (Henri Coandă)

> This file began as the MVP brief (a credits-only "daily travel token" system) and
> now describes the **current** product, which has grown well past that scope. For
> staff-flow detail see [documentation/admin-flows/](documentation/admin-flows/); for
> the historical MVP record see [documentation/old/implementation.md](documentation/old/implementation.md)
> and the versioned plans `documentation/v.1.x_*.md`.

---

## 1. Project Overview

Mango Parking is a parking facility near Henri Coandă International Airport (Otopeni),
Romania, with a free on-demand shuttle ("ManGO buzz"). Operating address:
Strada Radarului nr. 1, Corbeanca, jud. Ilfov. Capacity ≈ 110 spots. The brand is
written **ManGO** everywhere.

Two products run side by side:

**Credits (daily-parking tokens)**
- 1 credit = 1 day of parking. Bought online in admin-configured packs.
- Credits are flexible (not tied to dates) and validated at the lot by plate lookup —
  staff deducts a credit per parking day.
- Aimed at commuters / frequent travellers.

**Long-term bookings (date-range reservations)**
- Customer picks a dropoff → pickup range; price comes from admin-managed per-day
  tiers (with optional seasonal overrides).
- Payment paths: online (Netopia), pay-at-pickup, broker/prepaid, walk-in (paid at lot).
- Lifecycle: upcoming → active (checked in) → completed (checked out) / cancelled /
  no-show, with overstay charges for late pickup.

**Customer segments**
- **Guests** — buy credits / book without an account (plate-keyed).
- **Registered customers** — saved vehicles, billing profile, booking + credit history.
- **Staff** — run the lot from `/admin` (roles: admin / agent / driver).

---

## 2. Tech Stack

- **Frontend**: Vanilla JS SPA, Vite 7, TailwindCSS 4 (PostCSS), no framework
- **SEO**: build-time Puppeteer prerender of public routes (`scripts/prerender.mjs` +
  `seo-routes.mjs`); non-fatal in CI
- **Backend**: Firebase (Auth, Firestore, Storage) + Cloud Functions Gen 2 (Node 22,
  `europe-west1`)
- **Payments**: Netopia Mobilpay **v2 — live** (RSA/AES request envelope + IPN
  callback), env-switched sandbox/live
- **Email**: Brevo transactional templates
- **Invoicing**: SmartBill — billing data captured (PF/PJ, CUI via ANAF lookup); API
  integration not yet wired
- **Fonts**: Nunito (headings), DM Sans (body), JetBrains Mono (mono)
- **Colors**: mango `#FDBB30`, blueberry `#1E5BD6` / hover `#1947A8` / deep `#0F2D66`,
  leaf `#4FBD46`, charcoal `#1A1A1A`, frost `#FFF8E8` / deep `#EDE3CC`
- **i18n**: Romanian (default) + English, locale-prefix routing (`/en/...`)
- **Deployment**: Vercel (frontend, auto on push to `main`) + Firebase CLI (functions/
  rules/indexes/storage). Analytics via Google Tag Manager (`GTM-T87BNXPL`).

---

## 3. Architecture

```
src/
├── router/        — History API router, locale prefix, auth/admin/perm guards
├── i18n/          — t(), localePath(); ro.js & en.js (~1300 lines each)
├── firebase/      — config, auth (Google + email), db helpers, storage
├── utils/         — dom (html template), date, validators, constants,
│                    permissions, seo, bookingCode
├── components/
│   ├── core/      — Navbar, Footer, Toast, Modal, Loader, FormField,
│   │               FormDateTime, LegalPageShell, WhatsAppFab
│   ├── widgets/   — icons, Carousel, BillingFields
│   ├── account/   — AccountLayout
│   └── admin/     — AdminLayout, CreateTransactionModal
├── pages/
│   ├── public/    — Home, Booking + BookingCredits/LongTerm/Return, PayOrder,
│   │               Pricing, Shuttle, About, Contact, Promotions, legal pages
│   ├── auth/      — Login, Register, FinishSignup
│   ├── account/   — Dashboard, BookingHistory, Vouchers, Vehicles
│   └── admin/     — Dashboard, CheckIns, Transactions, Cashbook, Refunds,
│                    Vouchers, Promotions, Legal, Capacity, Pricing, Shuttle,
│                    Reviews, Users
├── services/      — booking, token, capacity, longTerm, pricing, seasonalRates,
│                    discount, promoVoucher, voucher, cashbook, audit, review,
│                    promotions, legalPage, shuttle, contact, cui, netopia,
│                    userMerge (+ hidden: subscription, loyalty)
scripts/           — prerender.mjs, seo-routes.mjs
functions/src/     — index.js (Netopia + admin/cash/booking callables), emails.js,
                     brevo.js, scheduled.js, cui.js, netopia helpers
```

**Key patterns**
- Pages export `default function(container)` — receive a DOM node, mount content,
  optionally return a cleanup fn.
- Components are factory functions returning DOM via the `html` tagged template.
- Route guards: `['auth']`, `['auth','admin']`, and `['auth','admin','perm:<section>']`.
- Small Firestore collections with client-side filter/sort; money math and privileged
  writes are server-side only (Cloud Functions).

---

## 4. Pages

### Public
| Page | Route | Purpose |
|------|-------|---------|
| Home | `/` | Hero, amenities carousels, pricing preview, reviews (stars), shuttle, FAQ, CTA, contact |
| Booking hub | `/booking` | Choose credits vs long-term |
| Buy credits | `/booking/credits` | Select pack → vehicle/contact → pay |
| Long-term | `/booking/long-term` | Date range → price → billing → pay |
| Return | `/booking/return` | Poll order status / resume after redirect |
| Pay | `/pay` | Payment handoff / confirmation |
| Pricing | `/pricing` | Credit packs + long-term tiers (informational, online-discount note) |
| Shuttle | `/shuttle` | On-demand shuttle info + schedules |
| About / Contact / Promotions | `/about` `/contact` `/promotions` | Marketing + voucher/promo listing |
| Legal | `/terms` `/privacy` `/gdpr` `/delivery` `/cancellation` | Netopia / ANPC compliance (CMS-editable) |

### Auth
`/login`, `/register`, `/auth/finish-signup` (magic-link invite completion).

### Account (auth required)
`/account` (profile + balances), `/account/bookings` (history), `/account/vouchers`,
`/account/vehicles`.

### Admin (auth + admin + per-section permission)
`/admin` (dashboard), `/admin/checkins`, `/transactions`, `/cashbook`, `/refunds`,
`/vouchers`, `/promotions`, `/legal`, `/capacity`, `/pricing`, `/shuttle`, `/reviews`,
`/users`.

### Hidden (code preserved, routes commented out)
`/commuter`, `/account/subscription`, `/account/loyalty`, `/admin/reports`, `/admin/audit`.

---

## 5. Roles & Permissions

A single `PERM` map (`src/utils/permissions.js`) drives route guards, the admin
sidebar, and Firestore-rule logic — kept mutually consistent.

| Role | Access |
|------|--------|
| **admin** | All 13 sections incl. config (pricing, users, legal, vouchers, promotions) |
| **agent** (legacy `staff` alias) | Ops: dashboard, checkins, transactions, cashbook, capacity, shuttle, reviews, refunds |
| **driver** | dashboard, checkins, capacity, shuttle |
| **customer** | No admin access |

New users are always created `role: customer` (enforced by rules). Role changes go
through the `adminChangeUserRole` callable (guards against self-demotion and removing
the last admin); admins can also create/delete users and send magic-link invites.

---

## 6. Firestore Collections (principal)

| Collection | ID | Purpose |
|-----------|-----|---------|
| `users/{uid}` | uid | Profile: name, email, phone, role, locale, vehicles[], billing |
| `tokenBalances` | `{uid}` or `plate_{PLATE}` | Credit balance per user or guest plate |
| `tokenTransactions` | auto | Append-only credit log (purchase / use / lateFee); use rows are server-written |
| `bookings` | auto | Long-term + credit check-ins; full lifecycle, payment + refund + overstay fields |
| `pendingOrders` | `ord_{ts}_{rand}` | Order staging before payment; IPN/admin fulfils |
| `activeCheckIns` | normalized plate | Real-time "cars in the lot" tracker |
| `spots` | auto | Capacity / occupancy |
| `tokenPacks`, `pricingTiers`, `seasonalPricing`, `addOns` | auto | Credit packs + long-term pricing config |
| `promoVouchers`, `voucherRedemptions`, `voucherDayBalances`, `vouchers` | code / auto / uid | Promo codes (fixed/percent/days) + legacy signup voucher |
| `cashEntries`, `cashbookReports`, `cashHandovers` | auto | Cash drawer ledger, closures, handovers |
| `auditLog` | auto | Immutable admin action log |
| `reviews`, `contactMessages` | auto | Customer reviews + contact submissions |
| `siteContent`, `legalPages` | slug | CMS bodies for promotions + legal pages |
| `shuttleSchedule`, `trainSchedule` | auto | Departure schedules |
| `settings/global` | global | Global config (e.g. online-discount %) |
| `pendingInvites`, `lookupCache` | email / `cui_*` | Invite staging + ANAF CUI cache |

**Security model (firestore.rules):** public read / admin write for config + content
collections; owner-or-staff for users / balances / transactions / bookings; cash,
audit, transaction "use" rows, and order state are **server-written only**. Guest
plate-keyed balances (`plate_*`) are writable for guest checkout.

---

## 7. Core Flows

**Buy credits** — `/booking/credits` → pick pack → plate + contact → `createPayment`
recomputes the authoritative total server-side, applies vouchers, encrypts the Netopia
envelope → hosted page → IPN `netopiaCallback` credits `tokenBalances` and logs the
purchase → return page polls `pendingOrders` status.

**Long-term booking** — `/booking/long-term` → date range → server-priced total +
billing (PF/PJ) → online pay (as above, creating/activating a `booking`) or pay-at-pickup
(repayable later via `repayOrder`).

**At the lot (admin)** — plate lookup → check-in (long-term, or credit check-in that
consumes a credit and creates a booking so it reaches check-out + capacity) → check-out,
with overstay charge if late. Walk-ins: take payment (cash credits or a long-term booking
via callables) then auto-check-in. Cash collected lands in the cashbook; refunds and
no-shows are explicit flows.

---

## 8. Payments, Email & Invoicing

- **Netopia v2 (live):** `createPayment` / `repayOrder` build an RSA/AES-encrypted
  request; Netopia confirms via the `netopiaCallback` IPN, which is idempotent and the
  only place orders become `paid` for online payments. Sandbox vs live is chosen by
  `NETOPIA_ENV`. Secrets: `NETOPIA_SIGNATURE`, `NETOPIA_PUBLIC_KEY`, `NETOPIA_PRIVATE_KEY`.
- **Brevo email:** Firestore triggers + scheduled jobs send welcome, booking/credit
  confirmation, credit-used, low-credit, reminders (24h, commuter 7PM), refund, invite,
  and password-reset mails. Secret: `BREVO_API_KEY`.
- **SmartBill:** billing identity (PF: name/CNP/CI; PJ: company/CUI via ANAF `lookupCui`,
  24h-cached) is captured on orders/bookings for future invoice generation — no SmartBill
  API calls exist yet.

---

## 9. Deployment

- **Frontend → Vercel.** Push to `main` triggers an automatic build (`npm run build`)
  and production deploy; PRs get preview URLs; roll back by promoting an older build.
  Firebase web config is set as Vercel env vars. See
  [documentation/vercel-deploy.md](documentation/vercel-deploy.md).
- **Backend → Firebase CLI.** Deploy functions/rules/indexes/storage manually:
  ```
  cd functions && npm install            # when deps change
  firebase deploy --only functions
  firebase deploy --only firestore:rules,firestore:indexes,storage
  ```
  (Optional GitHub Actions automation is described in the Vercel doc.)
- The `firebase.json` `hosting` block is now unused (we host on Vercel); the
  `firestore` / `functions` / `storage` blocks are still used by the CLI.
