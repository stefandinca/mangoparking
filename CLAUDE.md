# Mango Parking — Claude Code Guide

## Project Overview
Parking near Henri Coandă Airport (Otopeni) with a free shuttle ("ManGO buzz"). Two products run side by side:
- **Credits** — daily-parking tokens (1 credit = 1 day). Customers buy packs online; staff deducts a credit per parking day via plate lookup. Used by commuters / frequent travellers.
- **Long-term bookings** — date-range reservations (dropoff → pickup) priced from admin-managed day tiers, with online payment, pay-at-pickup, broker/prepaid, and walk-in paths.

Staff run the lot from an `/admin` panel: check-in / check-out, walk-ins, cash drawer (cashbook), refunds, no-shows, vouchers, promotions, pricing, capacity, shuttle, reviews, legal-page CMS, and user/role management. RO default + EN i18n. The brand is written **ManGO** everywhere.

See [Brief.md](Brief.md) for the product + architecture overview and [documentation/admin-flows/](documentation/admin-flows/) for staff-flow walkthroughs and the bug register.

## Tech Stack
- **Frontend**: Vanilla JS SPA, Vite 7, TailwindCSS 4 (PostCSS), no framework
- **Backend**: Firebase (Auth: Google + Email, Firestore, Storage) + Cloud Functions Gen 2 (Node 22, `europe-west1`)
- **Payments**: Netopia Mobilpay **v2 — live** (RSA/AES envelope + IPN callback); env-switched sandbox/live via `NETOPIA_ENV`. See [documentation/v.1.4_netopia_v2_migration.md](documentation/v.1.4_netopia_v2_migration.md)
- **Email**: Brevo (transactional) — welcome, booking/credit confirmations, reminders, refunds, invites, password reset
- **Invoicing**: SmartBill — billing data (PF/PJ, CUI via ANAF lookup) is captured at checkout; API integration is **not wired yet**. See [documentation/v.1.2_smartbill.md](documentation/v.1.2_smartbill.md)
- **Deployment**: **Vercel** auto-builds + deploys the frontend on every push to `main`; Firebase **CLI** still deploys functions/rules/indexes/storage. See [documentation/vercel-deploy.md](documentation/vercel-deploy.md)
- **Fonts**: Nunito (headings), DM Sans (body), JetBrains Mono (mono)
- **Colors**: mango `#FDBB30`, blueberry `#1E5BD6` (+ hover `#1947A8`, deep `#0F2D66`), leaf `#4FBD46`, charcoal `#1A1A1A`, frost `#FFF8E8` (+ frost-deep `#EDE3CC`)

### Design rules
No glassmorphism (`.glass` is solid white + border), no `backdrop-blur`, no transparent containers. Dark surfaces (admin sidebar, pricing band, CTA section) use `bg-blueberry-deep`. Large headings use `text-blueberry-deep`; body text stays `text-charcoal`. Yellow CTAs use `text-charcoal` (WCAG + matches the logo outline). Admin sidebar active state is `bg-mango text-charcoal`. Mascot at `/images/logo.png`, full logo at `/images/logo-full.jpeg`, tagline "safe & smart parking".

## Essential Commands
- `npm run dev` — Vite dev server (port 3000)
- `npm run build` — Vite build + Puppeteer prerender of public routes (`dist/*/index.html`). Prerender is non-fatal: if Puppeteer can't run (e.g. Vercel CI), the build still succeeds and ships the plain SPA.
- `npm run build:vite` / `npm run prerender` — each step on its own
- `npm run preview` — preview built output
- `firebase deploy --only firestore:rules,firestore:indexes,storage`
- `cd functions && npm install && firebase deploy --only functions` — Blaze plan required
- Frontend deploy is automatic via Vercel on push to `main` — no manual upload.

## Directory Map
```
src/main.js                           — entry, router init
src/router/{index,routes,guards.js}   — History API + locale prefix + auth/admin/perm guards
src/i18n/{index,ro,en}.js             — t(), localePath(); ~1300-line RO/EN locale files
src/firebase/{config,auth,db,storage}.js
src/utils/                            — dom, date, validators, constants, permissions, seo, bookingCode
src/components/core/                  — Navbar, Footer, Toast, Modal, Loader, FormField, FormDateTime,
                                        LegalPageShell, WhatsAppFab
src/components/{widgets,account,admin}/   — icons, Carousel, BillingFields / AccountLayout /
                                            AdminLayout, CreateTransactionModal
src/pages/{public,auth,account,admin}/    — default export fn(container)
src/services/                         — booking, token, capacity, longTerm, pricing, seasonalRates,
                                        discount, promoVoucher, voucher, cashbook, audit, review,
                                        promotions, legalPage, shuttle, contact, cui, netopia,
                                        userMerge (+ hidden: subscription, loyalty)
scripts/{prerender.mjs,seo-routes.mjs}    — build-time SEO prerender for public routes
functions/src/                        — index.js (Netopia + admin/cash/booking callables),
                                        emails.js (customer Brevo emails), adminNotifications.js
                                        (ops alerts to rezervari@), brevo.js, scheduled.js, cui.js
firestore.rules / firestore.indexes.json / storage.rules
firebase.json / vercel.json / vite.config.js / .firebaserc (project: mango-parking)
```

