# Bug-fix waves — historical record

> **Historical.** Moved out of [admin-flows/BUGS.md](../admin-flows/BUGS.md) on
> 2026-07-31 so the register could become a clean open/closed list. This file is
> the provenance record of *what was changed and why* across the review passes.
> For current bug status, read BUGS.md — not this file.

---

## 2026-06 deep review — voucher / booking / admin

Verified at the time: vite build, `node --check`, i18n parity 1357/1357,
headless smoke of both booking pages.

- **Repay stored the standard price, not the discounted charge.** The IPN repay
  branch patched only payment fields, leaving the pre-created booking at the
  standard `totalPrice`; it now reconciles `totalPrice`/`basePrice`/order
  `amount` to `repayAmount`. (`functions/src/index.js`, IPN longTerm repay)
- **Fixed/percent promo double-redeem race.** The in-transaction dup check was a
  non-transactional `where` query writing an auto-id doc. Fixed/percent now use
  a deterministic `voucherRedemptions/{CODE}_{identityKey}` id with `tx.create`,
  so a concurrent second redemption is rejected. (`createPayment`)
- **Online promo redemptions never got their `bookingId`.** The IPN now stamps
  it, mirroring the free-order path. (`netopiaCallback`)
- **A handover recorded by an admin for another agent dropped out of that
  agent's closed cashbook.** `closeCashbook` matched `handedBy`; it now matches
  the cash owner (`forAgentUid`, falling back to `handedBy`).
- **Mark-unpaid left the cash-drawer entry.** `adminMarkOrderUnpaid` now deletes
  the OPEN `cashEntries` row it reversed (closed/reported entries untouched).
- **Overstay late-fee always showed `0 lei`** in /admin/transactions — it read
  `tx.feeAmount`, which doesn't exist, instead of `tx.amount`.
  (`AdminTransactions.js`)
- **Dashboard "today" tallies used UTC**, disagreeing with the Bucharest-day
  chart — both now use Europe/Bucharest. (`AdminDashboard.js`)
- **AdminCheckIns' bookings listener leaked** on SPA navigation (torn down only
  on `popstate`) — the page now returns a cleanup the router invokes.
- **`saveVoucher` could roll `redeemedCount` back** to a stale list value on
  edit — it now preserves the live server count. (`promoVoucherService.js`)
- **The credits headline ignored the applied promo** — it now shows the
  post-voucher total like the long-term page. (`BookingCredits.js`)
- **A voucher rejected at pay time showed a generic error** — both booking pages
  now show `voucher.payFailed`.
- Removed dead `data-pay-total` / `data-paymethod-amount` refs left by the
  accordion rebuild. (`BookingLongTerm.js`)

---

## 2026-07 — modal lifecycle / walk-in billing

