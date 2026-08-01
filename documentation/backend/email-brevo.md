# Email — Brevo

> Status: ✅ Shipped · Last verified: 2026-07-09

All outbound email goes through **Brevo** (transactional API,
`https://api.brevo.com/v3/smtp/email`). There are two distinct channels:

1. **Customer transactional** — branded Brevo **templates** (numeric IDs), fired from
   Firestore triggers and scheduled jobs (`functions/src/emails.js`,
   `functions/src/scheduled.js`, plus two callables in `index.js`). Welcome, booking +
   credit confirmations, credit-used / low-credit, reminders, refund, voucher-assigned,
   invite, password reset.
2. **Ops alerts to `rezervari@`** — **inline-HTML** sends, no template, from
   `functions/src/adminNotifications.js` (+ the contact-form alert in `emails.js`).
   Signup, reservation, cancellation/no-show, refund, credit-purchase, password-reset,
   contact-form.

The single secret is `BREVO_API_KEY` (`functions/src/brevo.js:17`), bound on every
trigger/callable that sends. Sender + reply-to default to
`rezervari@mangoparking.ro` (`brevo.js:21`). All regions `europe-west1`.

Related: [./payments-netopia.md](./payments-netopia.md) (what triggers the booking /
refund docs that email) · [./integrations.md](./integrations.md).

---

## The wrapper — `functions/src/brevo.js`

Two thin senders, both **swallow-on-failure** (log + return `{ skipped }` rather than
throw — a failed email must never retry-loop a customer flow):

- **`sendBrevoEmail({ to, name, templateName, locale, params, tags, bcc })`**
  (`brevo.js:26`) — resolves the numeric template ID via
  `templateId(templateName, locale)`, POSTs to Brevo with `templateId` + `params`.
  Brevo renders the template (mustache + `{% if %}`) server-side. If the ID is still
  `null` (template not yet paired), it logs and returns `{ skipped:true,
  reason:'no-template-id' }` — so functions can deploy before every template is live.
- **`sendBrevoRaw({ to, name, subject, html, replyTo, tags })`** (`brevo.js:87`) —
  subject + `htmlContent`, **no template**. Used for internal/staff notifications
  where maintaining a Brevo template is overkill.

### Template ID map — `functions/src/emailTemplates.js`

`templateId(name, locale)` (`emailTemplates.js:60`) looks up
`TEMPLATES['{name}-{locale}']`, falling back to the other locale so a missing
translation never blocks a send. The map (`emailTemplates.js:17`) currently pairs
every template with an ID:

