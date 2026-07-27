# Admin Panel

> Status: ✅ Shipped · Last verified: 2026-07-09

The `/admin/*` back office where staff run the lot: check-ins, cash, refunds,
config, and public-site content. Every admin route declares
`guards: ['auth', 'admin', 'perm:<section>']` (`src/router/routes.js`), so a role
must both have admin access and hold the specific section permission. The panel
chrome (sidebar + mobile nav) comes from `AdminLayout(activePath, contentHtml)`
in `src/components/admin/AdminLayout.js`, which filters sidebar links by
permission so a role only sees what it can open.

Related: [i18n & permissions](../backend/i18n-and-permissions.md) (role→permission
table) · [Public site](./public-site.md) · [Account area](./account.md) ·
detailed staff walkthroughs in [admin-flows/](../admin-flows/README.md).

---

## Access model (quick reference)

Roles: **admin** (all 16 permissions), **agent** (legacy `staff` — ops only,
9 perms), **driver** (6 perms), **customer** (none). The sidebar shows at most
13 links; the consolidated **promotions / reviews / legal** editors have routes
and permissions but no sidebar link (reached via the *Website* tabs). Full table
and guard behavior: [i18n & permissions](../backend/i18n-and-permissions.md#2-roles--permissions).

---

## Sections

### Dashboard — `/admin` (`AdminDashboard.js`)
Daily overview. KPIs (total / occupied / available spots from `getCapacity()`,
credits used & purchased today), a 30/60/90-day stacked activity chart (credits +
long-term check-ins), a recent audit-log feed (`getAuditLog()` — which resolves
each row's actor uid to a person; see
[data-model → auditLog](../backend/data-model.md#auditlog)), high-occupancy
warnings, and a **refund-pending counter** linking to `/admin/refunds`. Walkthrough:
[06-dashboard-shuttle-reviews-legal](../admin-flows/06-dashboard-shuttle-reviews-legal.md).

### Activity — `/admin/activity` (`AdminActivity.js`)
Scheduled-reservation feed. **Upcoming** tab groups check-in/check-out events and
door-to-airport transfers over the next ~48h by day; **History** tab offers date
presets or a custom flatpickr range with expandable detail rows. Live via
`subscribeCollection('bookings')` + `subscribeCollection('transfers')`, with
flight-status warnings (delayed/cancelled) injected per event and deep links into
the check-ins tab. No dedicated admin-flows walkthrough yet.

### Check-ins — `/admin/checkins` (`AdminCheckIns.js`)
The core daily-ops screen. Five tabs: **Check-in** (upcoming, pay-first),
**Check-out** (active, incl. credit check-ins), **Overdue** (past pickup + grace),
**No-show** (auto-flagged), **Transfers** (door-to-airport legs). Plate/name/code
search and a today/week/month/custom window selector. Actions: check-in, check-out,
charge overstay, collect payment, cancel+refund, edit booking details, resend
confirmation email, reprice, and transfer complete/cancel/delete. **Walk-ins** are
created via `CreateTransactionModal` (`openCreateTransactionModal`). Backed by
callables `checkInBooking`, `checkOutBooking`, `adminMarkOrderPaid`,
`cancelBookingWithRefund`, `adminChargeOverstay`, `adminRepriceBooking`,
`setTransferStatus`, etc. Walkthrough:
[01-checkin-checkout-walkin](../admin-flows/01-checkin-checkout-walkin.md).

### Transactions — `/admin/transactions` (`AdminTransactions.js`)
Unified ledger merging credit `tokenTransactions` and long-term `bookings` (~500
most recent, newest first). Filter by type (purchase / use / refund / lateFee /
adjustment / extension / longTerm) and status, search by email / plate / code, and
open the walk-in modal. Read-only aggregation via `getAllRecentTransactions()` +
`getCollection('bookings')`. Walkthrough:
[02-reservations-transactions](../admin-flows/02-reservations-transactions.md).

### Cashbook — `/admin/cashbook` (`AdminCashbook.js`)
Per-agent cash drawer. Admins see every agent's open entries; agents see only
their own. Day cards show entries with running totals, a handovers log
(`recordHandover` / `cancelHandover`), and a **Close cashbook** action that
snapshots open entries into a report doc (`closeCashbook`) with a printable PDF
rendered in an isolated iframe. Includes a 90-day history of closed reports.
Walkthrough: [03-cancellations-refunds-cashbook](../admin-flows/03-cancellations-refunds-cashbook.md).

### Refunds — `/admin/refunds` (`AdminRefunds.js`)
The **manual** refund queue (Netopia has no programmatic refund — see
[roadmap v.1.4](../roadmap/v.1.4_netopia_v2_migration.md)). Three tables: pending
(awaiting manual refund), completed (last 90 days with email-status badge), and
partial (checkout-date shortening refunds). **Mark refunded** records the channel
(Netopia panel / cash / card terminal) + notes via `adminMarkRefunded`; failed
notifications can be re-sent (`adminResendRefundEmail`). Walkthrough:
[03-cancellations-refunds-cashbook](../admin-flows/03-cancellations-refunds-cashbook.md).

### Vouchers — `/admin/vouchers` (`AdminVouchers.js`) · admin-only
CRUD for promo codes. Fields: code (uppercased, immutable on edit), name, type
(percent / fixed / days / credits), value, date range, visibility (public /
private), assignees (private), max redemptions, active toggle, and a
**show-on-promotions** flag (public only) that surfaces the code on the public
[/promotions](./public-site.md) page. Uses `listVouchers` / `saveVoucher` /
`deleteVoucher`. Walkthrough:
[05-vouchers-promotions-pricing-capacity](../admin-flows/05-vouchers-promotions-pricing-capacity.md).

### Website — `/admin/website` (`AdminWebsite.js`) · admin-only
The **consolidated front-end-content hub**. Five lazily-mounted, tab-switched
panels (active tab persisted in the URL):
- **Gallery** — homepage "Our facility" photos: upload, caption, sort, delete
  (`getGalleryImages` / `addGalleryImage` / `uploadGalleryImage` / …; files in
  Storage `gallery/`).
- **Hours** — per-day open/close times or a "closed" toggle (`getOpeningHours` /
  `saveOpeningHours`, `settings/global.openingHours`); feeds the footer, contact
  page, and the long-term after-hours booking gate.
- **Promotions** — mounts `mountPromotions` from `AdminPromotions.js` (bilingual
  Quill editor for the `/promotions` hero + body).
- **Reviews** — mounts `mountReviews` from `AdminReviews.js`.
- **Legal** — mounts `mountLegal` from `AdminLegal.js`.

Gallery and Hours are new and built inline here; the other three are the
pre-existing editors, embedded. Their standalone routes still exist for deep
links but are **not** in the sidebar:
- `/admin/promotions` (`AdminPromotions.js`) — bilingual promotions-page editor.
  See [05-…](../admin-flows/05-vouchers-promotions-pricing-capacity.md).
- `/admin/reviews` (`AdminReviews.js`) — testimonials CRUD with per-field
  auto-save. See [06-…](../admin-flows/06-dashboard-shuttle-reviews-legal.md).
- `/admin/legal` (`AdminLegal.js`) — Terms/Privacy/GDPR/Delivery/Cancellation
  content per locale. See [06-…](../admin-flows/06-dashboard-shuttle-reviews-legal.md).

### Capacity — `/admin/capacity` (`AdminCapacity.js`)
Live spot map. Metrics (total / occupied / available) with an animated bar and
zone grids (A/B/C/D) showing per-spot status and plates. Click an empty tile to
cycle status (available / occupied / reserved / maintenance, persisted via
`updateSpotStatus`); click a booked tile for reservation details. Live via
`subscribeCapacity()`. Walkthrough:
[05-vouchers-promotions-pricing-capacity](../admin-flows/05-vouchers-promotions-pricing-capacity.md).

### Pricing — `/admin/pricing` (`AdminPricing.js`) · admin-only
Independently-saved sections: credit packs (name EN/RO, qty, price, active, sort),
long-term rate tiers (min/max days, per-day price), seasonal pricing periods
(date range + per-tier rates, with overlap detection), the commuter late-pickup
daily rate, and the **online-discount %** applied across funnels. Services:
`tokenService`, `longTermService`, `seasonalRatesService`, `discountService`.
Walkthrough: [05-vouchers-promotions-pricing-capacity](../admin-flows/05-vouchers-promotions-pricing-capacity.md).

### Shuttle — `/admin/shuttle` (`AdminShuttle.js`)
Manages the "ManGO buzz" schedule for the day: status summary cards and a table
of departures (time, route, driver, capacity, status). Per-departure actions
(depart / delay / cancel) persist immediately via `updateShuttleStatus()`. The
"Add departure" / edit affordances are placeholders. Walkthrough:
[06-dashboard-shuttle-reviews-legal](../admin-flows/06-dashboard-shuttle-reviews-legal.md).

### Users — `/admin/users` (`AdminUsers.js`) · admin-only
Staff & customer management. Lists users grouped by role with search, a user
detail modal, **role change** (`adminChangeUserRole`, confirms on admin/demotion),
**delete** (`adminDeleteUser`), and two add paths: direct create (email +
password, `adminCreateUser`) or **email invite** (magic link, `adminSendInvite` —
completed at [/auth/finish-signup](./account.md#authfinish-signup-srcpagesauthfinishsignupjs)).
CSV export of customers (with lifetime spend). Walkthrough:
[04-users-accounts-roles](../admin-flows/04-users-accounts-roles.md).

### Help — `/admin/help` (`AdminHelp.js`)
A plain-language, bilingual (inline RO/EN) staff guide: one expandable card per
admin page (with role badges derived from the real `PERM` map), three role cards,
and a glossary of concepts (credits vs long-term, walk-in, pay online vs on
arrival, no-show, overstay, handover/close) with a live search filter. All copy
is hardcoded in the page. Available to every admin-access role.

---

## Hidden / commented-out routes

These have page files but their route entries are commented out in
`src/router/routes.js` (code preserved, not reachable):
- **Public:** `/commuter` (`pages/public/Commuter.js`).
- **Account:** `/account/subscription`, `/account/loyalty` (page files
  `Subscription.js`, `Loyalty.js`; `subscription`/`loyalty` services are the
  "hidden" services noted in the directory map).
- **Admin:** `/admin/reports`, `/admin/audit` (`AdminReports.js`, `AdminAudit.js`).
  Note these two commented entries guard on `['auth','admin']` only (no `perm:`),
  unlike the live admin routes.

---

## Notes / caveats
- Route names, guards, permissions, and sidebar links were verified directly in
  `src/router/routes.js`, `src/utils/permissions.js`, and `AdminLayout.js`. The
  per-page feature/service lists were compiled from reading each `Admin*.js`
  module — treat specific handler names as accurate but grep before relying on
  exact line numbers.
- The [admin-flows README](../admin-flows/README.md) role matrix predates the
  move of **reviews** under the admin-only *Website* section; the current code
  (agents no longer have `reviews`) is authoritative — see
  [i18n & permissions](../backend/i18n-and-permissions.md#role--permission-table).
