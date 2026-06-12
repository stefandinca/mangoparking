# Admin Flows — Consolidated Bug Register

Severity-ranked across all admin flows. Each row links to the flow doc with the
full context. Verified items are marked ✔ (re-confirmed directly against source
during this review).

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
