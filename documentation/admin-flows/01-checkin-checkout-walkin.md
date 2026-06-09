# 01 — Check-in / Check-out / Walk-in

**Page:** `/admin/checkins` (`src/pages/admin/AdminCheckIns.js`) + the shared
`CreateTransactionModal` (`src/components/admin/CreateTransactionModal.js`).
**Permission:** `perm:checkins` (admin, agent, driver).

## In plain words

- This is the screen staff use at the gate to **let cars in and out** of the lot.
- **Someone with a reservation arrives** → staff find them and press "Check-in";
  the car gets a parking spot.
- **A car shows up with no reservation** ("walk-in") → staff create the booking
  on the spot, or sell/use parking credits, and can check them in immediately.
- **Regular commuters who pre-bought credits** can be checked in by typing their
  plate — one credit is spent per visit.
- **When they leave**, staff press "Check-out" and the spot is freed.
- If a customer chose **"pay when you arrive"**, staff can collect the cash/card
  payment here too.
- A separate **"Overdue"** list shows cars that stayed past their pick-up time.
- **Mostly resolved now:** credit/commuter check-ins create a real `active`
  booking, so they appear on the Check-out tab and can be checked out (which
  frees the spot and clears `activeCheckIns`); charge-for-overstay works. The
  last gap — a commuter checked in on an earlier day being hidden by the
  Check-out tab's date window — was fixed by always showing active credit
  bookings regardless of window (see Bugs 1 & 4).

---

> **Structural note that drives the headline bugs:** the page subscribes to a
> **single** collection — `bookings` (`AdminCheckIns.js:507`). Long-term
> reservations live in `bookings`. **Credit/commuter check-ins do not** — they
> write `activeCheckIns/{plate}` + a `tokenTransactions` row and **no** booking
> doc. So the credit funnel and this page's data source never meet. See Bugs 1 & 4.

---

## Flows

### Flow 1 — Long-term reservation check-in (Check-in tab)
**Entry:** a `bookings` doc, `type:'longTerm'`, `status:'upcoming'`, whose
drop-off falls in the selected window (today / week / month / custom).
1. Admin opens `/admin/checkins`; default tab `checkin`, window `today` (state
   in URL params).
2. Live `subscribeCollection('bookings')` populates the list; rows filtered to
   `status==='upcoming' && inWindow(dropoffAt)` sorted by drop-off ascending.
3. Row shows times, name/email, plate (mono), payment badge, "Așteaptă" status,
   a green **Check-in** button (+ **Încasează/Collect** if unpaid, + **Anulează
   rezervarea** if the admin has `PERM.REFUNDS`).
4. Click **Check-in** → a confirmation modal (`openCheckActionConfirm`) shows the
   reservation (code, type, customer, plate, drop-off/pick-up, payment, spot) and
   asks "Ești sigur că vrei să efectuezi check-in-ul…?". On confirm →
   `checkInBooking(bookingId)` flips booking to `status:'active'`, stamps
   `checkinTimestamp`, occupies the reserved (or first available) spot, bumps
   `settings/global.occupiedSpots`, audit `booking_checkin`. (Check-out shows the
   same modal, folding in the overstay warning when one applies.)
5. Toast "Check-in efectuat". Subscription re-renders; row leaves Check-in tab,
   appears on Check-out.
**End state:** booking `active`, spot `occupied`. ⚠ No `activeCheckIns/{plate}`
row written on this path (Bug 4).

### Flow 2 — Walk-in, long-term, no reservation (+ Walk-in nou)
**Entry:** car at the gate, no booking.
1. Click **+ Walk-in nou** → `CreateTransactionModal`, type "Long-term booking".
2. Pick existing user (email datalist) or "New customer"; enter plate, drop-off
   (defaults now), pick-up (now+1d), total price.
3. Optional **"Walk-in — fă check-in imediat"** checkbox.
4. Submit → `adminCreateLongtermBookingFn`. Server creates a **paid** booking
   (`paymentStatus:'paid'`, `paidBy:'admin-cash'|'admin-card'`), reserves a spot,
   records a cashbook entry if cash. If auto-check-in: flips `active`, occupies
   spot, **writes `activeCheckIns/{plate}`**.
5. New user → best-effort `adminSendInviteFn`. Toast; on check-in the page jumps
   to the Check-out tab.
**End state:** active paid booking + spot occupied + `activeCheckIns` row.

### Flow 3 — Walk-in commuter, SELL new credits
1. Walk-in modal → "Credit pack" → **Sell new credits** (default).
2. Enter plate, quantity, amount, paid-by, optional auto-check-in. The **amount
   auto-fills from the quantity** using the `tokenPacks` tiers from the Pricing
   page (exact pack-quantity match → that pack's price; otherwise the cheapest
   per-credit rate × quantity), and stays editable — once the agent edits it
   manually the auto-fill stops clobbering. A hint shows the computed value.
   (Long-term Flow 2 pre-fills its total the same way, from the date range.)
