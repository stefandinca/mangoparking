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
- **Payments**: Netopia Mobilpay — RSA/AES-encrypted request envelope + encrypted IPN callback; env-switched sandbox/live via `NETOPIA_ENV`. **Refunds are manual** (no programmatic refund); the JSON-REST "v2" migration that would automate them is **planned, not built** — see [documentation/roadmap/v.1.4_netopia_v2_migration.md](documentation/roadmap/v.1.4_netopia_v2_migration.md)
- **Email**: Brevo (transactional) — welcome, booking/credit confirmations, reminders, refunds, invites, password reset
- **Invoicing**: SmartBill — **live on the paid flows** (v1.2 Phase 2/4): proforma on every order, fiscal invoice on online payment confirm (IPN), **storno on cancel**; pay-at-location invoices stay manual in the SmartBill UI. Best-effort — a SmartBill failure stamps `smartbill.status='failed'`, never breaks a money flow. Documents aren't surfaced in-app/email (client decision — dropped). Retry queue + e-Factura (Phase 7/8) still planned. See [documentation/roadmap/v.1.2_smartbill.md](documentation/roadmap/v.1.2_smartbill.md)
- **Deployment**: **Vercel** auto-builds + deploys the frontend on every push to `main`; Firebase **CLI** still deploys functions/rules/indexes/storage. See [documentation/vercel-deploy.md](documentation/vercel-deploy.md)
- **Fonts**: Nunito (headings), DM Sans (body), JetBrains Mono (mono)
- **Colors**: mango `#FDBB30`, blueberry `#1E5BD6` (+ hover `#1947A8`, deep `#0F2D66`), leaf `#4FBD46`, charcoal `#1A1A1A`, frost `#FFF8E8` (+ frost-deep `#EDE3CC`)

### Design rules
No glassmorphism (`.glass` is solid white + border), no `backdrop-blur`, no transparent containers. Dark surfaces (admin sidebar, pricing band, CTA section) use `bg-blueberry-deep`. Large headings use `text-blueberry-deep`; body text stays `text-charcoal`. Yellow CTAs use `text-charcoal` (WCAG + matches the logo outline). Admin sidebar active state is `bg-mango text-charcoal`. Mascot at `/images/logo.png`, full logo at `/images/logo-full.jpeg`, tagline "safe & smart parking".

## Essential Commands
- `npm run dev` — Vite dev server (port 3000)
- `npm test` — `node --test` over `tests/*.test.mjs`: pure-logic suites (dates/DST, booking codes, booking time/overstay math, audit formatting, i18n RO/EN key parity, CSV, validators). No network, no Firebase. `cd functions && npm test` runs the functions suites (ParkVia mapper + pricing).
- `npm run lint` — ESLint (flat config, correctness rules only). **`npm run build` runs lint → test → vite → prerender**, and Vercel runs `npm run build` — so a lint error or failing test blocks the deploy.
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
                                        transfer (door-to-airport), gallery (facility photos),
                                        openingHours, userMerge, parkvia (broker auto-import
                                        admin diagnostics) (+ hidden: subscription, loyalty)
scripts/{prerender.mjs,seo-routes.mjs}    — build-time SEO prerender for public routes
functions/src/                        — index.js (Netopia + admin/cash/booking callables),
                                        emails.js (customer Brevo emails), adminNotifications.js
                                        (ops alerts to rezervari@), brevo.js, scheduled.js, cui.js,
                                        smartbill.js, parkvia.js (ParkVia auto-import, live)
