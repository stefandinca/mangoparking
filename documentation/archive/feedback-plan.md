# Mango Parking — Client Feedback Implementation Plan

**Date:** 2026-05-08
**Scope:** Round 1 client feedback (12 items in `client-feedback.md`)
**Approach:** Plan-and-decide first, single implementation pass.
**Effort:** ~3–4 working days.

---

## 1. Decisions captured

| Topic | Decision |
|---|---|
| Long-term billing anchor | Booked drop-off time stated by customer |
| Long-term grace | 2h, single grace at end of booking (not cumulative) |
| Navetiști late-pickup penalty rate | 1× current 1-day long-term tier rate, staff-actioned at lot |
| Voucher | 20 RON, one-time per new account, never expires |
| Online discount | 10%, stored in `settings/global` (admin-editable) |
| Auth on thank-you CTA | Gmail + email side-by-side, equal weight |
| Reviews | Manual admin entry (no Google Places API) |
| Name field | Stays single — defer split until SmartBill wiring |
| Email aliases | DNS/Plesk only, no code change |

---

## 2. Scope by area

### 2.1 Constants + i18n rename (~1h)

- `CONTACT_PHONE` → `+40 769 064 721` (currently `+40 740 075 380`)
- `CONTACT_EMAIL` → `rezervari@mangoparking.ro` (currently `stefan.florea@triorentacar.ro`)
- Funnel rename across `src/i18n/{ro,en}.js`:
  - `funnel.longTerm.title`: "Parcare pe termen lung" → **"Parcare aeroport"** / "Long-term parking" → **"Airport parking"**
  - `funnel.commuter.title`: "Credite zilnice" → **"Parcare navetiști"** / "Daily credits" → **"Commuter parking"**
  - Cascade through any pages with hardcoded labels (Home hero, Pricing, etc.)

**Files:** `src/utils/constants.js`, `src/i18n/ro.js`, `src/i18n/en.js`, possibly `src/pages/public/Home.js`, `src/pages/public/Pricing.js`.

---

### 2.2 Long-term billing model rewrite (~1.5 days)

Switch from **calendar days** to **hours from stated drop-off time + 2h grace**.

#### Booking form (`BookingLongTerm.js`)
- Replace date inputs with date+time inputs for drop-off and pickup
- New duration calc:
  ```js
  const ms = pickup - dropoff - 2 * 3600 * 1000; // subtract 2h grace
  const days = Math.max(1, Math.ceil(ms / 86_400_000));
  ```
- Live total recomputes on time changes
- Validation: pickup > dropoff, minimum 1h booking

#### Server (`functions/src/index.js`)
- `pendingOrders` and `bookings` documents gain `dropoffAt` + `pickupAt` ISO timestamps (full datetime, not just date)
- Existing `startDate`/`endDate` fields stay for backward compat, populated as date portion of the timestamps
- `createBookingFromOrder` writes both new and old fields

#### Admin (`AdminBookings.js`)
- Display drop-off/pickup as `dd/MM/yyyy HH:mm` (short)
- Plate lookup shows expected pickup time so staff knows when overage starts
- Visual flag if `now() > pickupAt + 2h` ("OVERTIME — charge X extra days at lot")

#### Migration of existing data
Existing `bookings` docs have `startDate`/`endDate` (date-only). Migration: treat them as `dropoffAt = startDate 06:00:00`, `pickupAt = endDate 20:00:00`. Backfill optional — admin pages tolerate missing `dropoffAt`/`pickupAt` and fall back to date display.

#### Reconciliation policy (DEFERRED)
Auto-charging the difference for late pickup is **not** in this round. Staff handles overage at the lot (same model as navetiști late fee). Visual flag only.

---

### 2.3 Navetiști late-pickup penalty workflow (~3h)

- Token-management page in `/admin/bookings` already shows transactions per plate
- Add a "Charge late pickup fee" action button (visible after 8PM or at staff discretion)
- Logs a `tokenTransactions` doc:
  ```js
  {
    customerId, licensePlate,
    type: 'lateFee',
    quantity: 0,
    feeAmount: <current 1-day long-term tier rate>,
    feeCurrency: 'RON',
    timestamp: <now>,
    source: 'admin-manual',
  }
  ```
- Money is collected in person at the lot — this transaction is for accounting/reporting only
- Admin dashboard: show count of plates checked in via credits but not yet checked out, after 8PM

