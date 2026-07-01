# Mango Parking v1 — Implementation Plan

## Context

Mango Parking is transitioning from MVP to v1. The MVP was a credit-token storefront with a manual plate-lookup admin tool; v1 turns it into a full operational platform: branded transactional email, in-house picker UX, expanded legal billing capture for B2B, pay-at-pickup as a first-class payment method, an admin user-management surface, and a unified shuttle-driver check-in dashboard that finally fuses the three parallel check-in flows that exist today.

The work in `documentation/changes 10-05.md` falls into ~8 logical phases. They share infrastructure (the Brevo email layer underpins half the features, the booking data-model evolution underpins another third), so the order below is dependency-driven, not feature-priority.

## Locked Decisions

- **Email layer:** ~~Brevo SMTP behind the official Firebase Trigger Email Firestore extension.~~ **Revised mid-implementation to direct Brevo Transactional Email REST API** (`api.brevo.com/v3/smtp/email`) — the Trigger Email extension is SMTP-only and doesn't understand Brevo template IDs, which we need for the design-system approach. Auth emails (password reset, email verification, admin invite) bypass Firebase Auth's built-in delivery — Cloud Functions use the Admin SDK to *generate* the action link, then send a fully branded Brevo template. One design system for every email.
- **Date/time picker:** theme the existing `flatpickr` dep (already in `package.json`); wrap in a thin component, apply mango/blueberry CSS, force 24h time, `clickOpens: true` so clicking anywhere on the field opens it.
- **Reservation numbers:** per-type prefix — `LT-XXXXX` (long-term), `CR-XXXXX` (credit/commuter). 5-char alphanumeric, ambiguous chars excluded (no `I O 0 1`). Generated client-side, collision-checked.
- **Online discount:** reuse existing `settings/global.onlineDiscountPercent` (already editable at `/admin/rates` via `src/services/discountService.js`). Pay-at-pickup orders pay the full rate; online-paid orders get the discount. No new setting.

---

## Progress Snapshot — 2026-05-12 (afternoon update)

All v1 code is now in place. Outstanding items are configuration / smoke-tests only:
- Finish populating Brevo template IDs in `functions/src/emailTemplates.js` (18 still `null`).
- After deploy, paste the new `repayOrder` Cloud Run URL into `.env.local` as `VITE_REPAY_ORDER_URL` (the default-guess in `constants.js` will work if the project hash matches).
- Confirm scheduled jobs registered on first `firebase deploy --only functions` (Gen 2 Cloud Scheduler auto-provisions).
- Rebuild + redeploy `dist/` to Plesk so `/pay`, `/auth/finish-signup`, `/admin/users` resolve.

---

## Progress Snapshot — 2026-05-12 (morning)

Legend: ✅ done · 🟡 partial · ⏳ not started

