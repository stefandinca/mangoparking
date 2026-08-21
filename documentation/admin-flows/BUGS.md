# Admin Flows — Bug Register

> **Re-verified against source on 2026-07-31.** Every row below was checked
> directly in the current code — not carried forward from the original audit.
> Each open item cites the file/line that proves it is still open; each closed
> item cites what closed it. Line numbers drift: grep the cited symbol if a
> reference looks off.

The original register (2026-06) was a static snapshot that accumulated fix
notes at the bottom without striking the rows through, so items stayed listed
as open long after they were fixed. That pass reconciled the two: 12 of the
original 33 rows were already fixed, 4 partially, 17 open.

**Updated 2026-08-01** — #2 (over-refund on voucher bookings) and #3 (cash
refunds never reconciled) are now **fixed**; see the closed table below.

**Updated 2026-08-21** — the LT-8DVK5 investigation added #35 (**fixed**:
`adminMarkOrderPaid` never bound the SmartBill secrets, so the POS-card fiscal
invoice shipped on 2026-08-05 has failed on every desk card payment since) and
#36 (**open**: a wrongly-flagged no-show has no recovery path in the UI).
Running total: **15 fixed**, 4 partial, 16 open.

---

## OPEN — money correctness (fix first)

| # | Area | Bug | Evidence |
|---|------|-----|----------|
| 16 | Cashbook | **Cash entries bucket on the UTC day, not the Bucharest day.** `recordCashEntry` stamps `paidAtDay` from `nowIso.slice(0,10)`. Between local midnight and 03:00 (summer, UTC+3) a payment lands on the **previous** day's card and the previous day's close. The dashboard half of this bug was fixed in 2026-06; the cashbook half was not. | `index.js` — `paidAtDay: nowIso.slice(0, 10)` in `recordCashEntry`. Compare `bucharestToday()` in the same file, which exists and does the right thing for SmartBill. |
| 5 | Pricing | **The long-term tier table saves with no validation.** Gaps, overlaps, inverted ranges and `perDay: 0` all persist; the server's `tierForDays` then falls back to the last tier for any uncovered day count, silently mis-pricing. Seasonal periods *do* get overlap detection (`findOverlap`) — the default table never got the same treatment. | `AdminPricing.js:423` — the save handler calls `saveLongTermRates(working)` directly. `pricingValidate.js:46` `tierForDays` is the silent fallback. |

## OPEN — correctness / data integrity

| # | Area | Bug | Evidence |
|---|------|-----|----------|
| 12 | Check-ins | **No idempotency guard on check-in/check-out.** `checkInBooking` reads then writes without a transaction, so two agents (or a double-tap that outruns the confirm) can both assign a spot. *Mitigated but not fixed:* the action now sits behind a confirm dialog and a disabled submit, which narrows the window considerably. Compare `checkInWithCredits`, which claims the plate via `tx.create` in the same transaction as the deduction — that's the pattern to copy. | `bookingService.js:72-112`; contrast `index.js:3718`. |
| 17 | All money pages | **`.catch(() => [])` masks load failures as benign empty states.** A permission error or outage renders "no refunds pending ✓" instead of an error. Worst on the refunds queue, where an empty list reads as "nothing owed". | 20 sites; money-bearing ones at `AdminRefunds.js:133,134,137`, `AdminDashboard.js:113-115`, `AdminReservationDetail.js:172`. |
| 26 | Pricing | **A rate edit breaks in-flight checkouts** with a hard "price mismatch" 400 — the authoritative pricer has 0 RON tolerance by design, and there is no "applies to new bookings only" or preview. A customer mid-funnel when an admin saves gets a dead end. | `pricingValidate.js:16` documents the 0-tolerance choice; `createPayment` rejects on mismatch. |
| 10 | Check-ins | **Long-term check-in never writes an `activeCheckIns` row**, so a long-term car sitting in the lot doesn't hold its plate. A credit check-in on the same plate isn't blocked. *Scope reduced:* the dangling-row half is fixed (check-out and cancel both delete the row with matching normalization). | `bookingService.js:97` writes only the booking; `activeCheckIns` writers are the walk-in/credit callables (`index.js:3280,3432,3718`). |
| 36 | Check-ins | **A wrongly-flagged no-show cannot be recovered from the UI.** When a customer *did* arrive but nothing was recorded, `markNoShows` flips the booking to `no-show` 12h after drop-off — and from there staff can neither take the money nor put the car on the board: the No-show tab deliberately hides Collect (`unpaid && tab !== 'noshow'`), Check-in renders only for `upcoming`, Check-out only for `active`, and cancel is not offered for a no-show. The reservation-detail page still offers **Collect** (it gates on `paymentStatus`, not `status`), but marking paid doesn't clear `status`, so the car stays uncheck-in-able. First hit on LT-8DVK5 (17 Aug, customer paid at the POS, arrived, drove out on the 22nd); repaired with `scripts/reconcile-noshow-arrival.mjs`. Needs a real "customer did arrive" action. | `AdminCheckIns.js:266,279`; `AdminReservationDetail.js:204-206`; `adminMarkOrderPaid` never patches `status`. |
| 22 | Vouchers | Editing a voucher's type or value after redemptions exist gives no warning; day balances are silently re-based against the new value. | `promoVoucherService.js:73` `saveVoucher` — no redemption check. |
| 24 | Vouchers | Deleting a voucher orphans its `voucherDayBalances`; reusing the code resurrects the stale balances. Unfixable client-side — those docs are server-write-only, so this needs a callable. | `firestore.rules:95` (`voucherDayBalances` all writes false); `deleteVoucher` at `promoVoucherService.js:101`. |
| 25 | Vouchers | Delete + recreate doesn't clear `voucherRedemptions`: the global cap resets but the per-identity duplicate block persists, so returning holders stay locked out. Same server-side constraint as #24. | `firestore.rules:87`. |