**Files:** `src/pages/admin/AdminBookings.js`, `src/services/tokenService.js`, possibly `AdminDashboard.js`.

---

### 2.4 Online-payment discount (~3h)

- New `settings/global.onlineDiscountPercent` field, default `10`
- Reads from existing `settings/global` doc — already public-read, admin-write
- Admin UI: number input on `/admin/rates` (or new `/admin/settings`)
- Display logic:
  - Pricing page (`Pricing.js`): show original price strikethrough + discounted price
  - Booking funnels (`Booking.js`): same on the funnel cards
  - `BookingCredits.js` summary: "X credite — original 100 lei, online 90 lei"
  - `BookingLongTerm.js` summary: same on per-day rate
- Token packs (`tokenPacks.price`) and long-term tier rates remain the **online** prices in the database
- "Original" computed on display: `Math.round(onlinePrice / (1 - discount/100))`

**Note (UX/marketing):** Since all bookings are online, the "discount" always applies — this is anchoring, not a real choice. Confirmed with user: this is intended.

**Files:** `src/services/settingsService.js` (new helper or extend existing), `src/pages/public/{Pricing,Booking,BookingCredits,BookingLongTerm}.js`, `src/pages/admin/AdminRates.js`.

---

### 2.5 Form validation visual feedback (~2h)

Apply to `BookingLongTerm.js` and `BookingCredits.js`:
- On submit-fail, add `border-red-500 bg-red-50` to invalid inputs (currently only toast)
- Clear red state when user edits the field
- Keep toast for the summary message ("Completați câmpurile obligatorii")
- Add a small red inline error label next to each field for clarity

---

### 2.6 PF/PJ (person/company) at checkout (~3h)

- Radio toggle on booking forms: "Persoană fizică" / "Persoană juridică"
- When PJ selected, show:
  - `companyName` (required)
  - `cui` (required, format `RO12345678`)
  - `regCom` (optional, format `J01/123/2020`)
  - `companyAddress` (required)
- Persist on:
  - `pendingOrders.customerData.billing` — flat object
  - `bookings.contact.billing` — same
  - `tokenTransactions` for credit purchases — same
- Account profile (`/account`):
  - Same toggle + fields, saved on `users/{uid}.billing`
  - Booking forms pre-fill from profile when logged in
- Validation: CUI Romanian format check, regCom optional but format-validated when present
- **Does not affect Netopia flow** — billing data is for SmartBill later, not for payment

**Files:** `src/pages/public/{BookingCredits,BookingLongTerm}.js`, `src/pages/account/Dashboard.js` (or Profile section), `src/utils/validators.js` (CUI / regCom validators).

---

### 2.7 Account-creation incentive + voucher system (~1 day)

#### Voucher system (new)
- New Firestore collection `vouchers/{voucherId}`:
  ```js
  {
    userId: <uid>,
    amount: 20,
    currency: 'RON',
    status: 'unused' | 'redeemed' | 'expired',
    createdAt: <ISO>,
    redeemedAt: <ISO|null>,
    redeemedOn: <orderId|null>,
    source: 'signup-incentive',
  }
  ```
- Firestore rules: owner read, owner update only to flip `status` from `unused` to `redeemed`, no delete
- Auto-applied at checkout: when user has any `unused` voucher, deduct from `totalPrice`/`amount` before encrypting Netopia XML
- Voucher consumption happens in `netopiaCallback` (server-side, atomic with order fulfillment)

#### Thank-you (`BookingReturn.js`) CTA
- For **unauthenticated** buyers (guest flow), after success state, show a card:
  > "Fă-ți cont și primește un voucher de 20 RON la următoarea achiziție"
- Two buttons of equal visual weight:
  - "Continuă cu Google" (Gmail OAuth)
  - "Înregistrează-te cu email" (email/password)
- Both pre-fill the email from `pendingOrders.customerData.email`
- After successful registration, the new account gets a `vouchers/{id}` doc created server-side (or via a trigger function)

#### Implementation notes
- Voucher creation: cleanest is a Cloud Function trigger on `users/{uid}` create, but adds another deploy
- Simpler path: create the voucher client-side after registration completes (security: rules require `userId === request.auth.uid`)
- Voucher application: extend `createPayment` to accept `voucherId` in payload, validate ownership + status, deduct from amount before encrypting

