# 06 — Dashboard, Shuttle, Reviews, Legal & the admin shell

**Pages:** `/admin` (`AdminDashboard.js`), `/admin/shuttle` (`AdminShuttle.js`),
`/admin/reviews` (`AdminReviews.js`), `/admin/legal` (`AdminLegal.js`), plus
`src/components/admin/AdminLayout.js`.

## In plain words

- This groups the **remaining admin screens** plus the **frame** around the whole
  panel (the sidebar menu).
- **Dashboard:** the home screen — at-a-glance numbers (spots free/occupied,
  credits used today), an activity chart, and a recent-activity log.
- **Shuttle:** manage the airport shuttle departures — mark them boarding,
  departed, delayed, or cancelled.
- **Reviews:** add/edit/remove the customer reviews shown on the public homepage.
- **Legal:** edit the text of the legal pages (terms, privacy, GDPR, etc.) in both
  languages.
- **The frame:** a side menu that only shows the sections each role is allowed to
  see.
- **Things to watch (see bugs):** there's **no log-out button** inside the admin
  panel; several shuttle buttons ("Add Departure", "Edit") don't do anything;
  saving a legal page only saves the language you're currently on; and the
  dashboard's "today" numbers can be off by a day late at night because of a
  time-zone mix-up.

---

## Flows

### Flow 0 — The shell (AdminLayout)
Fixed left sidebar (`hidden md:flex`, deep-blue) + main column. Links come from
`ADMIN_LINKS` (13), each filtered by `hasPermission(role, link.perm)` — matching
the router exactly. Mobile (`md:hidden`): top bar + chevron toggling a dropdown of
the same links. Footer/mobile offer only **"Back to site"** — **no sign-out
anywhere in the admin shell** (logout requires the public Navbar).

### Flow 1 — Dashboard
**Entry:** `/admin`, `perm:dashboard`. Four parallel reads: `getCapacity()`,
`getAllRecentTransactions(2000)`, `getAuditLog(8)`, `getCollection('bookings')`.
1. **Refund alert** (if any `refund-pending`): mango banner → `/admin/refunds`,
   count + summed `totalPrice`.
2. **High-occupancy alert** (if `occupancyPct >= 90`).
3. **Five stat cards:** Total / Occupied (progress bar) / Available (from
   `getCapacity()`); Credits Used Today (count of `use` tx where
   `timestamp.slice(0,10) === today`); Credits Purchased Today. `today` =
   `new Date().toISOString().slice(0,10)` (**UTC**).
4. **Activity chart:** `buildDailyBuckets(30, …)` bucketed by **Europe/Bucharest**;
   30/60/90 tabs re-bucket in memory.
5. **Recent Activity:** last 8 audit entries — time, action badge,
   `describeAction(...)`, actor email local-part.
**End state:** read-only; only interactions are chart tabs + refund banner. No
manual refresh.

### Flow 2 — Shuttle
**Entry:** `/admin/shuttle`, `perm:shuttle`. `getShuttleSchedule()` →
`shuttleSchedule` collection, or `MOCK_SHUTTLE` (10 rows, ids `s1`..`s10`) if
empty/error. Header + **+ Add Departure**. Five status-count cards. Table rows:
time, route, driver, passengers/capacity, status pill, actions (Delay/Cancel for
scheduled/boarding, Depart for scheduled, Edit always). Status actions optimistically
restyle the pill, then `updateShuttleStatus` writes + audits.
**End state:** pill changes; doc updated **if it exists**.

### Flow 3 — Reviews
**Entry:** `/admin/reviews`, `perm:reviews`. `getAllReviews()` by `sortOrder asc`.
Inline-editable cards (name, rating, comment, date, type, sortOrder, Public
checkbox, hidden Save, Delete). **Add** seeds a row + re-renders + toast. **Edit:**
a `change` on any field auto-saves that one field via `updateReview`; error →
toast, **success → no feedback**. **Delete:** `window.confirm` → `deleteReview` →
optimistic remove + toast. Published reviews surface on the public homepage.

### Flow 4 — Legal pages
**Entry:** `/admin/legal`, `perm:legal` (admin only). Loads all 5
`legalPages/{slug}`. RO|EN toggle + slug tabs + form (Title, Intro, dynamic
Sections with ↑/↓/delete, Last-updated). Switching slug/locale captures current
edits into in-memory `working` then re-renders. **Save** persists the **active
locale only** via `saveLegalPage(slug, locale, payload)` — trims, drops empty
sections, stamps `lastUpdated`, audit. Public render escapes all HTML and
paragraph-ifies — raw HTML/script cannot be injected, and a fully-blanked page
falls back to i18n defaults.