## OPEN — UX / visibility

| # | Area | Bug | Evidence |
|---|------|-----|----------|
| 32 | Shell | **No sign-out anywhere in the admin panel** — the sidebar footer offers only "Back to site". Staff on a shared desk machine cannot end their session from where they work. | `AdminLayout.js:60-65`. |
| 8b | Shuttle | **"+ Add Departure" is dead.** The button carries `data-add-departure`, but the page's only delegate listens for `[data-action]` and handles `delay`/`cancel`/`depart`. The page's primary action no-ops. *(The `admin.trainToParking` half of this row is fixed — see below.)* | `AdminShuttle.js:41` vs the delegate at `:108-119`. |
| 29 | Shuttle | **"Edit" is dead** — `data-action="edit"` reaches the dispatcher and falls through `else return`. Status writes on mock-id rows fail silently (`.catch(console.error)`), and the summary cards never refresh after a status change. | `AdminShuttle.js:96`, `:118`, `:128`. |
| 31 | Legal | **Saves only the currently-selected locale.** The page buffers both locales in `working[slug][locale]`, but the save handler persists `editLocale` only — edits made in the other tab are silently dropped. | `AdminLegal.js:234` — `saveLegalPage(activeSlug, editLocale, payload)`. |
| 30 | Reviews | Per-row auto-save gives no success feedback (only an error toast), and the visible Save button is `hidden`, so there is no confirmation that anything was written. | `AdminReviews.js:37` (`hidden`), `:94` (error toast only). |
| 23 | Vouchers | No admin visibility into who redeemed what. The "Usage" column shows only `redeemedCount / cap`, which conflates distinct holders with days consumed for splittable vouchers. | `AdminVouchers.js:56-58,76`. |
| 21 | Users | Wide tables clip on mobile — `AdminUsers.js` is the one admin page with no `overflow-x-auto` wrapper (ten others have it). | `AdminUsers.js`. |
| 33 | Check-ins | Mobile uses a horizontally-scrolling table rather than the card layout the v1.7 spec describes. Some responsive trimming exists (`hidden sm:inline` on phone/time), but the table still scrolls. | `AdminCheckIns.js:647`. |
| 9 | Refunds/docs | A fully-voucher-covered cancellation routes to plain `cancelled`, while the v1.9 doc says "refund queue"; the refunds page also has no `paidBy: 'voucher'` label or channel. Money-safe — nothing was charged — but the doc and the code disagree. | `cancelBookingWithRefund` routes only `netopia` / `admin-cash` / `admin-card` to `refund-pending`. |

## OPEN — cosmetic

| # | Area | Bug | Evidence |
|---|------|-----|----------|
| 18b | Transactions | `no-show` has no `STATUS_STYLES` entry, so it renders in the neutral gray fallback rather than a warning colour. Label and filter are fixed; only the colour is missing. | `AdminTransactions.js:55-64`. |
| 19 | Transactions | The "Sumă" column still mixes units: money rows carry `lei`, credit rows show a bare count (`+5`, `-1`). Better than before (the `+` signals credits) but still two scales in one column. | `AdminTransactions.js:109-111`. |
| 27 | Pricing | Pack name/nameRo interpolate into `value="…"` unescaped. Only admins can write `tokenPacks`, so this is a self-inflicted break (an apostrophe truncates the field) rather than a cross-user XSS. | `AdminPricing.js:46-47`. |
| 28 | Pricing | Tier rows use a fixed `grid-cols-12` that doesn't reflow on narrow screens. The surrounding tables did gain `overflow-x-auto`. | `AdminPricing.js:64,510`. |