| Name | RO / EN IDs | Sent by |
|---|---|---|
| `signup-welcome` | 4 / 5 | `onUserCreated` |
| `password-reset` | 6 / 7 | `requestPasswordReset` |
| `admin-invite` | 8 / 1 | `adminSendInvite` |
| `booking-longterm-confirm` | 2 / 9 | `onBookingCreated`, `sendBookingConfirmationEmail`, `sendRepayPaidEmail`. **Broker/prepaid bookings** (ParkVia, Parkos et al.) pass `broker:true`, which strips the entire payment block — method, total and the pay-online promo — see [Broker bookings](#broker--prepaid-bookings-carry-no-payment-information). |
| `booking-refunded` | 22 / 21 | `sendRefundIssuedEmail` |
| `booking-cancelled` | 29 / 30 | `sendBookingCancelledEmail` — cancellation confirmation; with `refundPending:true`, adds a "refund on its way" box (card vs desk wording via `channel`). |
| `booking-repriced` | 28 / 27 | `sendBookingRepricedEmail`, `sendExtensionPaidEmail`, `sendBookingRequoteEmail` — extension payment request (pay online w/ discount, or at arrival) + its paid follow-up; with `requote:true`, the unpaid-re-quote variant showing the new total instead of a difference. |
| `credit-purchase` | 3 / 10 | `handlePurchase` (token purchase) |
| `credit-used` | 11 / 12 | `handleUse` |
| `low-credit-warning` | 13 / 14 | `handleUse` (crossing ≤2 credits) |
| `voucher-assigned` | 23 / 24 | `onPromoVoucherAssigned` |
| `credit-voucher-assigned` | 26 / 25 | `onPromoVoucherAssigned` (credits gift) |
| `reminder-checkin-24h` | 15 / 16 | `daily24hReminders` (E8) |
| `reminder-checkout-24h` | 17 / 18 | `daily24hReminders` (E9) |
| `reminder-commuter-7pm` | 19 / 20 | `commuter7PMCheck` (E10) |

`listMissing()` (`emailTemplates.js:70`) reports any still-`null` entries.

### The HTML source files & the sync script

The template bodies live as source in **`email-templates/*.html`** (repo root, 28
files — one per name × locale):

```
admin-invite-{ro,en}.html            booking-longterm-confirm-{ro,en}.html
booking-refunded-{ro,en}.html        credit-purchase-{ro,en}.html
credit-used-{ro,en}.html             credit-voucher-assigned-{ro,en}.html
low-credit-warning-{ro,en}.html      password-reset-{ro,en}.html
reminder-checkin-24h-{ro,en}.html    reminder-checkout-24h-{ro,en}.html
reminder-commuter-7pm-{ro,en}.html   signup-welcome-{ro,en}.html
voucher-assigned-{ro,en}.html
```

**The repo is the source of truth, synced to Brevo via API** (since 2026-07-20).
Brevo renders from templates stored in its dashboard, keyed by the numeric IDs in
`emailTemplates.js` — but editing a `.html` file here no longer means hand-pasting:
**`scripts/sync-brevo-templates.mjs`** pushes the files over Brevo's template API
(`PUT /v3/smtp/templates/{id}`). Each file's line-1 `<!-- subject: ... -->` comment
is the subject of record — `push` sends `htmlContent` + `subject` + `templateName`
(= the map key); sender, reply-to and active state stay as configured in Brevo.

```powershell
$env:BREVO_API_KEY = (firebase functions:secrets:access BREVO_API_KEY)
node scripts/sync-brevo-templates.mjs list    # remote inventory vs the ID map
node scripts/sync-brevo-templates.mjs diff    # html/subject/name drift per template
node scripts/sync-brevo-templates.mjs push --all          # or: push <key> [...]
node scripts/sync-brevo-templates.mjs pull <key>           # remote HTML -> local file
```

Run `diff` before `push` — if someone edited a template in the Brevo UI, `pull` it
(or port the change by hand) first, otherwise `push` overwrites it. A brand-new
template still needs `POST /v3/smtp/templates` (or a dashboard create) and its
assigned ID dropped into the map before its send stops returning `{ skipped:
'no-template-id' }`; only bump an ID if you delete + recreate. One-shot wording
rounds live in `email-templates/wording-edits/` (source .docx from the team; the
2026-07 round is applied).

### Broker / prepaid bookings carry NO payment information

A reservation booked through a broker (ParkVia, Parkos et al.) was paid **to the
third party, at the third party's price**. Neither figure is ours to state, so
the confirmation email shows **no payment information at all** — no method, no
total, and no "pay online and save `{discountPct}`%" promo. The customer owes us
nothing, our online discount does not apply to their reservation, and printing
our `totalPrice` invites a "why is this different?" support call.

Both broker routes produce the same doc via **`createBrokerBookingCore`** —
`source: 'broker'`, `paidBy: 'broker'`, `paymentMethod: 'broker'`,
`paymentStatus: 'paid'`, `brokerName` — so one predicate covers both:

| Route | Entry point |
|---|---|
| Manual desk entry | `adminCreateLongtermBooking` with `paidBy: 'broker'` (New-reservation modal → **Broker / prepaid**) |
| ParkVia auto-import | `runParkviaSync` |

`isBrokerBooking(booking)` (`functions/src/brokerBooking.js`, pure + unit-tested
in `functions/test/broker.test.js`) returns true on **any** of those markers.
`sendBookingConfirmationEmail` and `sendRepayPaidEmail` both pass the result as
`broker`, and forcing `paid` true alongside it means the promo stays hidden even
if a broker booking's `paymentStatus` is somehow not `paid`. The template wraps
the whole payment block in `{% if not params.broker %}` — written as `not`
rather than `== false` so an absent param can never blank the block for ordinary
bookings.

> **This only reaches bookings actually marked as broker.** A prepaid
> third-party reservation typed in as a plain pay-at-pickup booking carries no
> broker marker, still reads as `unpaid`, and *will* get the promo and a total.
> Enter those through the New-reservation modal's **Broker / prepaid** payment
> option (which also asks for the broker name), or let the ParkVia auto-import
> create them. Reported by the client 2026-08-01 for Parkos reservations.

Template edits need a push to reach customers:
`node scripts/sync-brevo-templates.mjs push booking-longterm-confirm-ro booking-longterm-confirm-en`
(push takes the per-locale keys, not the shared template name).

**Two template-syntax traps, both learned the hard way:**

1. **`{# … #}` comments must stay on ONE line.** A newline inside one makes
   Brevo reject the whole push with
   `invalid_parameter … Newline not permitted in a single-line comment`.
   The API validates before writing, so a bad template fails loudly rather than
   corrupting the live one — but the push does abort partway through a batch.
2. **Test an absent param with `{% if not params.x %}`, never `{% if params.x == false %}`.**
   Brevo resolves a missing param to `''`, and `'' == false` is falsy — so the
   `== false` form silently *hides* a block for every sender that doesn't pass
   the flag. `booking-longterm-confirm` has three senders; only some pass
   `broker`.

---

## Channel 1 — customer transactional (`functions/src/emails.js`)

Every trigger reads its doc, resolves the recipient (`resolveRecipient`,
`emails.js:82` — tries `users/{uid}` → guest `tokenBalances/plate_X` → the doc's own
`contact`), builds params, and calls `sendBrevoEmail`. Each claims a one-shot
idempotency field in a transaction (v2 Firestore triggers can fire twice). Times are
formatted in `Europe/Bucharest` (`fmtDateTime`, `emails.js:44`).

| Trigger | Fires on | Email(s) |
|---|---|---|
| `onUserCreated` (`emails.js:136`) | `users/{uid}` create | **E1 `signup-welcome`**. Skips if a `pendingInvites/{email}` exists (invitees get the branded invite instead). Idempotency: `welcomeEmailSentAt`. |
| `onBookingCreated` (`emails.js:187`) | `bookings/{id}` create | **E2 `booking-longterm-confirm`** (long-term only). Idempotency: `confirmEmailSentAt`. Delegates to `sendBookingConfirmationEmail`. |
| `onTokenTransactionCreated` (`emails.js:385`) | `tokenTransactions/{id}` create | Branches on `type`: `purchase` → **E3 `credit-purchase`**; `use` → **E4 `credit-used`** + conditional **E5 `low-credit-warning`**. Idempotency: `emailSentAt`. |
| `onContactMessageCreated` (`emails.js:517`) | `contactMessages/{id}` create | Ops alert to `rezervari@` (raw HTML, see channel 2). Idempotency: `notifiedAt`. |
| `onPromoVoucherAssigned` (`emails.js:610`) | `promoVouchers/{code}` write | **`voucher-assigned`** (or **`credit-voucher-assigned`** for credit gifts) to each newly-assigned private-voucher recipient. Idempotency: `voucherEmailSentTo[]`. Public vouchers don't email. |

Reusable senders (not triggers themselves — called from callables / the IPN):

- **`sendBookingConfirmationEmail(bookingId)`** (`emails.js:230`) — reflects the
  booking's current state: a paid booking gets the "paid" branch; an unpaid
  pay-at-pickup booking gets the pay-online nudge with the live discount and a
  `/pay?orderId=…` link. Used by `onBookingCreated` and `adminResendConfirmationEmail`.
- **`sendRepayPaidEmail(bookingId)`** (`emails.js:282`) — a fresh "payment received"
  confirmation sent from `netopiaCallback` when a pay-at-pickup booking is repaid
  online (the create-trigger already fired at order time with `paid:false`).
- **`sendBookingCancelledEmail(bookingId)`** (`emails.js`) — **`booking-cancelled`**.
  Sent best-effort from `cancelBookingWithRefund` after the cancellation lands
  (both self-service and staff cancels; the no-show conversion sends nothing —
  the fee is forfeited). `refundPending` adds a "refund on its way" box; the
  amount shown is the **charged** amount (`pendingOrders.amount`, falling back
  to `totalPrice` for desk bookings with no linked order) and `channel`
  (`card`/`desk`) picks the wording. The `booking-refunded` email follows later
  when staff mark the refund processed.
- **`sendRefundIssuedEmail(bookingId)`** (`emails.js:322`) — **`booking-refunded`**.
  Called by `adminMarkRefunded` (auto) or a manual resend. Picks channel copy from
  `refundedVia` (`cash` vs `card`) and persists a `refundEmail` status block on the
  booking so the admin refund history can show sent/failed and offer a resend.
- **`sendBookingRepricedEmail(bookingId, extOrderId)`** / **`sendExtensionPaidEmail(...)`**
  (`emails.js`) — **`booking-repriced`**. The first is sent from `adminRepriceBooking`
  (`paidBy:'email'`) with the modified dates + the owed difference and both payment
  options (online at the discounted amount via `/pay?orderId=<extOrderId>`, or standard
  at arrival); the second is the paid follow-up from `netopiaCallback` when the extension
  is paid online.
- **`sendBookingRequoteEmail(bookingId)`** (`emails.js`) — **`booking-repriced`**
  with `requote:true`, which flips the template copy from "difference owed" to
  "new total". Sent automatically from `adminRepriceBooking` when an **unpaid**
  booking's dates change the total (any direction): shows the re-quoted total
  with pay-online (discounted, `/pay?orderId=<paymentId>` — the booking's own
  pending order, i.e. the `repayOrder` path) or pay-at-arrival. Bookings without
  a linked order get no pay link (the template hides the online block via
  `{% if params.payOnlineLink %}`). Best-effort; the callable returns
  `emailed:true/false` so the admin toast can say whether the client was notified.

Two more customer templates are sent from callables in `functions/src/index.js`:

- **`requestPasswordReset`** (`index.js:3248`) — mints a branded reset link via the
  Admin SDK and sends **`password-reset`**. Always returns `ok` (never leaks whether
  an email is registered). Also fires the ops alert (channel 2). Replaces Firebase
  Auth's built-in reset email.
- **`adminSendInvite`** (`index.js:3529`) — generates a magic sign-in link, stashes
  the assigned role in `pendingInvites/{email}`, and sends **`admin-invite`**. The
  `pendingInvites` doc is what makes `onUserCreated` suppress the welcome email so an
  invitee isn't double-mailed.

### Scheduled reminders (`functions/src/scheduled.js`)

Three cron jobs (`Europe/Bucharest`), each stamping a per-doc field so a manual re-run
doesn't double-send:

- **`daily24hReminders`** (`scheduled.js:95`, 10:00) — scans long-term bookings; sends
  **E8 `reminder-checkin-24h`** ~24h before drop-off and **E9 `reminder-checkout-24h`**
  ~24h before pickup (±1h window). Idempotency: `reminderCheckinSentAt` /
  `reminderCheckoutSentAt`.
- **`commuter7PMCheck`** (`scheduled.js:191`, 19:00) — every commuter still in
  `activeCheckIns` from today gets **E10 `reminder-commuter-7pm`** (1-hour warning
  before the 20:00 cutoff). Idempotency: `reminderCommuterSentAt`.
- **`expireStaleHolds`** / **`markNoShows`** — housekeeping only, no email
  (`scheduled.js:354` / `:274`).

---

## Channel 2 — ops alerts to `rezervari@` (`functions/src/adminNotifications.js`)

Internal alerts so staff see customer activity as it happens. All are **inline-HTML**
via `sendBrevoRaw` — no Brevo template/ID pairing, so they work the moment the
function deploys. Shared branded card renderer: `adminEmailHtml` / `notifyAdmin`
(`adminNotifications.js:61`). Scope is **customer-initiated only** — admin/desk actions
(walk-ins, credit-desk grants, admin-created accounts) are deliberately skipped so
staff aren't pinged for their own actions. Each claims a one-shot field via
`claimOnce` (`adminNotifications.js:91`); `replyTo` is set to the customer so staff can
reply straight from the alert.

| Handler | Fires on | Alert |
|---|---|---|
| `adminNotifyUserCreated` (`:112`) | `users/{uid}` create | "Cont nou creat" — name/email/phone/role, self-signup vs admin-created (`createdBy`). Claim: `adminNotifiedAt`. |
| `adminNotifyBookingCreated` (`:144`) | `bookings/{id}` create (long-term) | "Rezervare termen lung nouă" — code, source, contact, plate, period, total, pay state. Claim: `adminNotifiedAt`. |
| `adminNotifyBookingCancelled` (`:189`) | `bookings/{id}` update (status change) | "Rezervare anulată" / "Anulare cu refund de procesat" / "No-show", **and** "Refund procesat" on the `refunded` transition. Claims: `adminCancelNotifiedAt`, `adminRefundNotifiedAt`. |
| `adminNotifyCreditPurchase` (`:251`) | `tokenTransactions/{id}` create (`type:'purchase'`) | "Credite cumpărate" — quantity, amount, plate, buyer, pay method. Claim: `adminNotifiedAt`. |
| `notifyAdminPasswordReset` (`:294`) | called from `requestPasswordReset` | "Cerere de resetare parolă". Not a trigger — only invoked after a link was minted (i.e. the account exists), so it can't enumerate accounts. |
| `onContactMessageCreated` (`emails.js:517`) | `contactMessages/{id}` create | "Contact site: …" — the site contact form; `replyTo` = the submitter. |

Because these share the same source collections as channel 1's triggers
(`users`, `bookings`, `tokenTransactions`), a single customer action typically fires
**both** a branded customer email and a raw ops alert — they use separate idempotency
fields and don't collide. `sendBookingConfirmationEmail` deliberately omits a BCC to
`rezervari@` since `adminNotifyBookingCreated` already covers the ops side.

---

## Conventions & gotchas

- **Locale** — `ro` default, `en` when the user profile / doc says so; template
  fallback covers a missing translation.
- **Recipient resolution order** — logged-in `users/{uid}` → guest
  `tokenBalances/plate_X` → doc `contact.email`. A guest with no stored email gets no
  email (returns `null`, logged).
- **Idempotency everywhere** — v2 Firestore triggers are at-least-once; every sender
  claims a one-shot marker field in a transaction before sending.
- **Never throws** — both `brevo.js` senders and every handler swallow failures so a
  Brevo outage or a missing template ID can't wedge signup/booking/payment flows.
- **Times are Bucharest-pinned** — the Functions runtime is UTC; all formatters pass
  `timeZone: 'Europe/Bucharest'` so emails match the website's local times.
