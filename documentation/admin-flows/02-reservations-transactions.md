# 02 — Reservations & Transactions

**Page:** `/admin/transactions` (`src/pages/admin/AdminTransactions.js`).
**Permission:** `perm:transactions` (admin, agent).

The unified read-only ledger: every `tokenTransaction` plus every long-term
`booking`, merged into one table.

## In plain words

- This is the **history page** — a big list of everything that happened: parking
  bookings, credit purchases, credits used, refunds, late fees.
- Staff can **search** by email, plate, or booking code, and **filter** by type
  or status.
- There's a button to **manually create a transaction** (same pop-up used on the
  check-in screen).
- It's **view-only** — you look things up here, you don't manage bookings from it.
- **Things to watch (see bugs):** it only loads the most recent 500 records (older
  ones silently don't appear), the status labels show in raw English, and the
  "amount" column mixes "lei" with credit counts so the numbers can be confusing.

---

## Flows

### Flow 1 — View / search the ledger
**Entry:** admin opens `/admin/transactions`. Router shows a generic "Loading…"
while three parallel reads resolve: `getAllRecentTransactions(500)`,
`getCollection('bookings')`, `getCollection('users')` — each `.catch(() => [])`.
1. Rows built in memory: each `tokenTransaction` → a row (purchase / use / refund
   / lateFee); each booking with `type==='longTerm'` → a "longTerm" row.
   Credit-type and traveler bookings are skipped (`:87`).
2. Table sorted newest-first (string compare on timestamp), columns: Date · Type ·
   Status · Sumă · Plate · Email · Code. Free-text search + Type/Status selects.
   On long-term rows the **Code is a clickable link** (`reservationCodeHtml` /
   `wireReservationLinks`): it opens the reservation's **full record** at
   `?booking=<id>` — every stored field, fiscal trail, and the booking's own
   audit history (the old read-only detail modal is retired). Credit-transaction
   rows have no reservation, so their code stays plain text.
3. Search filters client-side across `email + plate + code` only (`:171`). The
   selects filter on the row's `type`/`status` string.
4. **Creează tranzacție** opens the shared `CreateTransactionModal` (same modal as
   the check-ins page — see doc 01). On success the **whole page does
   `window.location.reload()`** (`:205`).
**End state:** read-only. No pagination, no filter persistence, no row click-through.

---

## Bugs & inconsistencies

1. **[MED] Status badges are unlocalized raw strings.** Row status renders raw
   `r.status` (`:186`) — `upcoming`, `cancelled`, `paid`, `no-show` — while the
   filter dropdown above shows translated labels (`:124`). English-only in the RO
   default. `no-show` also has no `STATUS_STYLES` entry (`:37`) and no filter
   option, so those rows render default-gray and can't be filtered.
2. **[MED] The "Sumă" column mixes units.** Credit `use` rows show
   `String(quantity)` ("-1"); `purchase`/`refund` show `+N` token counts;
   `lateFee` and longTerm show "… lei" (`:76`, `:92`). The same right-aligned
   column conflates token counts and RON with no unit on the credit rows.
3. **[MED] Silent 500-row cap + swallowed errors.**
   `getAllRecentTransactions(500)` caps at 500 (`:53`); search/filter run only
   over what's loaded, so older records are silently excluded with no "showing
   latest 500" notice. All three loads `.catch(() => [])`, so a Firestore/
   permission failure renders an empty table reading "Nicio tranzacție găsită" —
   indistinguishable from genuinely empty.
4. **[LOW] Date columns ignore Europe/Bucharest.** `fmtMoment` (`:216`) uses
   `toLocale*` without `timeZone`, so dates show in the viewer's browser TZ rather
   than lot-local time.
5. **[LOW] Email column blank for guest credit purchases.** Falls back to
   `tx.billing?.email` (`:81`), but `purchaseTokens`/`creditTokens` write no
   `billing` on `tokenTransactions` (`tokenService.js:55`), so guest credit rows
   always show "—".
6. **[LOW] Full-page reload after create** (`:205`) is a heavy-handed refresh —
   re-fetches everything and loses scroll/filter state, vs re-rendering the table.
7. **[LOW] Customer-facing parallel:** `BookingHistory.renderBookingRow` shows
   `b.totalPrice` (gross) (`:236`); for a voucher/partially-discounted booking
   this is more than the customer was charged. Same root cause as the refund
   over-display (doc 03, Bug 1).

**Correct:** `escapeHtml` is applied on plate/name/email/code; the
`'refund-pending'` status string is used consistently (no `refundPending` drift).