## LOW / polish (unverified this pass)

Raw `err.message` leaks (Users), generic invalid-email feedback, re-invite can't
change an existing role, full-collection client reads (Users/Vouchers), plate
search doesn't strip spaces, unbounded refund-history query, capacity headline
constant + tooltip plate loss, online-discount silent clamp, dead "add tier
after unlimited", fixed voucher accepts non-integer lei, past-window vouchers
allowed with no notice, hardcoded `'to'` / `'Nume'` strings, Reviews' local
`escape()` divergence, no Quick Actions block, no empty/loading state on
shuttle, legal blank-line hint mismatch, full-page reload after transaction
create. Carried over from the original audit; not re-checked.

---

## FIXED — verified closed

| # | Bug | Closed by |
|---|-----|-----------|
| 35 | **POS-card fiscal invoices never issued — the 2026-08-05 fix was inert** | **2026-08-21.** `adminMarkOrderPaid` gained a `smartbillIssueSafe` call for card collections (decision 1b) but was declared `onCall({ region, cors: true })` with **no `secrets:` array**, so `SMARTBILL_CIF` resolved empty and every desk card payment logged `SmartBill not configured: SMARTBILL_CIF secret is empty` and stamped `smartbill.status='failed'`. Best-effort issuance meant it failed silently — the money flow completed, the document didn't. Found while investigating LT-8DVK5. Fixed by binding `SMARTBILL_SECRETS` on the callable (`index.js:1909`); **needs a functions redeploy to take effect**. **Blast radius: 3 orders, 544 lei** — LT-REDYW (160), LT-U8ZUE (252), LT-MAU6A (132) — all still without a fiscal invoice; backfill with `scripts/backfill-smartbill-invoices.mjs`. Query them with `paidBy == 'admin-card' && smartbill.status == 'failed'`. |
| 34 | **A retried card payment vanished — money taken, no reservation** | **2026-08-14.** Netopia reports the *attempted* action on a decline, which is literally `paid`; the non-success branch stored `status: action`, colliding with the `status === 'paid'` sentinel that means "already fulfilled". The customer's retry then confirmed, and that second IPN was discarded as a replay — no booking, no fiscal invoice, nothing on any admin screen. Fixed at both ends in `netopia.js`: `failureStatusFor()` collapses impersonating actions to `'failed'` (keeping `canceled`/`credit`), and `isFulfilledOrder()` now requires evidence the success branch ran (`bookingId \|\| balanceDocId \|\| paidBy`) at both the entry guard and the lease transaction. Every IPN now logs `{orderId, action, errorCode}`. 10 regression cases in `functions/test/netopia.ipn.test.js` built from the real doc shapes. **6 orders hit this since May 2026** — see [payments-netopia.md](../backend/payments-netopia.md#incident-2026-08-12--a-retried-payment-was-swallowed). |
| 2 | **Over-refund on voucher bookings** | **2026-08-01.** The refund figure is now computed server-side by `resolveChargedAmount` (charged order amount + `extensionPrice` + `latePrice`, gross `totalPrice` only as the desk-sale fallback) and **pinned on the booking** — `refundAmount` at cancel, `refundedAmount` at mark-refunded. Every surface reads that one number: the queue, its dialog, the dashboard tile (which had the same bug independently), the audit payload and the refund-issued email (which was also quoting the gross). Client mirror `refundDueFrom` is pure + unit-tested (`tests/refundAmount.test.mjs`, 12 cases); legacy rows without the pinned field derive from their linked order. A tooltip explains any amount that differs from the list price. |
| 3 | **Cash refunds never reconciled** | **2026-08-01.** `adminMarkRefunded` and `adminResolvePendingRefund` now write a negative `cashEntries` row (`source: 'refund'`) when `refundedVia === 'cash-returned'`, so the drawer, the close-out and the printed report net out. Keyed on the refund channel rather than the original payment method; a reversing row rather than a deletion (the original may already be closed into a report); negatives are opt-in per call site so other callers keep their old drop-on-negative guard. |
| 1 | `{{ … }}` i18n keys never interpolated | 2026-07-23 — all 8 keys rewritten to single-brace. **Verified:** no `{{` remains in `ro.js`/`en.js`. `t()`'s single-brace regex is now the documented convention. |
| 4 | Credit/commuter check-ins invisible & uncheckoutable | `createCreditCheckInBooking` (`index.js:3616`) writes a real `bookings` doc; `checkInWithCredits` (`:3660`) calls it; the board subscribes to `status in [upcoming, active, no-show]`, so credit check-ins appear on Check-out like any other. |
| 6 | Audit content rendered unescaped (XSS) | 2026-07-27 — `AdminDashboard.js:247-250` escapes timestamp, badge, description and actor. |
| 7 | No-show plate-normalization mismatch | `scheduled.js:327` now strips spaces **and** hyphens, matching `normalizePlate`. Both cleanup paths agree: `checkOutBooking` (`bookingService.js:133`) and `cancelBookingWithRefund` (`index.js:2533`). |
| 8a | `admin.trainToParking` key missing | Present in both locales at `ro.js:123` / `en.js:123`. |
| 11 | AdminCheckIns listener + popstate leak | The page returns a cleanup the router invokes (`AdminCheckIns.js:971`). |
| 13 | Pay-at-pickup amount not shown; collection unguarded | `openCollectPaymentDialog` (`bookingActions.js:419`) leads with the amount due, refines it from the order's authoritative `amount`, and confirms before recording. `checkInBooking` also hard-refuses an unpaid booking (`UNPAID_BOOKING`, `bookingService.js:80`). |
| 14 | Overstay charge button was a dead placeholder | `openOverstayDialog` → `adminChargeOverstay`; check-out now *forces* the overstay prompt and requires an explicit "check out anyway" override to skip it (`bookingActions.js:632-648`). |
| 15 | No no-show surface; `markNoShows` missed `dropoffAt: null` | A No-show tab exists on the check-in board; `markNoShows` filters in memory and falls back to `startDate` (`scheduled.js:311-313`). |
| 18a | Status badges raw/unlocalized; no `no-show` filter | `reservationStatusLabel` localizes with a `—`/raw-value fallback; `no-show` is in the filter options (`AdminTransactions.js:280`). |
| 20 | Stored XSS in the users delete confirm | `AdminUsers.js:234` escapes into `safeName` before the `dataset` round-trip. |
| — | Everything in the 2026-06 and 2026-07 waves | See *Fix history* below. |