| Phase | Status | Notes |
|---|---|---|
| A1 — Brevo + email layer | 🟡 | Pivoted from Trigger Email extension to direct Brevo REST API (`functions/src/brevo.js`). `BREVO_API_KEY` secret set. Domain auth (SPF/DKIM/DMARC) on `mangoparking.ro` complete. **User is filling in remaining 18 template IDs in `functions/src/emailTemplates.js`** — `booking-longterm-confirm-ro=2` and `credit-purchase-ro=3` already set. |
| A2 — Copy rename | ✅ | i18n keys updated in `ro.js`/`en.js`. |
| A3 — WhatsApp FAB | ✅ | `src/components/core/WhatsAppFab.js`, mounted from `main.js`, hidden on `/admin/*` via `app-rendered` listener. |
| B1 — Reservation-code generator | ✅ | `src/utils/bookingCode.js`; wired into longTermService + Cloud Functions inline copy. |
| B2 — Payment method/status fields | ✅ | Added to `bookings` + `pendingOrders`. `firestore.rules` whitelist on `pendingOrders` deployed. |
| B3 — Expanded BillingFields (PF + PJ) | ✅ | idType radio (CNP/CI/Passport), validators added to `src/utils/validators.js`, i18n keys done. |
| B4 — CUI lookup | ✅ | Client wired with 600ms debounce → `services/cuiService.lookupCui()`. Server callable now lives in `functions/src/cui.js` with a 24h `lookupCache/cui_{n}` Firestore cache. |
| C — Date/time picker | ✅ | `FormDateTime` + themed `flatpickr-theme.css`; replaced inputs in BookingLongTerm. |
| D — Pay-at-pickup | ✅ | Client radios + server branch + admin "Mark paid" callable + `BookingReturn.renderPickup`. Self-service repay live at `/pay?orderId=…` → `repayOrder` HTTP function (`functions/src/index.js`). IPN now patches an existing `bookingId` instead of creating a duplicate. Confirmation email "pay now" link updated. |
| E1 — signup-welcome | ✅ | `onUserCreated` trigger deployed. Idempotency via `users/{uid}.welcomeEmailSentAt` claim. |
| E2 — booking-longterm-confirm | ✅ | `onBookingCreated` trigger. Recent fix: `createBookingFromOrder` now branches on `paymentMethod` for atomic write, so the `{% if params.paid == false %}` block renders correctly for pay-at-pickup. |
| E3 — credit-purchase | ✅ | `onTokenTransactionCreated` filtered to `type === 'purchase'`. |
| E4 — credit-used | ✅ | Same trigger, filtered to `type === 'use'`. |
| E5 — low-credit-warning | ✅ | Same trigger; fires only when prev balance > 2 && new ≤ 2. |
| E6 — password-reset | ✅ | `requestPasswordReset` callable + inline "Forgot password?" form on `Login.js`. |
| E7 — admin-invite | ✅ | `adminSendInvite` callable mints `signInWithEmailLink`, stashes role in `pendingInvites/{email}`, sends Brevo `admin-invite-{locale}` template. Recipient lands on `/auth/finish-signup` (`FinishSignup.js`) which completes auth, calls `finishInviteSignup`, and prompts for a password via `updatePassword`. |
| E8/E9/E10 — scheduled reminders | ✅ (code) | Live in `functions/src/scheduled.js`. Will be silent until the matching Brevo template IDs are set. |
| F — Scheduled functions | ✅ | `daily24hReminders` (10:00 Bucharest, fires E8+E9), `commuter7PMCheck` (19:00, fires E10), `expireStaleHolds` (02:00, flips stale pay-at-pickup orders to `expired`). Idempotent via `reminderCheckinSentAt` / `reminderCheckoutSentAt` / `reminderCommuterSentAt` markers. |
| G — Admin auth tools | ✅ | `/admin/users` page (`AdminUsers.js`) with Create + Invite modals; `adminCreateUser`, `adminSendInvite`, `finishInviteSignup` callables; `pendingInvites` collection w/ rule "admin-SDK only"; nav entry in `AdminLayout`; forgot-password link wired on `Login.js`; `grantCreditsForCash` already shipped with Phase H. |
| H — Check-in dashboard | ✅ | `src/pages/admin/AdminCheckIns.js` at `/admin/checkins`, three sections live (Currently parked / Expected today / Pending payment), walk-in + mark-paid + grant-credits dialogs wired. |