## Routes (src/router/routes.js)
- **Public**: `/`, `/booking`, `/booking/{credits,long-term,return}`, `/pay`, `/pricing`, `/shuttle`, `/about`, `/contact`, `/promotions`, legal (`/terms`, `/privacy`, `/gdpr`, `/delivery`, `/cancellation`)
- **Auth**: `/login`, `/register`, `/auth/finish-signup`
- **Account** (`['auth']`): `/account`, `/account/bookings`, `/account/vouchers`, `/account/vehicles`
- **Admin** (`['auth','admin','perm:<section>']`): `/admin`, `/admin/{checkins,transactions,cashbook,refunds,vouchers,promotions,legal,capacity,pricing,shuttle,reviews,users}`
- **Hidden** (code preserved, routes commented out): `/commuter`, `/account/{subscription,loyalty}`, `/admin/{reports,audit}`

## Roles & Permissions (src/utils/permissions.js)
Single `PERM` map drives route guards, the admin sidebar, and Firestore-rule logic — kept mutually consistent.
- **admin** — all 13 sections incl. config surfaces (pricing, users, legal, vouchers, promotions)
- **agent** (legacy `staff` alias) — ops only: dashboard, checkins, transactions, cashbook, capacity, shuttle, reviews, refunds
- **driver** — dashboard, checkins, capacity, shuttle
- **customer** — no admin access

## Conventions
- Pages export `default function(container)` — receive DOM node, mount content, optionally return a cleanup fn
- Components: factory functions returning DOM via the `html` tagged template (`src/utils/dom.js`)
- Firestore: small collections, client-side filter/sort; money math + privileged writes happen server-side in Cloud Functions (clients can't write `tokenTransactions` use rows, cash, bookings paid state, etc.)
- ID conventions: `tokenBalances` keyed `{uid}` (logged-in) or `plate_{NORMALIZED_PLATE}` (guests); `pendingOrders` `ord_{ts}_{rand}`; `activeCheckIns` keyed by normalized plate
- i18n parity: every key in both `ro.js` and `en.js`; internal links wrapped in `localePath()`. Note: `t()` only interpolates single-brace `{name}` — double-brace `{{ }}` renders literally (known bug, see admin-flows/BUGS.md)
- Never commit secrets; `.env.local` holds Firebase web config; Function secrets via `firebase functions:secrets:set` (NETOPIA_*, BREVO_API_KEY)

## Cloud Functions (functions/src/)
HTTP: `createPayment`, `netopiaCallback` (IPN), `repayOrder`. Callables cover admin order/cash/booking ops (mark paid/unpaid, cancel + refund, close cashbook, handovers, grant credits for cash, check-in with credits, charge overstay, create/long-term booking, user create/delete/role, invites, password reset, voucher validation, guest→user merge) and `lookupCui` (ANAF). Firestore triggers + scheduled jobs (`emails.js`, `scheduled.js`) send customer Brevo email and run housekeeping (no-shows, stale holds, reminders). `adminNotifications.js` sends inline-HTML ops alerts to rezervari@ on signup / reservation / cancellation / no-show / refund / credit purchase / password-reset — customer **and** staff-initiated (via `sendBrevoRaw`, no Brevo template). All in `europe-west1`.

## Agent Orchestration
For non-trivial tasks, read [.claude/orchestrator.md](.claude/orchestrator.md) first — it routes work to the specialist agents in [.claude/agents/](.claude/agents/) (`business-strategist`, `ui-ux-designer`, `firebase-developer`) without the user naming anyone. After each change: build, fix regressions, verify, then create one clean commit.

## Reference Docs
[Brief.md](Brief.md) — product + architecture overview · [documentation/admin-flows/](documentation/admin-flows/) — staff-flow walkthroughs + [BUGS.md](documentation/admin-flows/BUGS.md) · [documentation/vercel-deploy.md](documentation/vercel-deploy.md) — deploy · [functions/README.md](functions/README.md) + [functions/NETOPIA_SETUP.md](functions/NETOPIA_SETUP.md) — Functions/Netopia setup · [firestore.rules](firestore.rules) — security · versioned plans `documentation/v.1.x_*.md` · history in [documentation/old/implementation.md](documentation/old/implementation.md)