**Files:**
- `src/services/voucherService.js` (new)
- `src/pages/public/BookingReturn.js` (CTA card)
- `src/pages/auth/Register.js` + `Login.js` (voucher creation hook on signup)
- `src/pages/account/Dashboard.js` (display "Voucher disponibil")
- `functions/src/index.js` (voucher consumption in createPayment + netopiaCallback)
- `firestore.rules` (vouchers collection)

---

### 2.8 Capacity widget cleanup (~30min)

Audit `Home.js` and capacity components, then:
- **Keep:** top "X locuri rămase" badge (current top-of-page indicator)
- **Remove:** any secondary "Total N spots" display below
- **Remove on desktop only:** the "live available spots" variant (presumably a more verbose version)
- Mobile keeps whatever the current mobile UX is

I'll inspect the current capacity displays first and report exactly what I plan to remove before deleting.

---

### 2.9 Mobile contact bar — WhatsApp + tap-to-call (~2h)

- Sticky bottom bar, mobile only (`md:hidden`)
- Two icon-only buttons (~48px tall total bar):
  - Phone icon → `tel:+40769064721`
  - WhatsApp icon → `https://wa.me/40769064721`
- Subtle, doesn't cover content (compact height, semi-transparent if hovering content)
- Hidden on auth/admin pages (only public-facing)

---

### 2.10 Maps embed (~30min)

- `GOOGLE_MAPS_EMBED` constant already exists in `src/utils/constants.js`
- Add iframe to `Contact.js` page
- Optionally also a small map widget in the footer (decide during implementation)

---

### 2.11 Reviews — manual admin entry (~3h)

#### Admin page `/admin/reviews`
- List, add, edit, delete reviews
- Fields:
  - `name` (string)
  - `rating` (1–5)
  - `comment` (string)
  - `date` (ISO date)
  - `photoUrl` (optional)
  - `published` (bool, default true)
  - `sortOrder` (int, default 0)
- `reviews` collection in Firestore — rules already public-read, admin-write

#### Public display
- Homepage: new "Spun clienții" / "What our clients say" section
- Card grid (3 across desktop, 1 on mobile)
- Reads top N published reviews sorted by `sortOrder` then `date desc`
- Star icons rendered from `rating`

**Files:**
- `src/pages/admin/AdminReviews.js` (new)
- `src/services/reviewService.js` (new)
- `src/pages/public/Home.js` (new section)
- `src/router/routes.js` (admin route)
- `src/i18n/{ro,en}.js` (new keys)

---

## 3. Out of scope / deferred

| Item | Reason | When |
|---|---|---|
| Name split (`nume` + `prenume`) | Only useful if SmartBill needs it | Defer until SmartBill wiring |
| Email aliases (`office@`, `contact@` → `rezervari@`) | DNS/Plesk task, not code | User handles outside repo |
| Long-term overage auto-charging | Staff-handled at lot is sufficient for MVP | Future iteration if volume justifies |
| Reviews via Google Places API | Manual is enough for MVP | Future, when volume justifies the cost |

---

## 4. Implementation sequencing (within single pass)

Even as one PR, build in this internal order so each layer compiles cleanly:

1. Constants + i18n + funnel rename (foundational, smallest)
2. Long-term billing rewrite (schema-touching, biggest)
3. Navetiști late-fee admin action
4. Online discount (settings/global + display)
5. PF/PJ form fields
6. Voucher system + thank-you CTA (touches Netopia createPayment)
7. Form validation polish
8. Capacity widget cleanup
9. Mobile contact bar + maps embed
10. Reviews admin page + homepage section

Test build (`npm run build`) after each layer.

---

## 5. Risk callouts

- **Long-term billing change is breaking** for existing bookings. Migration: treat existing date-only `startDate`/`endDate` as `06:00 → 20:00` of those dates. Future bookings have full timestamps. Admin pages must tolerate both shapes.
- **Voucher system touches Netopia checkout.** Must redeploy `createPayment` function. Plan to do this **after** Netopia confirms live and live cutover smoke test passes — not before, to avoid mixing concerns.
- **PF/PJ field validation** has Romanian-specific format rules (CUI, regCom). Validators must be Romanian-aware.
- **Mobile sticky contact bar** can interfere with form submit buttons on small viewports — pad bottom of pages to compensate.

---

## 6. Pre-flight checklist (before starting)

- [ ] Netopia live cutover smoke test passed (or explicit decision to develop in parallel)
- [ ] Plan reviewed and approved by user
- [ ] Branch strategy: develop on `main` directly (current convention) or feature branch? — current convention is `main`