**Infra bumps along the way:**
- Functions runtime → Node 22; `firebase-functions` → ^7.2.5.
- v2 Firestore triggers explicitly pinned to `region: 'europe-west1'` (the global setting doesn't carry into individual trigger options).

**Uncommitted work as of this snapshot:**
- `functions/src/brevo.js` (new)
- `functions/src/emails.js` (new — 3 triggers covering E1–E5)
- `functions/src/emailTemplates.js` (active — user is editing IDs)
- `functions/src/index.js` recent edits: `requestPasswordReset`, `adminMarkOrderPaid`, `grantCreditsForCash`, `assertStaff`, `createBookingFromOrder` pay-method fix, idempotency claims, logging
- `documentation/v1-plan.md` (this update)

**Resuming next session:**
1. User finishes pasting Brevo template IDs into `functions/src/emailTemplates.js` (locations: 18 remaining `null` entries — most importantly `admin-invite-ro/en`, `password-reset-en`, the four reminder templates).
2. `firebase deploy --only firestore:rules,functions` to publish: new `pendingInvites` + `lookupCache` rules, new callables (`adminCreateUser`, `adminSendInvite`, `finishInviteSignup`, `lookupCui`), `repayOrder` HTTP function, and the three scheduled jobs.
3. Capture the new Cloud Run URL for `repayOrder` from the deploy output and set `VITE_REPAY_ORDER_URL` in `.env.local` (or accept the default-guess in `constants.js`).
4. `npm run build:vite` and upload `dist/` to Plesk so the new client routes resolve.
5. Smoke-test:
   - Forgot-password link on `/login`
   - Admin invites a fake email; finish-signup completes the round trip
   - Pay-at-pickup booking → click "pay online" link in confirmation email → repay flow → IPN flips booking to paid (no duplicate)
   - Trigger each scheduled function manually from Firebase Console to confirm regions/permissions
   - BillingFields PJ: enter `14186770` → ANAF autofill fires

The brand-new functions code + the createBookingFromOrder fix should land in a `feat(email): brevo wrapper + Phase E triggers (E1–E6) + atomic pay-method write` commit before resuming.

---

## Phase A — Foundations (~1.5 days) 🟡

### A1. Brevo + Trigger Email extension

- DNS once on `mangoparking.ro`: SPF (`v=spf1 include:spf.brevo.com ~all`), DKIM (Brevo-provided TXT at `mail._domainkey`), DMARC (`p=none` to start).
- Install `firebase/firestore-send-email` extension via `firebase ext:install firestore-send-email`. Config: collection `mail`, default `from: rezervari@mangoparking.ro`, SMTP URI bound to a Brevo secret.
- New secret `BREVO_SMTP_URI` via `firebase functions:secrets:set`.
- Author 12 Brevo templates (RO + EN pairs for 6 emails handled in Phase E; remaining 4 covered there too). Templates use Handlebars-style `{{ params.* }}`.
- Brevo templates live in Brevo's dashboard; this repo only stores their numeric IDs in a new file `functions/src/emailTemplates.js` (just the ID-to-name map).

### A2. Copy rename — "Cumpără Credite" → "Rezervă parcare navetiști"

Touchpoints (all in i18n locales — never edit page strings directly):
- `src/i18n/ro.js` — keys `hero.cta1`, `funnel.commuter.cta`, `credit.buyTokens`, `pricing.bookNow` (verify per the Explore report)
- `src/i18n/en.js` — same keys, English equivalent ("Reserve commuter parking")
- Both Home.js (lines 113, 243) and Booking.js (line 55) already read these keys — no JS changes needed.
- `credit.pageTitle` for `BookingCredits.js` meta — keep as "Cumpără credite" since this remains the actual purchase page; only the *entry CTAs* rename to "Rezervă parcare navetiști".

### A3. WhatsApp floating button

- New component `src/components/core/WhatsAppFab.js` — factory function, returns a fixed bottom-right anchor with the WhatsApp glyph from `src/components/widgets/icons.js` (add icon there).
- Mount once in `src/main.js` *outside* the `#app` container so it survives every route render — append to `document.body` after `initRouter()`. Z-index above Toast (`z-[110]`), hidden when Toast container has `>0` children (avoid stacking).
- Phone: pull from `CONTACT_PHONE` constant in `src/utils/constants.js`. Pre-filled message: i18n keys `whatsapp.message.ro/en` (new).
- Hidden on admin routes (`/admin/*`) — detect by `window.location.pathname` on render + listen to `popstate`.

---

## Phase B — Booking Data Model Evolution (~1 day) 🟡 (B4 server pending)

### B1. Reservation-code generator

- New util `src/utils/bookingCode.js`:
  ```js
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // no I/O/0/1
  export function generateBookingCode(type) {
    const prefix = type === 'longTerm' ? 'LT' : type === 'credit' ? 'CR' : 'MNG';
    let suffix = '';
    for (let i = 0; i < 5; i++) suffix += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return `${prefix}-${suffix}`;
  }
  ```
- Wire into `src/services/longTermService.js` (`createLongTermBooking`, `createCreditBooking`) — add `code` field to the doc. Collision check: query `bookings` where `code == x`, retry up to 3 times. Acceptable false-positive rate at our scale (~1 in 33M).
- `bookingService.js` already generates `MNG-XXXXX`; leave it.
- Add `code` index? Not needed — lookups are by plate or doc ID, not by code (code is display-only for staff verbal handoff).

### B2. Payment method + status fields

Add to `bookings/{id}` schema (and to `pendingOrders/{orderId}` mirror):
- `paymentMethod`: `'online' | 'pay-at-pickup'`
- `paymentStatus`: `'paid' | 'unpaid'`
- `paidAt`: ISO string | null
- `paidBy`: `'netopia' | 'admin-cash' | 'admin-card' | null`

Migration: no backfill needed. Existing docs default to `paymentMethod: 'online'`, `paymentStatus: 'paid'` (because they exist only because Netopia confirmed). Old admin views treat missing fields as `paid` to stay backward-compatible.

Touch:
- `src/services/longTermService.js` — accept these fields in `createLongTermBooking` / `createCreditBooking`
- `functions/src/index.js` — `createBookingFromOrder` writes them; `creditTokens` adds them to the `pendingOrders` doc for credit-pack purchases
- `firestore.rules` lines 87–93 — `bookings` rules already let staff update freely; no change. For `pendingOrders` (currently `allow write: if false`), add a rule path: `allow update: if isStaff() && only(['paymentStatus','paidAt','paidBy','status'])` — using a helper to whitelist updatable fields. (Plain spec: staff can flip paid status but cannot rewrite amount/customer.)

### B3. Expanded BillingFields (PF + PJ)

Touch `src/components/widgets/BillingFields.js`. New schema returned by the form:

```js
{
  type: 'PF' | 'PJ',
  // PF + PJ common
  idNumber: string,           // CNP (13 digits) | CI series (2 letters + 6 digits) | passport
  idType: 'CNP' | 'CI' | 'PASSPORT',
  firstName: string,
  lastName: string,
  personalAddress: string,
  // PJ only
  companyName?: string,
  cui?: string,
  regCom?: string,            // optional
  companyAddress?: string,
}
```

- Validators (`src/utils/validators.js`): add `isValidCnp` (length 13 + Romanian CNP checksum), `isValidCiSeries` (2 letters + 6 digits, common series allowlist), `isValidPassport` (basic alphanumeric 6-12). Existing `isValidCui` and `isValidRegCom` stay.
- i18n keys to add in `ro.js` + `en.js` under `billing.*`: `idType.cnp`, `idType.ci`, `idType.passport`, `firstName`, `lastName`, `personalAddress`, error variants.
- Persistence: the full billing object is now substantial. Store on both the `tokenTransactions` doc (existing path via `creditTokens` in functions/src/index.js) and the new `bookings.billing` field. Add to seed expectations.
- Pre-fill: if the user is logged in, prefill from `users/{uid}.billing` and write back on form submit (`users/{uid}.billing` becomes the user's saved profile).

### B4. CUI lookup helper

- Romanian ANAF has a public endpoint at `https://webservicesp.anaf.ro/PlatitorTvaRest/api/v8/ws/tva` (POST JSON `[{ cui, data }]`) — no auth, rate-limited. Cloud Function wrapper because of CORS: new callable `lookupCui({ cui })` in `functions/src/index.js`.
- Function returns `{ companyName, address, regCom, vatPayer }` or `{ error: 'not_found' }`.
- Client: in `BillingFields.js`, debounce a CUI-input change handler at 600ms; show inline spinner; on success, prefill `companyName`, `companyAddress`, `regCom` (user can still edit); on error, leave manual entry alone.
- Cache successful lookups in `lookupCache/cui_{value}` for 24h to avoid hammering ANAF.

---

## Phase C — Custom Date/Time Picker (~1 day) ✅

### C1. FormDateTime component

- New file `src/components/core/FormDateTime.js`:
  ```js
  import flatpickr from 'flatpickr';
  import { Romanian } from 'flatpickr/dist/l10n/ro.js';
  // factory: (options) => { mount(input), getValue(), setValue() }
  ```
- Default flatpickr config: `enableTime: true`, `time_24hr: true`, `dateFormat: 'Y-m-d H:i'`, `altInput: true`, `altFormat: getLocale() === 'en' ? 'M j, Y · H:i' : 'j M Y · H:i'`, `clickOpens: true`, `allowInput: false`, `minDate: 'today'`, `locale: getLocale() === 'ro' ? Romanian : 'default'`.
- Re-init on locale change (subscribe via `onLocaleChange` from `src/i18n/index.js`).

### C2. Theming

- New file `src/styles/flatpickr-theme.css`, imported by `FormDateTime.js`. Overrides:
  - `.flatpickr-calendar`: bg `var(--color-frost)`, border `var(--color-blueberry)`, `rounded-2xl`, `shadow-xl`
  - Day cells: hover `bg-mango/20`, today ring `ring-2 ring-blueberry`, selected `bg-blueberry text-frost`
  - Time inputs: 24h sans-am-pm, font `font-mono` (JetBrains)
  - Month picker chevrons: charcoal, mango on hover
- Drop the legacy flatpickr CSS reference from `src/style.css` (Explore confirmed it lives there and nothing else imports flatpickr today).

### C3. Replace native inputs

- `src/pages/public/BookingLongTerm.js` lines 87, 91 — drop the two `<input type="datetime-local">`, use `FormDateTime` instead. Same names + form-data wire-up; existing `toLocalDatetimeValue` / `localDatetimeToIso` helpers can go since flatpickr returns ISO directly.
- Audit `src/pages/admin/*` for any date inputs; replace where found.
- Keep `<input type="date">` only where time is irrelevant — those pass through with a `dateOnly: true` option that turns off `enableTime`.

---

## Phase D — Pay-at-Pickup (~1 day) ✅ (`/pay/{orderId}` repay route still a stub)

### D1. Client option

- `src/pages/public/BookingLongTerm.js` — new radio group above the pay button:
  - `Plătesc acum online (–{discount}%)` (default selected)
  - `Plătesc la sosire (cash sau card)`
- Live recompute totalPrice when toggled. Show the discount struck-through line when "pay later" selected.
- `src/pages/public/BookingCredits.js` — same radio group above pay button.
- `src/services/discountService.js` already exposes `getOnlineDiscountPercent()` — call it once on page load.

### D2. Server-side branch

`functions/src/index.js`:
- `createPayment` accepts new field `paymentMethod: 'online' | 'pay-at-pickup'`.
- If `online`: existing Netopia flow (returns `action`, `env_key`, etc.).
- If `pay-at-pickup`:
  - For long-term: create `bookings` doc immediately with `paymentStatus: 'unpaid'`, no Netopia call; respond with `{ orderId, redirectUrl: '/booking/return?orderId=...' }`. Return page polls — finds doc, shows "Reservation confirmed, pay on arrival" branch.
  - For credits: create `pendingOrders/{orderId}` doc with `paymentMethod: 'pay-at-pickup'`, `paymentStatus: 'unpaid'`, status `awaiting-payment`. DO NOT credit tokens. Same return-page polling, shows "Bring this code, pay on arrival, credits activated then".

### D3. Admin "mark paid"

- New callable `adminMarkOrderPaid({ orderId, paidBy })` in `functions/src/index.js`. Idempotent:
  - For credit `pendingOrders`: call existing `creditTokens()` flow then flip `paymentStatus: 'paid'`, `paidAt`, `paidBy`.
  - For `bookings` (longTerm): just flip the three fields. No money movement.
  - Audit-log every call.
- Admin UI: a "Mark paid" button in the new check-in dashboard (Phase H), with a small dialog asking `paidBy: cash|card`.

### D4. Discount math

- Centralize in a new util `src/utils/pricing.js`:
  ```js
  export function applyOnlineDiscount(basePrice, discountPct) {
    return Math.round(basePrice * (1 - discountPct / 100));
  }
  ```
- `BookingLongTerm.js` + `BookingCredits.js` use it consistently.
- Confirmation email template branches on `paymentMethod`:
  - Online: "Mulțumim! Plata confirmată."
  - Pay-at-pickup: "Rezervarea ta este înregistrată. Plătește online până la sosire și economisești {discount}%. [Link to pay now]" — link points to a new route `/pay/{orderId}` that re-enters the Netopia flow.

---

## Phase E — Email Triggers (~1.5 days) 🟡 (E1–E6 deployed; E7 with Phase G; E8–E10 with Phase F; awaiting full Brevo template IDs)

**Implementation note:** Triggers do NOT write to a `mail` collection — they call `sendBrevoEmail()` directly via the Brevo REST API. The original `mail`-collection design was for the Trigger Email extension, which we abandoned.



Every email is a Firestore-trigger Cloud Function in `functions/src/emails.js` (new file) that writes to the `mail` collection (Trigger Email extension picks it up). Templates by ID in `functions/src/emailTemplates.js`.

| # | Trigger | Source | Template (RO/EN pair) |
|---|---------|--------|------------------------|
| E1 | `users/{uid}` onCreate | new signup | `signup-welcome` |
| E2 | `bookings/{id}` onCreate, `type == 'longTerm'` | long-term reservation | `booking-longterm-confirm` (branches by paymentMethod) |
| E3 | `tokenTransactions/{id}` onCreate, `type == 'purchase'` | credit pack purchased | `credit-purchase` |
| E4 | `tokenTransactions/{id}` onCreate, `type == 'use'` | credit used at lot | `credit-used` |
| E5 | `tokenTransactions/{id}` onCreate, `type == 'use'` + balance check | low-credit warning (≤2) | `low-credit-warning` — fired only when prev balance > 2 && new ≤ 2 to avoid spam; balance read in same transaction context |
| E6 | callable `requestPasswordReset({email})` | user clicks "Forgot password" | `password-reset` — uses `admin.auth().generatePasswordResetLink` |
| E7 | callable `adminSendInvite({email})` | admin invites new user | `admin-invite` — uses `admin.auth().generateSignInWithEmailLink` |
| E8 | scheduled (Phase F) | 24h before drop-off | `reminder-checkin-24h` |
| E9 | scheduled (Phase F) | 24h before pickup | `reminder-checkout-24h` |
| E10 | scheduled (Phase F) | 19:00 daily, commuter still checked-in | `reminder-commuter-7pm` |

Implementation notes:
- Every trigger reads recipient locale from `users/{uid}.locale` (new field, default `ro`, set by Login/Register based on `getLocale()`) and picks the `-ro` or `-en` template.
- Customer email recipient: from booking's `contact.email` field (already exists), fallback to `users/{uid}.email`.
- Low-credit watcher (E5): logic lives in the same transaction handler as E4, branching on the balance delta. One Cloud Function, two `mail` writes possible.
- Password reset replaces the existing client-side `sendPasswordResetEmail` call (currently not implemented — Login.js has no forgot-password UI yet; add the link + dialog).

---

## Phase F — Scheduled Functions (~0.5 day) ⏳

`functions/src/scheduled.js` (new file). Gen 2 `onSchedule` imports — see `firebase-functions/v2/scheduler`. All in `europe-west1` matching existing `setGlobalOptions`.

- **`daily24hReminders`** — `every day 10:00 Europe/Bucharest`. Queries `bookings` where `startDate` is between now+23h and now+25h AND `status in ['upcoming']` → writes E8 to `mail`. Same query with `endDate` window → writes E9.
- **`commuter7PMCheck`** — `every day 19:00 Europe/Bucharest`. Queries `activeCheckIns` where `checkinTime` is today. For each, write E10 to `mail`.
- **`expireStaleHolds`** — `every day 02:00`. Cleans up `pendingOrders` older than 14 days that are still `awaiting-payment` (admin housekeeping). Sets status `expired`.

No new infra config required — Gen 2 Cloud Scheduler is auto-provisioned by Firebase on deploy.

---

## Phase G — Admin Auth Tools (~1 day) ⏳ (G4 `grantCreditsForCash` callable already exists via Phase H wiring)

### G1. AdminCreateUser page

- New file `src/pages/admin/AdminUsers.js`. Route `/admin/users` (`['auth','admin']`). Add to `AdminLayout.js` nav.
- Lists existing users (paginated, search by email/plate). Pulls from `users` collection (admin can read all per existing rules).
- "Create user" button → modal with two tabs:
  - **Direct create**: email, password, name, role (customer/staff/admin). Calls callable `adminCreateUser`.
  - **Send invite**: email, name. Calls callable `adminSendInvite`. Magic-link email lands in inbox; clicking it completes signup.

### G2. `adminCreateUser` callable

`functions/src/index.js`:
```js
export const adminCreateUser = onCall({ ... }, async (request) => {
  await assertAdmin(request);
  const { email, password, displayName, role } = request.data;
  const user = await admin.auth().createUser({ email, password, displayName });
  await db.collection('users').doc(user.uid).set({
    email, displayName, role, locale: 'ro',
    loyaltyPoints: 0, loyaltyTier: 'bronze', vehicles: [],
    createdAt: new Date().toISOString(),
  });
  return { uid: user.uid };
});
```

### G3. `adminSendInvite` callable

```js
export const adminSendInvite = onCall({ ... }, async (request) => {
  await assertAdmin(request);
  const { email, displayName } = request.data;
  const link = await admin.auth().generateSignInWithEmailLink(email, {
    url: 'https://mangoparking.ro/auth/finish-signup',
    handleCodeInApp: true,
  });
  await db.collection('mail').add({
    to: email,
    template: { name: 'admin-invite-ro', data: { name: displayName, link } },
  });
  return { ok: true };
});
```
- New route `/auth/finish-signup` — vanilla SPA handler that calls `signInWithEmailLink`, prompts user for password, sets `users/{uid}` profile.

### G4. Cash-credit grant

- New callable `grantCreditsForCash({ plate, quantity, packId, payerEmail, payerName, paidBy })` in `functions/src/index.js`.
- Reuses internal `creditTokens()` (already in index.js). Adds `source: 'admin-cash'` to the transaction doc and stamps `paidBy: 'cash' | 'card'`.
- Wired into the new check-in dashboard (Phase H) — staff types plate, picks pack quantity or arbitrary amount, submits.
- Audit-logged. Sends E3 (credit-purchase email) automatically via the existing Firestore trigger from Phase E.

### G5. Forgot-password UI

- `src/pages/auth/Login.js` — add "Ai uitat parola?" link below the password field. Opens a small inline form; on submit, calls new callable `requestPasswordReset({ email })`. Function uses `generatePasswordResetLink` + writes to `mail` with the `password-reset-ro/en` template.

---

## Phase H — Unified Admin Check-In Dashboard (~1.5 days) ✅

### H1. Route + scaffolding

- New file `src/pages/admin/AdminCheckIns.js`. Route `/admin/checkins` (`['auth','admin']`). Add to `AdminLayout.js` nav as "Check-in / Check-out". Make this the *default* admin landing route (replace `/admin` → `/admin/checkins` redirect in router; old dashboard stays at `/admin/dashboard`).

### H2. Unified data view

- Query `bookings` where `status in ['upcoming','active']` AND `startDate` within ±48h, `orderBy startDate`. Real-time `subscribeCollection`.
- Query `activeCheckIns` (all docs — small collection). Real-time.
- Client-side join: for each booking, find matching `activeCheckIns` doc by plate. Construct row shape:
  ```js
  {
    code,                                  // LT-XXX / CR-XXX (or 'MNG-XXX' legacy, or plate fallback)
    plate,
    type: 'longTerm' | 'credit',
    customerName,
    expectedCheckinAt,                     // booking.startDate
    actualCheckinAt,                       // activeCheckIns.checkinTime || booking.checkinTimestamp
    expectedCheckoutAt,                    // booking.endDate
    actualCheckoutAt,                      // booking.completedAt
    paymentStatus,                         // 'paid' | 'unpaid'
    spotId,
  }
  ```

### H3. UI

- Table on desktop (`md:` and up), card list on mobile (`375px` priority).
- Columns: Code | Plate | Type | Check-in (color flag) | Check-out | Status | Actions
- Flags:
  - paid (green badge, leaf color)
  - unpaid (red badge)
  - awaiting check-in (mango)
  - completed (charcoal-muted)
- Actions per row:
  - **Check in** → for longTerm: `checkInBooking(bookingId, spotId)`. For credit: open plate-input flow → `useToken(balanceDocId, plate)`.
  - **Check out** → for longTerm: `checkOutBooking(bookingId)`. For credit: `checkOut(plate)` from `tokenService`.
  - **Mark paid** (only if unpaid) → opens dialog with `cash|card`, calls `adminMarkOrderPaid({ orderId, paidBy })`.
  - **Grant credits (cash)** → side button on the page (not per-row), opens dialog from Phase G4.

### H4. Manual check-in for walk-ins (no prior booking)

- "Check in walk-in" button → dialog asks plate + quantity to grant + payment confirmation.
- Flow: `grantCreditsForCash` → `useToken` (auto-decrements 1, creates `activeCheckIns`). Two server calls, one user click.

### H5. Friction reduction for plate-to-customer linking

- When admin enters a plate, autocomplete suggestions from `tokenBalances` `plates` array (existing pattern via `lookupByPlate`) + `users/{uid}.vehicles`. Show customer name if matched.
- If no match: ask for payer email + name inline (becomes the `tokenBalances/plate_*` doc — `userMergeService` will fold this into the customer's account on their next login as long as the email matches the auth email).

---

## File-Level Touch Summary

**New files (~13):**
- `src/components/core/WhatsAppFab.js`
- `src/components/core/FormDateTime.js`
- `src/styles/flatpickr-theme.css`
- `src/utils/bookingCode.js`
- `src/utils/pricing.js`
- `src/pages/admin/AdminUsers.js`
- `src/pages/admin/AdminCheckIns.js`
- `src/pages/auth/FinishSignup.js`
- `src/pages/public/PayOrder.js` (for the pay-now link in pay-at-pickup confirmation)
- `functions/src/emails.js`
- `functions/src/scheduled.js`
- `functions/src/emailTemplates.js`
- `functions/src/cui.js` (ANAF lookup wrapper)

**Modified files (~15):**
- `src/main.js` (mount WhatsApp FAB)
- `src/i18n/ro.js`, `src/i18n/en.js` (copy rename, billing keys, picker locale strings, email triggers, admin UI strings, WhatsApp message)
- `src/components/widgets/BillingFields.js` (expand schema)
- `src/components/widgets/icons.js` (WhatsApp icon)
- `src/components/admin/AdminLayout.js` (new nav items)
- `src/utils/validators.js` (CNP/CI/passport validators)
- `src/utils/constants.js` (Brevo URLs if needed)
- `src/services/longTermService.js` (code + paymentMethod fields)
- `src/pages/public/BookingLongTerm.js`, `BookingCredits.js` (pay-method radio + picker swap)
- `src/pages/auth/Login.js` (forgot-password link), `Register.js` (locale field on signup)
- `src/router/routes.js` (4 new routes)
- `src/router/index.js` (admin landing redirect)
- `src/style.css` (drop flatpickr CSS, scoped now)
- `functions/src/index.js` (createPayment paymentMethod branch, admin callables, mark-paid)
- `firestore.rules` (pendingOrders update path for staff)
- `firestore.indexes.json` (composite index for `bookings` queries on `status` + `startDate` if the H2 query needs it)

---

## Reused Utilities (Don't Reinvent)

- `src/utils/dom.js` — `html` tagged template, `mount`, `qs`, `delegate`, `setFieldError`, `clearErrorOnInput` — every new component uses these.
- `src/components/core/{Modal,Toast,Loader,FormField}.js` — the AdminUsers modals, the pay-method radios, the mark-paid dialog all reuse these.
- `src/firebase/db.js` — `getDocument`, `setDocument`, `incrementField`, `subscribeCollection` — no new wrappers needed.
- `src/services/auditService.js` — `auditLog()` on every admin-mutating action (Phase G + H).
- `src/services/discountService.js` `getOnlineDiscountPercent()` — Phase D pricing math.
- `src/utils/date.js` — for the picker's display formatting and the 24h+window scheduled-function queries.
- `localePath()` + `t()` from `src/i18n/index.js` — every new link + every string.
- Cloud Function helper `assertAdmin(request)` — add once in `functions/src/auth.js` (new), reuse in every admin callable.

---

## Verification

Run after each phase, not just at the end.

### Phase A
- DNS: `dig TXT mangoparking.ro` shows SPF/DKIM; Brevo dashboard sender verified.
- Trigger Email extension: write a doc by hand to `mail` collection — receive email in ~30s.
- Copy rename: visit `/` and `/booking`, RO + EN — Home hero and Booking funnel show "Rezervă parcare navetiști". CTAs still link to `/booking/credits`.
- WhatsApp FAB: present on every public + account page, absent on `/admin/*`. Mobile (375px) tap area ≥44px.

### Phase B
- Create a booking — `bookings/{id}` has `code: LT-XXXXX`, `paymentMethod`, `paymentStatus`. Generate 100 codes in console, no duplicates.
- Billing form: try CNP `1850101410012` (valid checksum), `1234567890123` (invalid) — UI shows error correctly.
- CUI lookup: `RO14186770` (a real CUI) → company prefilled. Bad CUI → manual entry preserved.

### Phase C
- BookingLongTerm: click *anywhere* on date field (not just icon) — picker opens.
- Picker shows 24h time, Romanian month names in RO locale, English in EN.
- Pick a time, submit — Firestore doc has ISO timestamp.

### Phase D
- Toggle "pay at pickup" on long-term booking → price line shows base price (not discounted). Email arrives with discount-nudge copy.
- Admin clicks "Mark paid" → `bookings.paymentStatus` flips to `paid`, no money moved.
- Pay-at-pickup credit pack: `pendingOrders` doc created with `awaiting-payment`, tokens NOT credited yet. After "Mark paid", tokens credited via the same `creditTokens` path.

### Phase E
- Create a fresh account → signup-welcome email lands.
- Buy a credit pack → credit-purchase email lands.
- Use a credit → credit-used email lands.
- Drop balance to 2 by using a credit when at 3 → low-credit-warning lands.
- Click "forgot password" → password-reset email lands; link works.

### Phase F
- Manually trigger scheduled functions via Firebase Console → no errors. Set test booking with start tomorrow at 10:00 → trigger E8 manually → email arrives.
- 19:00 commuter check: seed `activeCheckIns` with today's plate, run manually → reminder email arrives.

### Phase G
- Admin → /admin/users → "Create user" direct: new user appears in Firebase Auth console + `users/{uid}` doc exists.
- Admin → "Send invite": invite email lands; clicking the link opens `/auth/finish-signup`; setting password completes signup.
- Admin → "Grant credits (cash)" with plate + qty: `tokenBalances/plate_*` balance increments; transaction logged with `source: 'admin-cash'`.

### Phase H
- /admin/checkins shows today's bookings in real-time (open second browser, create booking, see it appear).
- Manually check in a longTerm booking → status flips to active, timestamp recorded, spot occupancy updates in /admin/capacity.
- Check in a credit walk-in (no prior booking): plate + qty + cash → credit balance set → token used → row appears as active.
- Mark unpaid booking as paid → red badge → green badge in real time.

### Cross-cutting (before declaring done)
- `npm run build` — clean, no new warnings.
- Lighthouse on `/`, `/booking`, `/admin/checkins` — no regression vs baseline.
- 375px viewport pass on every changed page.
- Keyboard nav through every new modal (Tab, Enter, Esc).
- i18n parity audit: every new string exists in both `ro.js` and `en.js`. Run a quick script (or eyeball diff) of key sets.
- Firestore rules: deploy to a staging project, run the rules unit tests (write a `firestore-rules.test.js` with the emulator for the new `pendingOrders` update path and the `users` admin-update path — minimum 6 test cases).
- `firebase deploy --only firestore:rules,firestore:indexes,hosting,functions` to staging, smoke-test the Netopia sandbox + a pay-at-pickup booking end-to-end.

---

## Estimated Effort

| Phase | Days |
|---|---|
| A — Foundations | 1.5 |
| B — Booking data model | 1.0 |
| C — Date picker | 1.0 |
| D — Pay-at-pickup | 1.0 |
| E — Email triggers | 1.5 |
| F — Scheduled functions | 0.5 |
| G — Admin auth tools | 1.0 |
| H — Check-in dashboard | 1.5 |
| **Total** | **~9 days** of focused work |

Phases A through E are roughly linear (each builds on Brevo); Phase C is independent and can run in parallel. Phases G and H share the admin layout and can interleave.

---

## Open Items (defer past v1)

- SMS reminders (Brevo supports them; out of scope here).
- LPR camera integration for auto check-in (explicitly future per the brief).
- Per-user usage analytics dashboard for admins.
- A/B testing pay-at-pickup discount % to find the conversion sweet spot.
- Brevo template synchronization repo (currently templates live in Brevo dashboard; if churn becomes painful, port to a templates/ folder + sync script).