firestore.rules / firestore.indexes.json / storage.rules
firebase.json / vercel.json / vite.config.js / .firebaserc (project: mango-parking)
```

## Routes (src/router/routes.js)
- **Public**: `/`, `/booking`, `/booking/{credits,long-term,return}`, `/pay`, `/pricing`, `/shuttle`, `/about`, `/contact`, `/promotions`, legal (`/terms`, `/privacy`, `/gdpr`, `/delivery`, `/cancellation`)
- **Auth**: `/login`, `/register`, `/auth/finish-signup`
- **Account** (`['auth']`): `/account`, `/account/bookings`, `/account/vouchers`, `/account/vehicles`
- **Admin** (`['auth','admin','perm:<section>']`): `/admin`, `/admin/{checkins,transactions,cashbook,refunds,vouchers,website,capacity,pricing,shuttle,users,audit,help}`. **`/admin/transactions`** ("Istoric", renamed from "Tranzacții") carries three tabs (ledger / credits / **reservation archive**) plus the full reservation record at `?booking=<id>` — every field, the fiscal trail, and the booking's own audit history; its actions come from the shared `components/admin/bookingActions.js`. **`/admin/audit`** ("Jurnal acțiuni") is the full staff-action history — date range + pagination over `auditLog`, open to every admin-access role. **`/admin/website`** ("Public website", admin-only) is the front-end-content hub: tabs for facility **gallery** + **opening hours** (new) and the **promotions / reviews / legal** editors (consolidated — their routes still exist for deep links but are no longer in the sidebar).
- **Hidden** (code preserved, routes commented out): `/commuter`, `/account/{subscription,loyalty}`, `/admin/reports`

## Roles & Permissions (src/utils/permissions.js)
Single `PERM` map drives route guards, the admin sidebar, and Firestore-rule logic — kept mutually consistent.
- **admin** — all sections incl. config surfaces (pricing, users, vouchers, website [gallery/hours/promotions/reviews/legal])
- **agent** (legacy `staff` alias) — ops only: dashboard, checkins, transactions, cashbook, capacity, shuttle, refunds (no reviews — moved under admin-only Public website)
- **driver** — dashboard, checkins, capacity, shuttle
- **customer** — no admin access

## Conventions
- Pages export `default function(container)` — receive DOM node, mount content, optionally return a cleanup fn
- Components: factory functions returning DOM via the `html` tagged template (`src/utils/dom.js`)
- Firestore: small collections, client-side filter/sort; money math + privileged writes happen server-side in Cloud Functions (clients can't write `tokenTransactions` use rows, cash, bookings paid state, etc.)
- ID conventions: `tokenBalances` keyed `{uid}` (logged-in) or `plate_{NORMALIZED_PLATE}` (guests); `pendingOrders` `ord_{ts}_{rand}`; `activeCheckIns` keyed by normalized plate
- i18n parity: every key in both `ro.js` and `en.js`; internal links wrapped in `localePath()`. Note: `t()` only interpolates single-brace `{name}` — never author keys with double-brace `{{ }}` (renders literally; the legacy offenders were fixed 2026-07)
- Never commit secrets; `.env.local` holds Firebase web config; Function secrets via `firebase functions:secrets:set` (NETOPIA_*, BREVO_API_KEY)

## Cloud Functions (functions/src/)
HTTP: `createPayment`, `netopiaCallback` (IPN), `repayOrder`. Callables cover admin order/cash/booking ops (mark paid/unpaid, cancel + refund, close cashbook, handovers, grant credits for cash, check-in with credits, charge overstay, create/long-term booking, user create/delete/role/profile-update, invites, password reset, voucher validation, guest→user merge) and `lookupCui` (ANAF). Note: booking *contact/plate/date* edits are a client-side `bookingService.updateBookingDetails` (staff-allowed by rules), not a callable. Firestore triggers + scheduled jobs (`emails.js`, `scheduled.js`) send customer Brevo email and run housekeeping (no-shows, stale holds, reminders). `adminNotifications.js` sends inline-HTML ops alerts to rezervari@ on signup / reservation / cancellation / no-show / refund / credit purchase / password-reset — customer **and** staff-initiated (via `sendBrevoRaw`, no Brevo template). All in `europe-west1`.

## Agent Orchestration
For non-trivial tasks, read [.claude/orchestrator.md](.claude/orchestrator.md) first. **Stage 0 runs on every prompt:** adopt the `prompt-engineer` persona to rewrite the raw prompt into an Upgraded Prompt, then the orchestrator classifies *that* and routes to the specialist agents in [.claude/agents/](.claude/agents/) (`business-strategist`, `ui-ux-designer`, `firebase-developer`) without the user naming anyone. After each change: build, fix regressions, verify, create one clean commit, and update the relevant [documentation/](documentation/) topic doc(s) in that commit.

## Reference Docs
Documentation is organized **by topic** (backend / feature / section — **not** by release or feedback round). Full index: [documentation/README.md](documentation/README.md). Quick map:
- **Understand the system** — [Brief.md](Brief.md) (overview) · [documentation/backend/](documentation/backend/) (data-model, cloud-functions, security-rules, payments, email, integrations, i18n & permissions) · [documentation/features/](documentation/features/) (one doc per feature) · [documentation/sections/](documentation/sections/) (public-site, account, admin) · [documentation/admin-flows/](documentation/admin-flows/) (staff walkthroughs + [BUGS.md](documentation/admin-flows/BUGS.md))
- **Planned / not built** — [documentation/roadmap/](documentation/roadmap/); **history** — [documentation/archive/](documentation/archive/); shipped-increment records `documentation/v.1.7–v.1.10_*.md`.
- **Setup / deploy** — [documentation/vercel-deploy.md](documentation/vercel-deploy.md) · [functions/README.md](functions/README.md) + [functions/NETOPIA_SETUP.md](functions/NETOPIA_SETUP.md) · [firestore.rules](firestore.rules)

**Keep docs current.** After any task that changes behavior, structure, or plans, update the affected `documentation/` topic doc(s) in the **same commit**. This is part of the after-change loop (build → verify → commit → docs), not an optional follow-up.
