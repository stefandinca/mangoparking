# Admin Flows — UX Documentation & Audit

Generated review of every admin-facing flow in the Mango Parking admin panel
(`/admin/*`). Each numbered doc walks the flow exactly as staff experience it —
what they see, click, type, the feedback that appears, and what changes in
Firestore — then lists the bugs and inconsistencies found in that area.

A severity-ranked bug register lives in **[BUGS.md](BUGS.md)** — start there if
you want the fix list rather than the walkthroughs. It was **re-verified against
source on 2026-07-31**; the per-wave fix history moved to
[archive/bug-fix-waves.md](../archive/bug-fix-waves.md).

> **Caveat on the numbered walkthroughs below.** They are the original
> 2026-06 audit and have *not* been re-verified since. Where a walkthrough
> and BUGS.md disagree, BUGS.md is current. Roughly a third of the bugs the
> walkthroughs describe have since been fixed.

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
| **admin** | all 17 | all 14 links (Users, Pricing, Vouchers + the Website content hub, which absorbs Promotions/Reviews/Legal) |
| **agent** (legacy `staff`) | 10 — dashboard, activity, checkins, transactions, cashbook, capacity, shuttle, refunds, audit, help | those 10 (**no** config, **no** reviews — reviews live under the admin-only Website hub) |
| **driver** | 7 — dashboard, activity, checkins, capacity, shuttle, audit, help | those 7 |
| **customer** | none | no admin access |

*(Counts corrected 2026-07-31: `PERM` has 17 entries, and `audit` was added to
all three admin-access roles when `/admin/audit` shipped. Promotions, Reviews
and Legal still hold permissions and routes but no sidebar link — hence 17
permissions but 14 links.)*

## Cross-cutting issues (affect multiple pages)

These appear once here rather than being repeated in every doc:

1. ~~**`{{ … }}` i18n keys never interpolate**~~ — **fixed 2026-07-23**: all 8
   double-brace keys rewritten to single-brace `{name}` in both locales
   (BUGS #1). `t()` still only matches single-brace — that's the convention;
   never author a key with `{{ … }}`.
2. **UTC vs Europe/Bucharest date boundaries** — *partly fixed.* The dashboard's
   "today" stats now use Bucharest local time, and admin timestamps render
   pinned to `Europe/Bucharest`. Still open: `recordCashEntry` stamps
   `paidAtDay` from the UTC date, so a cash payment taken just after local
   midnight buckets into the previous day (BUGS #16).
3. **`.catch(() => [])` masks load failures as empty** — transactions, refunds,
   and cashbook all render a benign "nothing here" empty state when a Firestore
   read actually fails. Staff can't tell "no data" from "broken" (BUGS #17).
4. **Raw server error strings** — callable failures surface `err.message`
   ("Admin only", "Cannot demote the last admin") untranslated in an otherwise
   RO/EN UI.
5. **No sign-out inside the admin shell** — `AdminLayout` offers only "Back to
   site"; logging out requires the public Navbar (BUGS #32, still open).

## Method & caveat

The numbered walkthroughs are a static read of the code as of 2026-06
(post-v1.9), and their line numbers cite that revision. **They have not been
re-verified since** — treat their bug lists as historical and
[BUGS.md](BUGS.md) (re-verified 2026-07-31) as current.

No runtime/browser testing was performed in either pass. The "dead button"
items (BUGS #8b Add Departure, #29 Edit) were re-confirmed by tracing the event
delegation — the buttons carry attributes no handler listens for — but a quick
smoke test before fixing is still cheap insurance.
