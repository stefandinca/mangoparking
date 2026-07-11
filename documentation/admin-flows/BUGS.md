# Admin Flows — Consolidated Bug Register

Severity-ranked across all admin flows. Each row links to the flow doc with the
full context. Verified items are marked ✔ (re-confirmed directly against source
during this review).

> **⚠️ Read this first (status, 2026-07-01).** This register is a *static
> snapshot* from the original admin-flows audit. A **2026-06 deep-review pass
> fixed a batch of the items** — see the **"2026-06 deep review"** section at the
> bottom of this file for exactly what was applied (repay pricing, promo
> double-redeem race, handover/mark-unpaid cashbook reconciliation, overstay
> `0 lei` display, dashboard UTC→Bucharest, the AdminCheckIns listener leak,
> `saveVoucher` count rollback, and more). The HIGH/MEDIUM rows below were **not
> struck through individually**, so before actioning any row, cross-check it
> against that "applied" list. Known-still-open highlights: the `{{ }}` i18n
> interpolation bug (#1), over-refund on voucher bookings (#2), cash-refund
> reconciliation (#3), and the two XSS sinks (#6, #20).

## HIGH — fix first

| # | Area | Bug | Symptom | Ref |
|---|------|-----|---------|-----|
| 1 | All | ✔ **`{{ … }}` i18n keys never interpolate.** `t()` regex is `/\{(\w+)\}/g` (`i18n/index.js:60`) — single brace only. Every double-brace key shows its braces. Affects `vouchers.deleteConfirm`/`errorCodeTaken`, `refunds.historySubtitle`/`failedCount`/`resendOk`, `seasonal.deleteConfirm`/`errorOverlap`/`appliedBadge` — **both locales**. | Admins (and on `appliedBadge`, customers) see "Ștergi voucherul {{ code }}?", "Email retrimis către {{ recipient }}…" verbatim. | [03](03-cancellations-refunds-cashbook.md), [05](05-vouchers-promotions-pricing-capacity.md) |
| 2 | Refunds | ✔ **Over-refund on voucher bookings.** Refund queue/dialog/dashboard/audit show `booking.totalPrice` (gross, pre-voucher; `index.js:209`); the charged amount is `pendingOrders.amount` (`index.js:405`). | Admin refunds more than the customer ever paid, by the discount. | [03](03-cancellations-refunds-cashbook.md) #1 |
| 3 | Cashbook | **Cash refunds never reconciled.** Marking an admin-cash booking refunded writes no reversing `cashEntries` row. | Cashbook + printed report overstate cash on hand after every cash refund; agent "owes" returned money. | [03](03-cancellations-refunds-cashbook.md) #2 |
| 4 | Check-ins | **Credit/commuter check-ins invisible & uncheckoutable.** Page subscribes only to `bookings` (`AdminCheckIns.js:507`); credit check-ins write `activeCheckIns` + tx, no booking. `tokenService.checkOut` is imported by no page. | Commuter checked in via credits never appears on any tab; spot stuck `occupied` with no UI to release. Contradicts v1.8 doc. | [01](01-checkin-checkout-walkin.md) #1 |
| 5 | Pricing | **Long-term tier table has no validation.** Gaps/overlaps/inverted ranges/`perDay=0` all save; server falls back to the last tier for uncovered days. | Misconfigured tiers silently mis-price bookings (e.g. day-7 gap bills at catch-all rate). | [05](05-vouchers-promotions-pricing-capacity.md) #2 |
| 6 | Dashboard | ✔ **Audit content rendered unescaped (XSS).** No `escapeHtml` import; `describeAction` interpolates user-supplied `email`/`name` into `innerHTML`. | Crafted display name/email injects markup into the dashboard. | [06](06-dashboard-shuttle-reviews-legal.md) #3 |
| 7 | Check-ins | **No-show plate normalization mismatch.** `normalizePlate` strips spaces+hyphens; cleanup/`markNoShows` strip spaces only. | Hyphenated-plate arrival can be flagged no-show; cancel leaves a dangling `activeCheckIns` row. | [01](01-checkin-checkout-walkin.md) #2 |
| 8 | Shuttle | **`admin.trainToParking` key missing** in both locales; **"+ Add Departure" button dead.** | A schedule row shows the literal key; the page's primary action no-ops. | [06](06-dashboard-shuttle-reviews-legal.md) #1,#2 |

## MEDIUM

| # | Area | Bug | Ref |
|---|------|-----|-----|
| 9 | Refunds/docs | Fully-voucher cancellation: v1.9 doc says "refund queue", code routes it to plain `cancelled`; refund page has no `paidBy:'voucher'` label/channel either. Money-safe but inconsistent. | [03](03-cancellations-refunds-cashbook.md) #3 |
| 10 | Check-ins | `activeCheckIns` lifecycle inconsistent — check-in tab doesn't write it, check-out never deletes it → dangling rows / false `ALREADY_CHECKED_IN`. | [01](01-checkin-checkout-walkin.md) #4 |
| 11 | Check-ins | Listener + popstate leak; page returns no cleanup, sidebar nav uses `pushState` (no popstate). Listeners accumulate. | [01](01-checkin-checkout-walkin.md) #5 |
| 12 | Check-ins | Double-click race: live re-render replaces the disabled button; no idempotency guard on check-in/out → double spot assignment. | [01](01-checkin-checkout-walkin.md) #6 |
| 13 | Check-ins | Pay-at-pickup amount not shown on the row; collection optional & unguarded — car can leave unpaid. | [01](01-checkin-checkout-walkin.md) #7 |
| 14 | Check-ins | Overstay charge button is a dead placeholder. | [01](01-checkin-checkout-walkin.md) #3 |
| 15 | Refunds | No No-show surface; `markNoShows` misses bookings with `dropoffAt:null` (they stay `upcoming` forever). | [03](03-cancellations-refunds-cashbook.md) #5 |
| 16 | Cashbook/Dashboard | UTC vs Europe/Bucharest day boundaries — cashbook buckets, dashboard "today" stats, most date columns drift overnight. | [03](03-cancellations-refunds-cashbook.md) #6,#7, [06](06-dashboard-shuttle-reviews-legal.md) #7 |
| 17 | All money pages | `.catch(() => [])` masks load failures as benign empty states ("Nicio rambursare ✓"). | [02](02-reservations-transactions.md) #3, [03](03-cancellations-refunds-cashbook.md) #8 |
| 18 | Transactions | Status badges raw/unlocalized; `no-show` has no style and no filter option. | [02](02-reservations-transactions.md) #1 |
| 19 | Transactions | "Sumă" column mixes token counts and RON with no unit. | [02](02-reservations-transactions.md) #2 |
| 20 | Users | Stored-XSS in delete confirm via `dataset` round-trip into `confirmModal` `innerHTML`. | [04](04-users-accounts-roles.md) #1 |
| 21 | Users | Wide tables clipped on mobile (no `overflow-x-auto`). | [04](04-users-accounts-roles.md) #2 |
| 22 | Vouchers | Editing type/value after redemptions: no warning; days balances silently zeroed/re-granted. | [05](05-vouchers-promotions-pricing-capacity.md) #3 |
| 23 | Vouchers | No admin visibility into redemptions / day-balances; "Usage" column conflates holders vs days. | [05](05-vouchers-promotions-pricing-capacity.md) #4 |
| 24 | Vouchers | Delete orphans `voucherDayBalances`; reusing a code resurrects stale balances. | [05](05-vouchers-promotions-pricing-capacity.md) #5 |
| 25 | Vouchers | Delete/recreate doesn't reset `voucherRedemptions` — global cap resets but per-identity dup-block persists. | [05](05-vouchers-promotions-pricing-capacity.md) #6 |
| 26 | Pricing | Edits break in-flight checkouts with a hard "price mismatch" 400; no "new bookings only", no preview. | [05](05-vouchers-promotions-pricing-capacity.md) #7 |
| 27 | Pricing | Pack name rendered unescaped into `value=""`. | [05](05-vouchers-promotions-pricing-capacity.md) #8 |
| 28 | Pricing | Tier rows / modal non-responsive on mobile. | [05](05-vouchers-promotions-pricing-capacity.md) #9 |
| 29 | Shuttle | "Edit" button dead; status writes silently fail on mock ids; summary cards never refresh. | [06](06-dashboard-shuttle-reviews-legal.md) #4,#5,#6 |
| 30 | Reviews | Auto-save gives no success feedback; visible Save button is hidden/dead. | [06](06-dashboard-shuttle-reviews-legal.md) #8 |
| 31 | Legal | Saves only the active locale per click; other-locale edits silently lost. | [06](06-dashboard-shuttle-reviews-legal.md) #9 |
| 32 | Shell | No sign-out anywhere in the admin panel. | [06](06-dashboard-shuttle-reviews-legal.md) #10 |
| 33 | Check-ins | Mobile uses a horizontally-scrolling table, not the documented card layout. | [01](01-checkin-checkout-walkin.md) #8 |

## LOW / polish

Raw `err.message` leaks (Users), generic invalid-email feedback, `fmtDate` vs
Firestore Timestamp, re-invite can't change an existing role, full-collection
client reads (Users/Vouchers), plate search doesn't strip spaces, unbounded refund
history query, missing re-entrancy guards on refund/handover buttons, capacity
headline constant + tooltip plate loss, online-discount silent clamp, dead
"add tier after unlimited", fixed voucher accepts non-integer lei, past-window
vouchers allowed with no notice, hardcoded `'to'` / `'Nume'` strings, dead code/
unused imports, Reviews local `escape()` divergence, no Quick Actions block, no
empty/loading state on shuttle, legal blank-line hint mismatch, dashboard missing
review/legal action badges, full-page reload after transaction create. See the
per-flow docs for line refs.

---

## Suggested fix order

1. **One-liners with outsized reach:** the `{{ }}` i18n bug (#1) — either fix the
   regex to also accept `{{ name }}` or rewrite the ~8 keys to single-brace. This
   alone clears visible-text breakage across vouchers, refunds, and seasonal.
2. **Money correctness:** refund amount source (#2), cash-refund reconciliation
   (#3) — these are real financial discrepancies.
3. **Security:** the two XSS sinks (#6 dashboard, #20 users delete) — small,
   contained fixes.
4. **The check-in data-model gap (#4)** — the biggest structural item; surfacing
   credit check-ins on the Check-out tab needs either an `activeCheckIns`
   subscription on the page or a booking-shaped record for credit check-ins.
   Worth a short design note before coding.
5. Everything else as normal backlog, batched by file.

> None of these were changed during this review — it is read-only documentation.
> Recommend smoke-testing the "dead button" items (#8 Add Departure, #29 Edit) in
> a browser before fixing, in case a handler is wired in a path not covered here.

---

## 2026-06 deep review — voucher / booking / admin (applied this round)

Fixed in this pass (verified: vite build, `node --check`, i18n parity 1357/1357,
headless smoke of both booking pages):

- **Repay stored the standard price, not the discounted charge.** The IPN repay
  branch patched only payment fields, leaving the pre-created booket at the
  standard `totalPrice`; it now reconciles `totalPrice`/`basePrice`/order `amount`
  to `repayAmount`. (`functions/src/index.js`, IPN longTerm repay)
- **Fixed/percent promo double-redeem race.** The in-transaction dup check was a
  non-transactional `where` query writing an auto-id doc. Fixed/percent now use a
  deterministic `voucherRedemptions/{CODE}_{identityKey}` id with `tx.create`, so a
  concurrent second redemption is rejected. (`createPayment`)
- **Online promo redemptions never got their `bookingId`.** IPN now stamps it
  (mirrors the free-order path). (`netopiaCallback`)
- **Handover recorded by an admin for another agent dropped from that agent's
  closed cashbook.** `closeCashbook` matched `handedBy`; now matches the cash
  owner (`forAgentUid`, falling back to `handedBy`).
- **mark-unpaid left the cash-drawer entry.** `adminMarkOrderUnpaid` now deletes
  the OPEN `cashEntries` row it reversed (closed/reported entries untouched).
- **Overstay late-fee always showed `0 lei`** in /admin/transactions — read
  `tx.amount`, not the non-existent `tx.feeAmount`. (`AdminTransactions.js`)
- **Dashboard `today` tallies used UTC**, disagreeing with the Bucharest-day
  chart — now both use Europe/Bucharest. (`AdminDashboard.js`)
- **AdminCheckIns bookings listener leaked** on SPA navigation (torn down only on
  `popstate`) — page now returns a cleanup the router invokes.
- **`saveVoucher` could roll `redeemedCount` back** to a stale list value on edit —
  now preserves the live server count. (`promoVoucherService.js`)
- **Credits headline ignored the applied promo** — now shows the post-voucher
  total like the long-term page. (`BookingCredits.js`)
- **Voucher rejected at pay time showed a generic error** — both booking pages now
  strip the dead code and show `voucher.payFailed`.
- Removed dead `data-pay-total`/`data-paymethod-amount` refs left by the accordion
  rebuild. (`BookingLongTerm.js`)

### Deferred (need Netopia-sandbox testing before touching the capture path)

- **Promo redemption is committed at order creation, not released on an
  abandoned/declined/cancelled online payment** — a one-shot code is burned and a
  days-balance loses days even though nothing was paid. Proper fix: write the
  redemption `pending` and finalize/roll back on IPN outcome + on cancel/refund,
  plus a scheduled sweep for abandoned holds. High value, but spans the
  money-critical IPN path.
- **IPN fulfilment is not transactional** — the `status===paid` idempotency guard
  is a non-atomic read, so two near-simultaneous Netopia confirmations could
  double-create a booking / double-grant credits. Fix: claim+fulfil inside a
  transaction or key the booking doc by order id.

---

## 2026-07 deep review — modal lifecycle / walk-in billing (applied this round)

Triggered by a client report: a manual reservation "cancelled half-way" on a
phone appeared to resurface its dates in a reservation created later on a
laptop. Investigation conclusion: **no code path syncs unsaved form state
across devices** (no drafts, no localStorage, `autocomplete="off"`, dates read
from the DOM only at submit) — but a submit whose HTTPS callable was still in
flight COULD be "cancelled": the modal's Cancel button, backdrop and Escape
stayed active during the await, dismissing the form while the server went on
to create the booking. The staff member then believes nothing was saved. The
ghost booking (with the phone's dates) later shows up next to the genuinely new
reservation and reads as "my new booking got the old dates". Check
`bookings.createdBy` + `auditLog` for two `booking_created` entries by the same
uid to confirm any specific incident.

Fixed in this pass (verified: vite build + a Puppeteer runtime harness driving
the real modal — 14/14 checks: lock while in flight, unlock on error, picker
teardown, days payload):

- **Modals stayed cancellable while a submit was in flight.** Create-transaction
  (all three branches: long-term/credit-sale, credit check-in, transfer), the
  edit-booking dialog, the collect-payment dialog and the overstay dialog now
  disable Cancel and suspend backdrop/Escape dismissal (`setDismissible(false)`)
  for the duration of the request, restoring them on error.
  (`CreateTransactionModal.js`, `AdminCheckIns.js`, `Modal.js`)
- **`openModal` leaked its Escape handler.** The document-level keydown listener
  was only removed when Escape itself closed the modal; closing via button,
  backdrop or code left it attached forever. `close()` now always removes it,
  and is guarded against double-invocation. (`Modal.js`)
- **flatpickr calendars outlived their modal.** The pickers' calendar overlays
  live on `document.body`; closing a modal (esp. mid-pick on mobile) left them
  orphaned — visibly stuck on screen if open, and swallowing taps aimed at a
  later modal's picker. `close()` now destroys any `data-datetime` picker
  mounted in the modal via its `__fpInstance`. (`Modal.js`, key documented in
  `FormDateTime.js`)
- **Admin walk-in `days` ignored the 2h grace.** The create-transaction submit
  sent `ceil((pickup−dropoff)/24h)` while the auto-filled price used the graced
  `walkInBillingDays` (and the public funnel + server reprice use the same
  graced rule) — a 25h stay was priced as 1 day but stored `days: 2`, skewing
  the `totalPrice/days` per-day rate that overstay and reprice math derive.
  Now uses `walkInBillingDays`. (`CreateTransactionModal.js`)

Second wave (from the same review, verified with a Puppeteer run emulating an
America/New_York browser — 15/15 checks incl. TZ-pinned payloads):

- **Stored booking instants depended on the DEVICE timezone.** Every picker
  submit path converted the flatpickr wall-clock (`Y-m-d H:i`) to ISO via the
  device's timezone, while emails/admin render pinned to Europe/Bucharest — a
  customer abroad (or a staff device with a mis-set clock) silently created a
  TZ-shifted booking. Picked times now ALWAYS mean Europe/Bucharest, via
  `bucharestLocalToIso`/`isoToBucharestLocal` (`src/utils/date.js`), used by
  the public funnel, the admin create modal (defaults + submit + transfer
  prefill) and the edit/reprice dialog. This also makes the client's
  seasonal-tier day match the server's Bucharest-day derivation near period
  boundaries (was: possible hard "price mismatch" for out-of-TZ browsers).
- **Editing a legacy date-only booking fired a spurious reprice.** The edit
  dialog's "current dates" baseline (local midnight) disagreed with the picker
  prefill (UTC midnight) for bookings without `dropoffAt`, so ANY save — even a
  phone-number fix — reported changed dates and called `adminRepriceBooking`,
  rewriting the booking's dates to 03:00. The baseline is now the round-trip of
  the actual prefill, so untouched pickers always compare equal. (`AdminCheckIns.js`)
- **Safari/iOS could not complete a long-term booking.** `recompute()` parsed
  the space-separated picker value with `new Date()` (Invalid Date on WebKit) —
  quote stuck at "—" and submit sent `totalPrice: 0`, which the server rejects.
  Now parses via the shared helper. (`BookingLongTerm.js`)
- **Time-slider could silently WIPE the picked date.** flatpickr's `setDate`
  filters (clears) out-of-range dates instead of clamping — dragging the slider
  below the min time on the min day emptied the field with no feedback. The
  slider now clamps to minDate/maxDate; its bubble also shows the true
  committed minutes (was: grid-rounded display disagreeing with the value), and
  its no-selection base is a fresh `new Date()` (was: frozen `instance.now`,
  which back-dated after midnight). Preloaded values filtered by min/max are
  cleared from the hidden input (an empty-looking field could submit an
  invisible date). (`FormDateTime.js`)
- **Clearing the pick-up via a drop-off move left a stale quote.**
  `set('minDate')` empties the pick-up without a native change event; the
  summary kept showing the old days/total. The drop-off handler now recomputes
  unconditionally. (`BookingLongTerm.js`)
- **Validation errors on date fields were invisible** — `setFieldError` styled
  the flatpickr-hidden original input; it now styles the visible altInput.
  (`utils/dom.js`)
- **Stored XSS via billing fields.** `billingFieldsHtml` interpolated
  profile-stored billing values into `value="…"` unescaped; a crafted
  companyName in a customer profile executed in the ADMIN's browser when
  opening that customer (UserDetailModal renders the same block). All eight
  attributes are now escaped. (`BillingFields.js`)
- **Credits funnel showed a stale voucher discount.** A percent code's
  `discountAmount` was computed once at apply time; switching packs (or payment
  method) kept subtracting the old amount, so the shown total diverged from
  what `createPayment` charges. The discount is now re-derived from the live
  base on every summary refresh, mirroring the long-term page. (`BookingCredits.js`)
- **Spot status flips threw permission-denied for agents/drivers.**
  `updateSpotStatus` still incremented the legacy admin-only
  `settings/global.occupiedSpots` counter (which nothing reads — capacity
  aggregates the spots collection), failing AFTER the spot doc changed and
  rolling back the capacity-map UI to a wrong state. Counter write removed.
  (`capacityService.js`)
- **Capacity-map tiles were painted once at mount.** Another device's check-in
  updated the legend but not the tiles; the stale green tile also hand-cycled a
  real occupancy's status when clicked. Tiles + spot→booking maps now refresh
  on a live spots subscription. (`AdminCapacity.js`)
- **Check-ins custom-range flatpickr leaked one calendar per live re-render**
  (the destroy guard checked the NEW node), and mid-selection state was torn
  down by every bookings snapshot. The instance is now tracked in the page
  closure and destroyed before each window-bar rebuild + on route cleanup.
  (`AdminCheckIns.js`)
- **Searching couldn't find bookings outside the date window.** The check-in /
  check-out / no-show / transfers filters ANDed the search with the window, so
  an early-arriving long-term customer was unfindable by exact plate on the
  Check-out tab. A non-empty search now bypasses the window (global finder).
  (`AdminCheckIns.js`)
- Check-in board timestamps now render pinned to Europe/Bucharest (matches
  BookingDetailModal + emails). (`AdminCheckIns.js`)
