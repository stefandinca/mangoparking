# Billing (PF/PJ invoice identity)

> Status: 🟢 Captured **and consumed** — SmartBill Phase 2 issues documents from
> this data on the paid flows · Last verified: 2026-07-17

## What it is

At checkout (and at the admin desk) we capture the customer's **fiscal invoice
identity** so an invoice can be issued later:

- **PF (Persoană fizică)** — full name (one field), locality (oraș), personal
  address, and an **optional** CNP.
- **PJ (Persoană juridică)** — company name, **CUI** (required in the public
  funnels), Reg.Com (optional), company address. A CUI lookup autofills company
  name / address / Reg.Com from ANAF.

The data is validated, sanitized and stored on the order/booking/transaction
and cached on the user profile. Since v1.2 Phase 2 (2026-07-17) it is also
**consumed**: SmartBill proformas are issued from it on every order and fiscal
invoices on online payment confirm — a billing record that fails the
server-side mandatory-field check (`checkBillingComplete`) stamps
`smartbill.status='failed'` with the missing fields instead of issuing. See
[roadmap/v.1.2_smartbill.md](../roadmap/v.1.2_smartbill.md) and
[backend/cloud-functions.md](../backend/cloud-functions.md). Billing rides along
with [credits](credits.md) and [long-term bookings](long-term-bookings.md).

## How it works

### Public widget (`BillingFields.js`)

`src/components/widgets/BillingFields.js` is the reusable block used by
`BookingCredits.js`, `BookingLongTerm.js` and the account profile:

- `billingFieldsHtml(initial)` renders the PF/PJ toggle + fields, prefilled from
  a saved profile record when `initial` is passed.
- `wireBillingToggle(scope)` wires the PF/PJ switch and the **CUI autofill**:
  600 ms after typing stops, a valid CUI hits `cuiService.lookupCui` (the
  `lookupCui` Cloud Function, an ANAF wrapper) and fills empty
  `billingCompanyName` / `billingCompanyAddress` / `billingRegCom`
  (`BillingFields.js:119`). It only fills blank fields, never clobbers typed
  input.
- `readBilling(scope)` validates and returns the billing object, or
  `{ error }` (field-level errors highlighted in place):
  - **PF** → `{ type:'PF', name, firstName, lastName, locality, address, cnp? }`.
    Name/locality/address required; CNP optional but checksum-validated if
    present. `firstName`/`lastName` are derived from `name` (first token / rest)
    for backward compatibility with older consumers.
  - **PJ** → `{ type:'PJ', companyName, cui, regCom, companyAddress }`. Company
    name + CUI + address required (`isValidCui`), Reg.Com optional
    (`isValidRegCom`).

The booking pages also offer a **"billing = same as contact"** convenience that
copies the contact name into the PF billing name and tints it (still editable —
typing releases the sync); hidden for PJ.

### Admin desk (`CreateTransactionModal.js`)

The walk-in / admin-created flows use their own inline billing block
(`src/components/admin/CreateTransactionModal.js:366`) — PF fields are **Nume /
Prenume / Adresă / CNP(optional)** and PJ is **Company / CUI / Company address**
with the same debounced CUI autofill.

- **Mandatory** on admin-created long-term reservations and credit-pack sales
  (`billingNeeded = isLT || (isCredit && !useExisting)`, `:604`); hidden for
  transfers and credit *check-in* (no money → no invoice).
- `readCtBilling()` (`:754`) validates and returns `{ billing }`. Here PF
  produces `name: "${nume} ${prenume}"` (last + first) with
  `firstName`/`lastName` split out; CUI is **optional** at the desk (validated if
  given), unlike the public PJ funnel where CUI is required.
- `applyBillingToForm(b)` (`:716`) prefills the block from a **matched
  customer's** saved `users/{uid}.billing`, re-applying only when the resolved
  account changes so it doesn't clobber the agent's edits.

### Server sanitize + persistence

Every callable that accepts billing runs it through `sanitizeBilling(raw)`
(`functions/src/index.js:2229`): coerces to strings, trims, caps each field at
200 chars, drops unknown keys, emits no `undefined` (Firestore rejects it), and
falls back to a bare `{ type: 'PF' }` when nothing usable is provided. It's
called by `adminCreateLongtermBooking` (`:2310`) and `grantCreditsForCash`
(`:2505`).

The sanitized billing is written onto:
- the `bookings` doc (`billing` field, via `createBookingFromOrder` /
  `adminCreateLongtermBooking`),
- the `tokenTransactions` `purchase` row (`creditTokens`),
- and **cached onto `users/{uid}.billing`** (`{ merge: true }`) for future
  prefill — done by `creditTokens` (`index.js:181`),
  `createBookingFromOrder` (`:293`) and `adminCreateLongtermBooking` (`:2418`),
  for logged-in customers only (guests have no profile).

## Key files

| File | Role |
|---|---|
| `src/components/widgets/BillingFields.js` | Public PF/PJ block: `billingFieldsHtml`, `wireBillingToggle`, `readBilling`. |
| `src/components/admin/CreateTransactionModal.js` | Admin desk billing block + `readCtBilling` + `applyBillingToForm` (mandatory on LT + credit sales). |
| `src/services/cuiService.js` | Client wrapper for the `lookupCui` ANAF call. |
| `functions/src/index.js` | `sanitizeBilling`, plus persistence in `creditTokens` / `createBookingFromOrder` / `adminCreateLongtermBooking`. |
| `functions/src/cui.js` | `lookupCui` — ANAF lookup, 24h-cached in `lookupCache`. |

## Data (Firestore)

Billing is an **embedded object**, not its own collection. Two shapes:

```
PF: { type:'PF', name, firstName, lastName, locality, address, cnp? }
PJ: { type:'PJ', companyName, cui, regCom, companyAddress }
```

Stored on: `bookings.billing`, `tokenTransactions.billing`,
`pendingOrders.customerData.billing`, and cached on `users/{uid}.billing`.
ANAF results are cached in `lookupCache/{cui_*}` for 24h.

## Server (Cloud Functions)

| Function | Kind | Auth | Purpose |
|---|---|---|---|
| `lookupCui` | callable | public | ANAF CUI → company name / address / Reg.Com (24h-cached) |
| `sanitizeBilling` | helper | — | Clean/cap billing before any persist |

## Gotchas / edge cases

- **Capture-only.** No SmartBill call exists — the data sits waiting for
  invoicing. Don't assume an invoice was produced.
- **Public PJ requires CUI; the admin desk makes CUI optional.** `readBilling`
  (public) rejects an empty/invalid CUI; `readCtBilling` (admin) accepts a blank
  CUI and only validates a non-empty one.
- **Two name conventions.** The public PF widget stores `name` as
  "first … last"; the admin desk stores `name` as "last first" (`Nume Prenume`).
  Both also emit `firstName`/`lastName`, so downstream consumers should prefer
  those over parsing `name`.
- **CUI autofill only fills blank fields** and debounces 600 ms — it won't
  overwrite what the agent/customer already typed.
- **Billing is cached on the profile for logged-in customers only.** Guest
  orders carry billing on the order/booking but write no profile.
- **Credit *check-in* captures no billing** — the credits were already paid for,
  so no invoice is due (the admin modal hides the block for that sub-mode).

## Planned / not built

- **SmartBill fiscal invoicing / e-Factura** consuming this captured identity —
  [roadmap/v.1.2_smartbill.md](../roadmap/v.1.2_smartbill.md). This is the
  reason the status banner is 🟡 Partial rather than ✅ Shipped.
