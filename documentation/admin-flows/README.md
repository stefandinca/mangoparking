# Admin Flows — UX Documentation & Audit

Generated review of every admin-facing flow in the Mango Parking admin panel
(`/admin/*`). Each numbered doc walks the flow exactly as staff experience it —
what they see, click, type, the feedback that appears, and what changes in
Firestore — then lists the bugs and inconsistencies found in that area.

A consolidated, severity-ranked bug register lives in **[BUGS.md](BUGS.md)** —
start there if you want the fix list rather than the walkthroughs.

## Index

| # | Doc | Pages covered |
|---|-----|---------------|
| 01 | [Check-in / Check-out / Walk-in](01-checkin-checkout-walkin.md) | `/admin/checkins` + CreateTransactionModal |
| 02 | [Reservations & Transactions](02-reservations-transactions.md) | `/admin/transactions` |
| 03 | [Cancellations, Refunds & Cashbook](03-cancellations-refunds-cashbook.md) | `/admin/refunds`, `/admin/cashbook` + cancel path |
| 04 | [Users, Accounts & Roles](04-users-accounts-roles.md) | `/admin/users` |
| 05 | [Vouchers, Promotions, Pricing & Capacity](05-vouchers-promotions-pricing-capacity.md) | `/admin/vouchers`, `/admin/promotions`, `/admin/pricing`, `/admin/capacity` |
| 06 | [Dashboard, Shuttle, Reviews, Legal & shell](06-dashboard-shuttle-reviews-legal.md) | `/admin`, `/admin/shuttle`, `/admin/reviews`, `/admin/legal`, AdminLayout |

## Role → permission → navigation matrix

The same `PERM` map (`src/utils/permissions.js`) drives route guards
(`src/router/guards.js`), the sidebar (`AdminLayout.js`), **and** Firestore rules.
They are mutually consistent — no privilege-escalation gap was found.

| Role | Permissions | Sidebar links shown |
|------|-------------|---------------------|
| **admin** | all 16 | every section (Users, Pricing, Legal, Vouchers, Promotions + the Website content hub) |
| **agent** (legacy `staff`) | dashboard, activity, checkins, transactions, cashbook, capacity, shuttle, refunds, help | those 9 (**no** config, **no** reviews — reviews live under the admin-only Website hub) |
| **driver** | dashboard, activity, checkins, capacity, shuttle, help | those 6 |
| **customer** | none | no admin access |

## Cross-cutting issues (affect multiple pages)

These appear once here rather than being repeated in every doc:

1. ~~**`{{ … }}` i18n keys never interpolate**~~ — **fixed 2026-07-23**: all 8
   double-brace keys rewritten to single-brace `{name}` in both locales
   (BUGS #1). `t()` still only matches single-brace — that's the convention;
   never author a key with `{{ … }}`.
2. **UTC vs Europe/Bucharest date boundaries** — dashboard "today" stats, the
   cashbook day buckets, and most money-page date columns use the browser/UTC
   day instead of Bucharest local time, so overnight figures drift by one day.
3. **`.catch(() => [])` masks load failures as empty** — transactions, refunds,
   and cashbook all render a benign "nothing here" empty state when a Firestore
   read actually fails. Staff can't tell "no data" from "broken".
4. **Raw server error strings** — callable failures surface `err.message`
   ("Admin only", "Cannot demote the last admin") untranslated in an otherwise
   RO/EN UI.
5. **No sign-out inside the admin shell** — `AdminLayout` offers only "Back to
   site"; logging out requires the public Navbar.

## Method & caveat

This is a static read of the code as of the current `main` (post-v1.9). Line
numbers cite files at that revision. Findings were verified against source; the
highest-severity items (money math, XSS, the i18n regex) were re-confirmed
directly. No runtime/browser testing was performed — a few items flagged as
"dead button" should be smoke-tested before fixing in case a handler is wired
somewhere unexpected.