---

## Fix history

The detailed per-wave records — what was applied and why — moved to
[archive/bug-fix-waves.md](../archive/bug-fix-waves.md): the 2026-06 deep review
(repay pricing, promo double-redeem race, handover reconciliation, dashboard
timezone, listener leak), the 2026-07 modal-lifecycle / walk-in-billing wave,
the timezone + Safari wave, the backend/rules hardening wave, and the
orphaned-guest-bookings wave.

## Known limits — reviewed, deliberately not fixed

- **Non-atomic money accumulators** (`adminChargeOverstay`, `adminRepriceBooking`
  extension branch, `grantCreditsForCash` walk-in): the booking mutation, the
  ledger row and the cashbook entry are separate awaits, so a mid-sequence
  failure + retry can double-add `latePrice`/`extensionPrice`. Needs an
  idempotency-key design.
- **Promo redemption is committed at order creation, not released on an
  abandoned or declined online payment** — a one-shot code is burned and a
  days-balance loses days even though nothing was paid. Proper fix: write the
  redemption `pending`, finalize or roll back on IPN outcome, plus a sweep for
  abandoned holds. Spans the money-critical IPN path.
- **`adminMarkOrderUnpaid`'s cash-row deletion is post-transaction
  best-effort** — a failure leaves the drawer overstating cash (reversal-path
  sibling of #3).
- **Expired pay-later orders leave a phantom `upcoming` booking** —
  `expireStaleHolds` flips only the order.
- **Reprice across a seasonal boundary bills the whole stay at the pick-up
  day's period rate.** Consistent with how the booking was priced originally,
  but the settle difference can surprise. Product decision, not a code fix.

> Note: the IPN double-fulfilment risk listed here previously **was** fixed —
> `netopiaCallback` now claims the order transactionally via
> `pendingOrders.ipnProcessingAt` (5-minute lease) before fulfilment.

## Suggested fix order

1. ~~**Money correctness** — #2 (refund amount source), #3 (cash-refund
   reconciliation)~~ — **done 2026-08-01**. **#16 (cashbook UTC day)** is the
   remaining financial discrepancy: small and contained, and
   `bucharestToday()` already exists in the same file.
2. **#5 tier-table validation** — cheap to add, prevents silent mis-pricing.
   Reuse the shape of the seasonal `findOverlap` check.
3. **#32 sign-out** — one-line addition, real security hygiene on shared
   machines.
4. **The dead buttons** — #8b, #29, #30, #31. Each is small and each currently
   loses staff work or wastes their time.
5. **#12 idempotent check-in** — copy the `tx.create` claim pattern from
   `checkInWithCredits`.
6. Everything else as normal backlog, batched by file.