3. Submit → `grantCreditsForCashFn`: credits tokens, cashbook entry if cash. If
   auto-check-in: decrements one token, assigns a spot, creates an `active`
   **credit booking** (`createCreditCheckInBooking`: drop-off = now, **pick-up =
   that day's 20:00 Bucharest cutoff**, not the drop-off time), writes
   `activeCheckIns/{plate}` + a `use` `tokenTransactions` row.
**End state:** balance topped up, optionally one credit spent and car on lot,
showing on the Check-out tab as a commuter booking.

### Flow 4 — Commuter check-in against EXISTING credits (v1.8)
**Entry:** plate/customer holds a `tokenBalances` balance ≥ credits-to-use; plate
not already in `activeCheckIns`.
1. Walk-in modal → "Credit pack" → **Use existing credits**. Sell/paid-by/
   auto-check-in fields hide; submit relabels to "Check-in".
2. Debounced balance readout (customer match → `lookupByPlate`, monotonic token
   guards out-of-order results). Shows "N credits available".
3. Set credits-to-use (default 1) → submit → `checkInWithCreditsFn`: resolves
   balance, refuses `ALREADY_CHECKED_IN`, deducts in a transaction
   (`INSUFFICIENT_CREDITS` guard), assigns a spot, creates an `active` **credit
   booking** (drop-off = now, **pick-up = that day's 20:00 cutoff**), writes
   `activeCheckIns/{plate}` (`source:'manual'`) + `use` tx + audit.
4. Toast; modal closes; page jumps to Check-out tab.
**End state:** balance decremented, car on lot, showing on the Check-out tab as a
commuter booking.

### Flow 5 — Check-out (Check-out tab)
**Entry:** `bookings` doc `status:'active'`, pick-up in window.
1. Tab filters `status==='active' && inWindow(pickupAt)`, sorted by pick-up asc.
2. Click **Check-out** → `checkOutBooking(bookingId)` → `status:'completed'`,
   stamps `completedAt`, frees the spot. Toast. **No confirmation dialog.**
**End state:** booking `completed`, spot `available`. ⚠ Does **not** delete any
`activeCheckIns/{plate}` row (Bug 4).

### Flow 6 — Pay-at-pickup collection
**Entry:** booking `paymentStatus:'unpaid'` (web long-term pay-at-pickup).
1. Row shows red "Neplătit" badge + amber **Încasează/Collect** button
   (independent of the check-in button).
2. Click → collect dialog: hint "Pentru placa {plate}, suma {amount} lei",
   requires first/last name + locality + address, radio cash/card.
3. Submit → `adminMarkOrderPaidFn`: flips order + booking to paid, patches
   billing, reserves a spot if none, cashbook entry if cash. Toast.
**End state:** `paymentStatus:'paid'`. Collection and check-in are fully
decoupled — either can happen first, or collection can be skipped entirely (Bug 7).

### Flow 7 — Overdue tab
**Entry:** `status:'active'` AND `now > pickup + 2h`. No window filter; sorted
hours-over descending.
1. Accordion rows; expand for full detail grid.
2. Actions: **Check-out acum**, **Taxează depășire** (overstay), **Anulează
   rezervarea** (if `PERM.REFUNDS`). Overstay is a **no-op placeholder** (Bug 3).

### Flow 8 — Cancel reservation
**Entry:** `PERM.REFUNDS`; booking `upcoming`/`active`, not already refund-pending/
refunded.
1. Click **Anulează rezervarea** → danger `confirmModal`. Confirm →
   `cancelBookingFn`.
2. Server: `upcoming` + drop-off >12h ago → `no-show` (forfeit, no refund). Else
   `cancelled`; if paid via Netopia/admin → `refund-pending` (enters Refunds
   queue); frees spot; for `active` deletes `activeCheckIns/{plate}`; mirrors to
   `pendingOrders`. Toast.
**End state:** `cancelled` / `no-show`, spot freed.

### Flow 9 — Plate / search lookup
Top search bar filters live (120 ms debounce) across plate, code, name/email, id.
Persisted to `?q=`. **Filter over the loaded `bookings` tabs only** — not a
standalone action and not a balance lookup.

---

## Bugs & inconsistencies

1. **[FIXED] Credit/commuter check-ins now create a booking and are checkable
   out.** Credit funnels (`grantCreditsForCash` walk-in, `checkInWithCredits`)
   now call `createCreditCheckInBooking`, writing an `active` booking **and** the
   `activeCheckIns/{plate}` row, so commuters appear on the Check-out tab.
   Follow-up fixed today: the Check-out tab filtered credit bookings by their
   check-in day's date window (and Overdue then excluded credit), so a commuter
   checked in on a *previous* day was hidden on every tab and stranded `active`
   forever (plate stuck "checked in" on `/admin/capacity`, blocking re-check-in
   with `ALREADY_CHECKED_IN`). Now active credit bookings always show on
   Check-out regardless of window (`AdminCheckIns.js` `renderBody`/`counts`), and
   overstayed commuters also surface on Overdue (Bug 3).
2. **[PARTLY FIXED] Plate normalization mismatch on cancel cleanup.**
   `index.js:69` `normalizePlate` strips spaces **and** hyphens. `markNoShows`
   (`scheduled.js:303`) already strips both. `cancelBookingWithRefund`
   (`index.js:1699`) stripped spaces only — fixed today to call `normalizePlate`,
   so cancelling an active hyphenated-plate booking now deletes its
   `activeCheckIns` row.
3. **[FIXED] "Taxează depășire" (charge overstay) works for both types.**
   `openOverstayDialog` (suggests extra-days × rate, editable) →
   `adminChargeOverstay` records the cash/cashbook entry + a `lateFee`
   transaction. Overstay now also applies to **commuters**: their deadline is
   **20:00 Europe/Bucharest on the check-in day** (operating-hours end, matching
   the 7PM "overnight fee" reminder), +2h grace → past 22:00 they owe extra
   days valued at the per-credit price. Long-term still uses scheduled pick-up +
   the booking's own daily rate. (`pickupDeadlineMs`/`overstayInfo` in
   `AdminCheckIns.js`.)
4. **[FIXED] `activeCheckIns` lifecycle.** `checkOutBooking` now frees the spot
   **and** deletes `activeCheckIns/{normalizedPlate}`; cancel does the same (Bug 2).
   Remaining by design: the Check-in tab (`checkInBooking`, long-term) does not
   write `activeCheckIns` — long-term presence is tracked via booking `status`,
   which `AdminCapacity` reads alongside `activeCheckIns`.
5. **[MED] Listener + popstate leak; page returns no cleanup.** The default export
   returns nothing, so the router's cleanup is null. Teardown relies solely on a
   `popstate` listener (`:513`), but in-app sidebar navigation uses `pushState`
   (no `popstate`). Every visit adds a permanent `onSnapshot('bookings')`
   listener — a steady leak on a page staff live in all day. Return
   `() => { unsub(); window.removeEventListener('popstate', …) }`.
6. **[MED] Double-click / re-render race on check-in & check-out.** The handler
   disables the button synchronously, but the live subscription re-renders the
   whole `<tbody>` on **every** snapshot (incl. unrelated changes), replacing the
   disabled button with a fresh enabled one. `checkInBooking`/`checkOutBooking`
   are plain read-then-write with no idempotency guard → a snapshot mid-action
   re-enables the button and a second click double-runs (double spot assignment).
7. **[MED] Pay-at-pickup amount due not shown on the row; collection is optional
   and unguarded.** The only unpaid signal on the tab is the red badge; the amount
   appears only inside the Collect dialog. Check-in and Collect are independent —
   an agent can check a car in and never collect, with nothing flagging the still-
   unpaid `active` booking.
8. **[MED] Mobile uses a horizontally-scrolling table, not the documented card
   layout.** `renderTable` (`:441`) emits a `<table>` in `overflow-x-auto`. v1.7
   §C2/§C7 specified vertical cards + a 3-dot action menu below `md`. Staff on
   phones must scroll horizontally to reach the rightmost action column — the
   primary real-world use case.
9. **[LOW] No subscription error state; empty masquerades as loading.**
   `subscribeCollection` passes no `onSnapshot` error callback. A listener error
   leaves the table on its initial render; first paint shows the populated empty
   state ("Nicio rezervare în acest interval") instead of a loader.
10. **[LOW] Plate search doesn't strip spaces.** `matchesSearch` lowercases but
    keeps spaces, while plates are stored without them. Typing "B 123 ABC" returns
    zero results.
11. **[LOW] Hardcoded English "to" in the custom-range value** (`:400`). Briefly
    visible in RO before flatpickr reformats.
12. **[LOW] Dead code:** `bucharestDate` (`:57`) never called; `where`, `qs`
    imported unused.
13. **[LOW] Fragile XSS soft spot:** `paymentStatusBadge` (`:167`) emits the
    `paidBy` chip and a status fallback raw — currently server-controlled enums so
    not exploitable, but unsafe if those fields ever become free-text.

**Correct (not re-flagged):** `checkins.*`/`transactions.*` i18n parity is
complete; Cancel is confirm- and permission-gated (and re-checked server-side);
the modal's balance lookup is race-safe; `cancelBookingWithRefund` is idempotent
on terminal states; the collect dialog disables submit and restores on error.
