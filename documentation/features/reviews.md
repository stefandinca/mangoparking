# Customer Reviews

> Status: ✅ Shipped · Last verified: 2026-07-09

Admin-curated customer testimonials shown on the public homepage and moderated
under `/admin/website`. Related: `../backend/cloud-functions.md`.

## What it is

A small, admin-managed collection of star reviews (`reviews`) rendered on the
homepage and editable from the admin **Public website** section. There is **no
customer-submission flow** — reviews are seeded/curated by staff, so moderation
is just create/edit/publish/sort/delete. Each review is typed `traveler` or
`commuter` (a small label under the name).

## How it works

### Service — `src/services/reviewService.js`

- `getPublishedReviews(max = 6)` — reads all reviews ordered by `sortOrder asc`,
  then filters `published !== false` **client-side** and slices to `max`. This is
  deliberate: combining `where('published')` + `orderBy('sortOrder')` would need a
  composite index that isn't deployed; without it the query would throw and the
  homepage would silently fall back. The collection is tiny and admin-curated, so
  fetch-all-then-filter is cheap and index-free.
- `getAllReviews()` — every review, `sortOrder asc` (admin editor).
- `createReview(data)` — writes with clamped `rating` (1–5), defaulted `date`
  (today), `published` (default true), `sortOrder` (default 100), `type`
  (`traveler` unless `commuter`); audits `review_created`.
- `updateReview(id, data)` — patches only provided fields (rating re-clamped,
  `published` coerced to bool); audits `review_updated`.
- `deleteReview(id)` — removes + audits `review_deleted`.

### Editor — `src/pages/admin/AdminReviews.js`

`mountReviews(page)` is a **mountable editor** used two ways: standalone at
`/admin/reviews` (deep-link) and as a tab inside the Public website hub
(`AdminWebsite.js`). It renders one editable row per review — inline inputs for
name, rating, comment, date, `type` (select), `sortOrder`, and a `published`
checkbox. Each field **auto-saves on `change`** via `updateReview({ [field]: value })`
(no explicit save button in the normal flow). An **Add** button creates a blank
review (`sortOrder` = last + 10) and re-renders; **Delete** confirms via
`window.confirm` then `deleteReview`. Toasts report outcomes.

### Public display

`getPublishedReviews()` feeds the homepage reviews section (stars + name + type
label). Ordering is by `sortOrder` (lower = earlier); a lower number floats a
review to the top.

## Key files

- `src/services/reviewService.js` — CRUD + schema comment + `clampRating`.
- `src/pages/admin/AdminReviews.js` — inline editor (`mountReviews`, reused by
  `AdminWebsite.js`).
- `firestore.rules` — `reviews` (`:213`): public read, `isAdmin()` write.

## Data (Firestore)

**`reviews/{auto}`** (from `reviewService.js:3`):

| field | notes |
|---|---|
| `name` | display name |
| `rating` | 1–5 (clamped server-side helper) |
| `comment` | review text |
| `date` | ISO date string (`YYYY-MM-DD`) |
| `photoUrl` | string \| null |
| `published` | boolean — `false` hides it from the homepage |
| `sortOrder` | number, lower = earlier |
| `type` | `'traveler'` \| `'commuter'` (label under the name) |

Rules: `read: if true` (public homepage), `write: if isAdmin()`. Reviews were
consolidated into the admin-only Public website section — **agents no longer
moderate reviews** (rule + permission tightened from the old `/admin/reviews`
staff access).

## Gotchas / edge cases

- **No composite index by design.** `getPublishedReviews` avoids a
  `published + sortOrder` index by filtering `published` in JS; keep it that way
  unless the collection grows large.
- **Publish semantics.** Only `published === false` hides a review; any other
  value (incl. missing) is treated as published.
- **Auto-save.** Editing any field fires an immediate write — there's no draft
  state; a mistaken keystroke persists on blur/change.
- **No customer submission path** — reviews are entirely staff-curated.
- `photoUrl` is stored but the editor row doesn't expose an uploader (set
  programmatically / via seed data).
