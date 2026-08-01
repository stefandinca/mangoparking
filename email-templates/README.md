# Email templates — Mango Parking

Source-of-truth HTML for the 11 transactional emails the app sends. Each
template has a Romanian and an English variant (22 files total). The
recipient's locale is read from `users/{uid}.locale` server-side; the
Cloud Function picks the right template ID.

## Workflow

> **Updated 2026-08-01 — these files are the SOURCE OF TRUTH, not reference
> copies.** Since 2026-07-20 they are pushed to Brevo over the template API by
> `scripts/sync-brevo-templates.mjs`; editing a file here and running `push` is
> the supported way to change an email. The hand-pasting steps below are the
> original one-time setup, kept for creating a brand-new template (which still
> needs an ID assigned in `functions/src/emailTemplates.js`).
>
> ```powershell
> $env:BREVO_API_KEY = (firebase functions:secrets:access BREVO_API_KEY)
> node scripts/sync-brevo-templates.mjs diff          # check for UI-side drift first
> node scripts/sync-brevo-templates.mjs push --all    # or: push <key> [...]
> ```
>
> Full detail: [documentation/backend/email-brevo.md](../documentation/backend/email-brevo.md).

The original one-time setup (per template):

1. **Brevo dashboard → Templates → Create a new template → HTML editor.**
2. Paste the entire contents of one `.html` file.
3. Set the **subject line** at the top of Brevo's template form (the
   suggested subject for each template is in the `<!-- subject: ... -->`
   HTML comment at the top of the file — Brevo doesn't read it).
4. Save. Brevo assigns a numeric template ID.
5. Send yourself a test email — Brevo's test panel lets you supply the
   `params` JSON, e.g. `{ "firstName": "Ana", "code": "LT-ABC23" }`.
6. Record the numeric ID in `functions/src/emailTemplates.js` against
   the template name.
7. Repeat for all 22 files.

Total time once you're logged into Brevo: ~30 minutes.

## Editing copy later

Edit in Brevo (no code redeploy needed). Optionally update the `.html`
file in this folder to keep the repo in sync — handy for diffing future
changes or rebuilding from scratch.

## Adding a new variable

1. Add `{{ params.newField }}` in the Brevo template.
2. Pass `newField` from the Cloud Function trigger when writing to
   `mail` collection.

## Brevo template syntax cheat sheet

- `{{ params.firstName }}` — variable substitution
- `{% if params.paid %}...{% endif %}` — conditionals
- `{% if params.discountPct > 0 %}...{% else %}...{% endif %}`
- `{% for v in params.items %}...{% endfor %}` — loops

## The 11 emails

| ID | Trigger | Recipient | Params |
|---|---|---|---|
| `signup-welcome` | `users/{uid}` onCreate | new user | firstName |
| `booking-longterm-confirm` | `bookings/{id}` onCreate, type=longTerm | booking contact | firstName, code, plate, days, dropoffAt, pickupAt, totalAmount, paid (bool), payOnlineLink, discountPct |
| `credit-purchase` | `tokenTransactions/{id}` onCreate, type=purchase | customer | firstName, quantity, totalAmount, balanceAfter, plate, paid (bool), payOnlineLink, discountPct |
| `credit-used` | `tokenTransactions/{id}` onCreate, type=use | customer | firstName, plate, balanceAfter, dateUsed |
| `low-credit-warning` | from credit-used handler when balance ≤ 2 | customer | firstName, balanceRemaining, buyMoreLink |
| `password-reset` | callable `requestPasswordReset` | user | firstName, resetLink, expiresIn |
| `admin-invite` | callable `adminSendInvite` | invitee | firstName, signupLink, invitedByName |
| `reminder-checkin-24h` | scheduled, daily 10:00 | upcoming booking contact | firstName, code, plate, dropoffAt |
| `reminder-checkout-24h` | scheduled, daily 10:00 | active booking contact | firstName, code, plate, pickupAt |
| `reminder-commuter-7pm` | scheduled, daily 19:00 | active commuter | firstName, plate, cutoffTime |
| `voucher-assigned` | `promoVouchers/{code}` onWrite, visibility=private | each newly-assigned user | firstName, voucherName, code, valueText, validFrom, validTo, description, vouchersLink |

## Design system

- **Brand colors:** mango `#FDBB30`, blueberry `#1E5BD6`, blueberry-deep `#0F2D66`, leaf `#4FBD46`, frost `#FFF8E8`, charcoal `#1A1A1A`.
- **Heading font:** Nunito (web-safe fallback Georgia, then serif).
- **Body font:** Helvetica Neue / Helvetica / Arial / sans-serif (email-safe stack).
- **Layout:** single column, 600px max width, table-based for client compat.
- **Inline CSS only** — Gmail strips `<style>` blocks for some clients.
- **Mascot logo:** `https://mangoparking.ro/images/logo.png` (absolute URL — Brevo cannot reach `/images/...` relative).

## Hosted on:

- Domain: mangoparking.ro (SPF + DKIM + DMARC configured in Brevo)
- Sender: `rezervari@mangoparking.ro`
- Reply-to: same