---

## Bugs & inconsistencies

1. **[HIGH] Missing i18n key `admin.trainToParking`.** `AdminShuttle.js:27` maps
   `train_to_parking → 'admin.trainToParking'`, which exists in **neither**
   `ro.js` nor `en.js`. `MOCK_SHUTTLE` row `s8` uses it, so that row renders the
   literal string "admin.trainToParking" as its route.
2. **[HIGH] "+ Add Departure" is a dead button.** `AdminShuttle.js:41` renders
   `data-add-departure` but no handler is wired (the only `delegate` is on
   `[data-action]`). The primary action on the page does nothing.
3. **[HIGH] Dashboard renders audit content unescaped (XSS).** `AdminDashboard.js`
   never imports `escapeHtml`. `describeAction` interpolates `nv.email`, `nv.code`,
   `nv.licensePlate`, `nv.spotId` and the actor directly into the markup that the
   layout sets via `innerHTML`. Audit `newValueObj.email` (e.g.
   `admin_user_created`, `admin_invite_sent`) is user/admin-supplied free text — a
   crafted email/display name injects markup into the dashboard. Plates are
   charset-limited; emails/names are not.
4. **[MED] "Edit" shuttle button is dead** (`:96` → handler `return`s for anything
   but delay/cancel/depart). Silent no-op on every row.
5. **[MED] Shuttle status writes silently fail on mock data.** `MOCK_SHUTTLE` ids
   are `s1`..`s10` but the seed writes `s-001`.. (`seed.js:102`). With an empty
   collection the UI updates the pill then calls `updateShuttleStatus('s1', …)` →
   `updateDoc` on a non-existent doc → rejects, swallowed by `.catch(console.error)`.
   Appears to change, reverts on reload, no error shown.
6. **[MED] Shuttle summary cards never update after a status change** (`:45`,
   computed once) — "Cancelled: 0" stays 0 after cancelling a departure.
7. **[MED] Dashboard "today" stats (UTC) disagree with the chart (Bucharest).**
   `today` uses UTC slicing (`:216`) while `buildDailyBuckets`/`localDay` use
   Europe/Bucharest. For the first ~2–3 h after local midnight, "Credits used
   today" counts to the previous day but the chart's last bar uses the current day.
8. **[MED] Reviews auto-save gives no success feedback; the visible Save button is
   dead.** The `change` handler saves silently (errors only); `data-save` (`:29`)
   is hard-coded `hidden` with no handler.
9. **[MED] Legal editor saves only the active locale per click.** Editing RO,
   switching to EN, editing EN, then Save writes only EN; the RO edits sit in
   in-memory `working` and are lost on navigation, with no warning.
10. **[MED] No sign-out in the admin shell** (`AdminLayout.js` offers only "Back
    to site").
11. **[LOW] Dashboard has no Quick Actions despite i18n + brief.** Keys
    `quickActions`, `newBookingBtn`, etc. (`ro.js:661`) exist but nothing renders
    them.
12. **[LOW] Hardcoded Romanian `name:'Nume'`** seeds new reviews (`:60`) regardless
    of locale.
13. **[LOW] Reviews uses a local `escape()`** (`:108`) that omits the single quote
    and diverges from the shared `escapeHtml`; currently safe (double-quoted
    attrs) but an easy-to-misuse duplicate — and review content renders publicly.
14. **[LOW] No empty/loading state on shuttle; mock data masquerades as real.** An
    empty collection shows 10 mock "scheduled" departures as today's schedule;
    `dayOfWeek` never applied (weekday entries show on weekends).
15. **[LOW] Legal blank-line hint mismatch** — EN says "a blank line", RO says
    "două rânduri goale", parser splits on one blank line (`LegalPageShell.js:29`).
16. **[LOW] Unused imports in AdminShuttle** (`html`, `localePath`, `getRouteKey`).
17. **[LOW] Dashboard activity has no badge/description for review/legal actions** —
    those audit rows fall to gray + raw text.

### Notes on specific hunts
- **Dead nav links to hidden routes:** none. `ADMIN_LINKS` omits `reports`/`audit`
  (both routes commented out). The orphaned pages still exist: `AdminReports.js`
  (revenue/growth analytics — reads the hidden `bookingService`/
  `subscriptionService`) and `AdminAudit.js` (filterable audit table); each would
  need a sidebar entry + permission to be reachable.
- **Nav vs router permission parity:** consistent.
- **Legal can't be broken by raw HTML or empty save:** confirmed safe.
- **Toast/modal consistency:** Reviews delete uses native `window.confirm` instead
  of the app's `Modal` — a pattern inconsistency.
