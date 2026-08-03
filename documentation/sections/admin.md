# Admin Panel

> Status: ✅ Shipped · Last verified: 2026-07-31 (routes, permissions and
> sidebar re-checked against `routes.js` / `permissions.js` / `AdminLayout.js`)

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

Roles: **admin** (all 17 permissions), **agent** (legacy `staff` — ops only,
10 perms), **driver** (7 perms), **customer** (none). The sidebar shows at most
14 links; the consolidated **promotions / reviews / legal** editors have routes
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
**No-show** (auto-flagged), **Transfers** (door-to-airport legs). The live
`bookings` subscription is scoped to `status in [upcoming, active, no-show]`
(single-field filter, automatic index) — the board never renders
completed/cancelled rows, so it no longer re-streams the whole archive on
every snapshot as lifetime volume grows. Every row leads with its **booking
code** (also in the expanded overdue card), linked — like every code across
the admin — to the reservation's full record on Istoric
(`/admin/transactions?booking=<id>`, via `reservationCodeHtml`). Plate/name/code
search and a today/week/month/custom window selector.

**Columns** (2026-08-03): code · times · customer · **phone** · plate ·
**return flight** · payment · status · actions. Phone renders as a `tel:` link
so an agent can call from the board (href keeps only `+` and digits — spaces
break some dialers; the SPA router already passes `tel:` through to the
browser). Return flight is `flightNumberPickup`, shown on every tab rather than
only check-out, since staff want it while the car is still being dropped off.
The separate delayed/cancelled flight badge stays in the status cell — it is
tab-dependent (departure on check-in, arrival on check-out).

**Icon actions** (2026-08-03): check-in, check-out, resend email, edit and
cancel are icon-only buttons (`ACTION_ICONS` in `AdminCheckIns.js`), which is
what buys back the width the two new columns need. Each carries `title` +
`aria-label`. **Collect and Charge overstay deliberately keep their text** —
they move money and a mis-click costs a real transaction, so the mixed
text/icon row is intentional. Actions: check-in, check-out,
charge overstay, collect payment, cancel+refund, edit booking details, resend
confirmation email, reprice, and transfer complete/cancel/delete. **Walk-ins** are
created via `CreateTransactionModal` (`openCreateTransactionModal`). Backed by
callables `checkInBooking`, `checkOutBooking`, `adminMarkOrderPaid`,
`cancelBookingWithRefund`, `adminChargeOverstay`, `adminRepriceBooking`,
`setTransferStatus`, etc. Walkthrough:
[01-checkin-checkout-walkin](../admin-flows/01-checkin-checkout-walkin.md).

### History ("Istoric") — `/admin/transactions` (`AdminTransactions.js`)
Renamed from "Tranzacții" (2026-07); the route is unchanged. Three tabs over
the same fetch. All timestamps render through `anyToIso` (`src/utils/date.js`)
— client-written docs carry Firestore `Timestamp` objects in
`createdAt`/`updatedAt` (db.js stamps `serverTimestamp()`), which used to leak
as raw `Timestamp(seconds=…)` text in the date columns and to corrupt the
newest-first string sort. Since 2026-07 the db.js read boundary additionally
runs every doc through `normalizeDocDates` (`src/utils/date.js`), so
Timestamps are already ISO strings by the time any page sees them; the
per-surface `anyToIso` calls remain as belt-and-braces.

**Known read ceilings (deliberate).** The reservation archive and the
dashboard fetch the whole `bookings` collection: the archive because
completeness is its job (client-paginated), the dashboard because `createdAt`
is *mixed-typed* across the collection (Timestamp on client writes, ISO
string on function writes) and a Firestore range/orderBy constraint only
matches one type — a server-side window would silently drop rows. Revisit
after a stored-field migration to a single type. Status/payment chips render via
`reservationStatusLabel` (bookingActions.js), which falls back to `—` / the raw
value instead of echoing a `reservations.status.undefined` key for bookings
with no `paymentStatus`.

- **Toate** — the unified ledger merging credit `tokenTransactions` and
  long-term `bookings` (~500 most recent). Filter by type and status, search
  by email / plate / code, open the walk-in modal.