Triggered by a client report: a manual reservation "cancelled half-way" on a
phone appeared to resurface its dates in a reservation created later on a
laptop. Investigation conclusion: **no code path syncs unsaved form state across
devices** (no drafts, no localStorage, `autocomplete="off"`, dates read from the
DOM only at submit) — but a submit whose HTTPS callable was still in flight
COULD be "cancelled": the modal's Cancel button, backdrop and Escape stayed
active during the await, dismissing the form while the server went on to create
the booking. The staff member then believes nothing was saved. The ghost booking
(with the phone's dates) later shows up next to the genuinely new reservation
and reads as "my new booking got the old dates". Check `bookings.createdBy` +
`auditLog` for two `booking_created` entries by the same uid to confirm any
specific incident.

Verified: vite build + a Puppeteer harness driving the real modal, 14/14 checks.

- **Modals stayed cancellable while a submit was in flight.**
  Create-transaction (all three branches), the edit-booking dialog, the
  collect-payment dialog and the overstay dialog now disable Cancel and suspend
  backdrop/Escape dismissal (`setDismissible(false)`) for the duration of the
  request, restoring them on error.
- **`openModal` leaked its Escape handler.** The document-level keydown listener
  was removed only when Escape itself closed the modal. `close()` now always
  removes it and is guarded against double-invocation. (`Modal.js`)
- **flatpickr calendars outlived their modal.** The overlays live on
  `document.body`; closing a modal left them orphaned — visibly stuck if open,
  and swallowing taps aimed at a later modal's picker. `close()` now destroys
  any `data-datetime` picker via its `__fpInstance`.
- **Admin walk-in `days` ignored the 2h grace.** The submit sent
  `ceil((pickup−dropoff)/24h)` while the auto-filled price used the graced
  `walkInBillingDays` — a 25h stay priced as 1 day but stored `days: 2`, skewing
  the `totalPrice/days` rate that overstay and reprice math derive.

---

## 2026-07 — timezone + Safari wave

Verified with a Puppeteer run emulating an America/New_York browser, 15/15
checks including TZ-pinned payloads.

- **Stored booking instants depended on the DEVICE timezone.** Every picker
  submit path converted the flatpickr wall-clock to ISO via the device's
  timezone, while emails/admin render pinned to Europe/Bucharest — a customer
  abroad silently created a TZ-shifted booking. Picked times now ALWAYS mean
  Europe/Bucharest via `bucharestLocalToIso` / `isoToBucharestLocal`. This also
  makes the client's seasonal-tier day match the server's Bucharest-day
  derivation near period boundaries.
- **Editing a legacy date-only booking fired a spurious reprice.** The edit
  dialog's "current dates" baseline (local midnight) disagreed with the picker
  prefill (UTC midnight), so ANY save — even a phone-number fix — reported
  changed dates and rewrote them to 03:00. The baseline is now the round-trip of
  the actual prefill.
- **Safari/iOS could not complete a long-term booking.** `recompute()` parsed
  the space-separated picker value with `new Date()` (Invalid Date on WebKit) —
  the quote stuck at "—" and submit sent `totalPrice: 0`, which the server
  rejects.
- **The time slider could silently WIPE the picked date.** flatpickr's `setDate`
  clears out-of-range dates instead of clamping. The slider now clamps to
  minDate/maxDate, its bubble shows the true committed minutes, and its
  no-selection base is a fresh `new Date()`.
- **Clearing the pick-up via a drop-off move left a stale quote.**
  `set('minDate')` empties the pick-up without a native change event; the
  drop-off handler now recomputes unconditionally.
- **Validation errors on date fields were invisible** — `setFieldError` styled
  the flatpickr-hidden original input; it now styles the visible altInput.
- **Stored XSS via billing fields.** `billingFieldsHtml` interpolated
  profile-stored billing values into `value="…"` unescaped; a crafted
  companyName executed in the ADMIN's browser. All eight attributes escaped.
- **The credits funnel showed a stale voucher discount.** A percent code's
  `discountAmount` was computed once at apply time; switching packs kept
  subtracting the old amount. It is now re-derived from the live base.
- **Spot status flips threw permission-denied for agents/drivers.**
  `updateSpotStatus` still incremented the legacy admin-only
  `settings/global.occupiedSpots` counter (which nothing reads), failing AFTER
  the spot doc changed. Counter write removed.
- **Capacity-map tiles were painted once at mount** — they now refresh on a live
  spots subscription.
- **The check-ins custom-range flatpickr leaked one calendar per re-render**
  (the destroy guard checked the NEW node). The instance is now tracked in the
  page closure.
- **Searching couldn't find bookings outside the date window** — a non-empty
  search now bypasses the window (global finder).
- Check-in board timestamps render pinned to Europe/Bucharest.

---

## 2026-07 — backend + rules hardening

- **createPayment spread the raw request body into `pendingOrders`.** A caller
  could smuggle server-owned fields into the order — most severely `bookingId`:
  the IPN honors `pending.bookingId` by patching that booking to `paid`, so a
  cheap 1-day online charge could flip an arbitrary 30-day pay-at-pickup booking
  to paid; an injected `repayAmount` could rewrite its stored price. The order
  doc is now built from an explicit whitelist, and the IPN additionally refuses
  `pending.bookingId` on non-pay-at-pickup orders.
- **Firestore rules let anyone mint credit balances / forge bookings.**
  `tokenBalances` had `create: if true` and world-writable `plate_*` docs (mint a
  balance → staff plate-lookup deducts from it = free parking; read guest PII);
  `bookings` had `create: isAuthenticated()` + owner update (forge a paid/active
  booking, or flip your own pay-at-pickup booking to `paid`). Both are now
  staff-write only.
- **`mergeGuestData` trusted an unverified email.** Registering with a victim's
  address absorbed their guest balances, bookings and PII. The merge now
  requires `email_verified`.
- **`checkInWithCredits` could double-charge on concurrent submits.** The
  ALREADY_CHECKED_IN guard was a plain read before the balance transaction. The
  plate is now claimed via `tx.create` on `activeCheckIns/{plate}` inside the
  same transaction as the deduction.
- **The check-out reminder e-mailed before drop-off** — the 24h-before-pickup
  branch had no status gate. Now `active`-only.
- `lookupCui` no longer fails a successful ANAF lookup when the cache write
  blips.

---

## 2026-07 — orphaned guest bookings

Client incident LT-D96ZN: a web reservation with `customerId: null` never
appeared in the customer's profile, which lists — and rules-wise may only read —
bookings keyed to the uid.

- **The guest-merge never ran on invite completion.** `mergeGuestData` was called
  only from Login/Register, so a customer whose account was created via a staff
  invite (the usual follow-up to a manual reservation) never got earlier
  bookings linked. FinishSignup now runs the merge after the email-link sign-in.
- **Email matching was case-sensitive.** Bookings/balances stored the email as
  typed (phone keyboards auto-capitalize) while the merge compared against the
  lowercased auth email with exact equality — `Roxana@…` never matched
  `roxana@…`. Emails are now stored lowercased at every write point, and
  `mergeGuestData` matches legacy mixed-case docs in memory, so no backfill is
  needed.
- **Manual reservations only linked to an account on an exact picker match.**
  `adminCreateLongtermBooking` now resolves the payer email against Firebase
  Auth and stamps the uid when an account exists. Note `grantCreditsForCash` has
  the same pattern for credit sales; left unchanged since re-keying balances
  changes money routing.