- **Credite** — the same ledger scoped to the credits product only
  (purchase / use / refund / lateFee / adjustment). Long-term booking rows and
  `extension` rows (long-term extension charges that live in
  `tokenTransactions`) stay on Toate; their type-filter options are hidden on
  this tab.
- **Rezervări** — the **reservation archive**: every `bookings` doc (long-term
  *and* credit check-ins), which is the only place a completed booking from
  months ago can be found (the check-in board is windowed and status-scoped).
  Filters: status, payment status, type, source, plus search over code / plate /
  email / phone / name. Paginated (25/page) with the shared pager, and a **CSV
  export** of the current filtered set. A row opens the detail view below.

### Reservation detail — `/admin/transactions?booking=…` (`AdminReservationDetail.js`)
The full record behind one booking — previously ~15 of its ~60 fields were
visible anywhere. Cards: customer & vehicle · stay · money · payment &
invoicing · billing · operations. Empty fields are dropped, so a broker row
shows its ParkVia trail and a web row shows its billing identity.

Three things it surfaces that had no UI at all:
- **What was actually charged.** `booking.totalPrice` is the gross; the linked
  `pendingOrders` doc carries the post-discount, post-voucher amount. Both are
  shown when they differ — the gap behind [BUGS.md #2](../admin-flows/BUGS.md).
- **The fiscal trail** — SmartBill proforma / invoice / storno numbers, status
  and last error.
- **History** — the booking's own `auditLog` rows via
  `auditService.listEntityAudit(id)` (equality on `entityId` → automatic index,
  sorted client-side), shaped like every other audit surface: actors resolved
  (server rows only carry `actorUid`; feeding raw docs left the "who" column
  empty) and value objects unified, then rendered with the shared
  `describeAction`. `booking_edited` rows additionally expand into per-field
  **old → new** diff lines (contact sub-fields split out, dates formatted),
  possible because `updateBookingDetails` records the *before* values of the
  changed keys.
- **Who created it** — a "Creată de" row in the operations card: the
  `booking_created` audit row's resolved actor when one exists, else the
  server-stamped `createdBy` uid, else the source channel (a "Site" booking was
  created by the customer).

**Booking codes.** Everything renders through
`bookingDisplayCode` (`src/utils/bookingCode.js`): the real `code` when the doc
has one, else a stable LT-/CR- pseudo-code derived from the doc id. Raw
Firestore ids ("aTUFw5tp…") must never surface — staff read them as a second,
confusing code format. Applies to the archive/ledger, detail header + summary,
check-in board rows, refunds queue, dialogs/toasts, `reservationCodeHtml`
links, and audit descriptions (`describeAction` prefers a caller-supplied code
or `newValue.code`; client audit writes stamp `code` on check-in/out/cancel
rows, and every booking-related Cloud Function audit payload carries `code`
too — created/check-in/cancel/no-show/refund/overstay/reprice/extension/
email-resend/ParkVia, plus `pendingOrders.bookingCode` on the order rows.
Only rows written before this shipped keep the id-fragment fallback).

**Actions** (check-in, check-out, collect payment, edit, charge overstay,
resend confirmation, cancel + refund) run through
`src/components/admin/bookingActions.js` — extracted from `AdminCheckIns` so
both surfaces share one implementation of the money-moving paths. **Copy UX**:
click-to-copy on plate / email / phone / order id, plus a *Copy summary* button
producing a plain-text block for WhatsApp.

Walkthrough: [02-reservations-transactions](../admin-flows/02-reservations-transactions.md).

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
Staff & customer management. Lists users grouped by role with search, **role change** (`adminChangeUserRole`, confirms on admin/demotion),
**delete** (`adminDeleteUser`), and two add paths: direct create (email +
password, `adminCreateUser`) or **email invite** (magic link, `adminSendInvite` —
completed at [/auth/finish-signup](./account.md#authfinish-signup-srcpagesauthfinishsignupjs)).
CSV export of customers (with lifetime spend). Clicking a name opens that
user's [profile page](#user-profile--adminusersuid-adminuserprofilejs).
Walkthrough: [04-users-accounts-roles](../admin-flows/04-users-accounts-roles.md).

### User profile — `/admin/users?uid=…` (`AdminUserProfile.js`)
Clicking a name in the users list opens that person's profile instead of the
old modal. The router matches on path only, so this lives behind the same
`/admin/users` route entry (which also keeps the sidebar item highlighted);
`AdminUsers.js` checks for `?uid=` and delegates.

- **"What did this person do"**: a date range (the shared preset/custom bar),
  a stat row — check-ins, check-outs, reservations created, payments taken,
  total actions — and the paginated list of those actions.
- Rows come from `auditLog` **where they are the actor**. Actor matching has to
  cover both writer shapes (`actorUid` server-side, `userEmail` client-side),
  which one Firestore query can't do, so the page reuses the capped range query
  and filters in memory (`isActorRow` in `auditFormat.js`); the cap notice is
  shown, since a truncated range means a possibly-short count. Two composite
  indexes (`actorUid`+`timestamp`, `userId`+`timestamp`) would make it exact if
  volume ever demands it.
- Below the activity block sit the same read-only sections the user modal
  renders (profile, vehicles, billing, credits, vouchers, their bookings and
  credit ledger) — reused via `renderUserSections`, not duplicated.
- The modal (`openUserDetail`) is still the surface used from booking rows and
  capacity tiles, and still owns **edit** and **CSV export**.

### Action log — `/admin/audit` (`AdminAudit.js`)
The full staff-action history behind the dashboard's short activity summary —
"who did what, when". Available to **every admin-access role** (admin, agent,
driver): each already sees the same feed, shortened, on its dashboard, and
`firestore.rules` lets any `isStaff()` read `auditLog`, so a UI-only
restriction would be cosmetic.

- **Date range** drives the Firestore query: `Today` / `Last 7 days` /
  `Last 30 days` presets plus a flatpickr custom range, bounded on
  **Europe/Bucharest** calendar days (`windowToIso` in
  `components/admin/auditFormat.js`). Range + sort are both on `timestamp`, so
  no composite index is needed.
- **Action** and **actor** dropdowns are built from what the range returned;
  a free-text search matches across action / entity / actor / description.
  Filters apply to the whole range, then the result is **paginated
  client-side** (25/page) — a cursor page would filter only its own slice.
- The range query is capped at `AUDIT_RANGE_MAX` (1000). Hitting the cap shows
  a notice rather than truncating silently.
- Range, page and search are mirrored into the URL, so a refresh or a shared
  link reopens the same view.
- Rows render through the shared `auditFormat.js` helpers (`actionStyle`,
  `describeAction`, `fmtAuditTime`) — the same ones the dashboard uses, so an
  action reads identically in both places — and the actor column shows the
  resolved person (see [data-model → auditLog](../backend/data-model.md#auditlog)).

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
- **Admin:** `/admin/reports` (`AdminReports.js`). Note this commented entry
  guards on `['auth','admin']` only (no `perm:`), unlike the live admin routes.
  (`/admin/audit` was **un-hidden 2026-07-27** — it is now a live route with a
  `perm:audit` guard and a sidebar link; see *Action log* above.)

---

## Notes / caveats
- Route names, guards, permissions, and sidebar links were verified directly in
  `src/router/routes.js`, `src/utils/permissions.js`, and `AdminLayout.js`. The
  per-page feature/service lists were compiled from reading each `Admin*.js`
  module — treat specific handler names as accurate but grep before relying on
  exact line numbers.
- The [admin-flows README](../admin-flows/README.md) role matrix was corrected
  on 2026-07-31 (it under-counted permissions and predated both the `audit`
  permission and the move of **reviews** under the admin-only *Website*
  section). It now matches `PERM` — 17 permissions, 14 sidebar links. See
  [i18n & permissions](../backend/i18n-and-permissions.md#role--permission-table).
- The numbered admin-flows **walkthroughs** are the 2026-06 audit and are not
  kept current; [BUGS.md](../admin-flows/BUGS.md) (re-verified 2026-07-31) is
  the authoritative bug status.
