# Door-to-Airport Transfers

> Status: ✅ Shipped · Last verified: 2026-07-09

A separate product from parking: private passenger transfers between a home
address and Henri Coandă airport, recorded by staff. Distinct `transfers`
collection, no money movement. Surfaces in the check-in **Transfers tab** and the
Activity feed. Related: [`trip-info.md`](./trip-info.md) (flight numbers on
parking bookings), `../backend/cloud-functions.md`.

## What it is

Staff take transfer requests by phone/WhatsApp and record them. A transfer is a
passenger pickup from a home address to the airport and — for round trips — back.
There is **no payment** here: the optional `price` is a free-text note only. Like
reviews/contact messages, transfers are written **directly from the client**
(gated by `isStaff()` in `firestore.rules`), not through a Cloud Function.

- **One-way** (`transferType: 'oneway'`) — a single outbound home→airport leg.
- **Round-trip** (`transferType: 'roundtrip'`) — outbound plus an airport→home
  return leg with its own date, flight and destination.
- Each leg has an **independent status** so it can be completed/cancelled on its
  own: `status` = outbound leg, `returnStatus` = return leg
  (`scheduled` | `completed` | `cancelled`).

## How it works

### Service — `src/services/transferService.js`

- `normalize(data)` shapes raw form input into the stored doc, coercing
  passenger/luggage counts to non-negative ints (`adults` floored to ≥1) and
  **blanking all round-trip-only fields** when the type is one-way, so switching
  round-trip → one-way leaves no stale return leg.
- `createTransfer(data)` → `addDocument('transfers', …)` with
  `status: 'scheduled'`, `returnStatus: 'scheduled'`, `createdBy`; audit-logs
  `transfer_created`.
- `updateTransfer(id, data)` — re-normalizes + patches; audits `transfer_updated`.
- `setTransferStatus(id, status, leg = 'out')` — writes `status` (out) or
  `returnStatus` (return); audits `transfer_status`.
- `deleteTransfer(id)` — removes + audits `transfer_deleted`.

### Create / edit — `src/components/admin/CreateTransactionModal.js`

Transfer is the **third reservation type** in the shared walk-in modal (alongside
long-term and credit). Selecting it (`tType == 'transfer'`) hides the
payer/plate/paid-by/auto-check-in blocks (no money moves) and reveals
`[data-transfer-fields]`: contact (name/phone/email), trip (pickup address,
pickup date-time, outbound flight), a one-way/round-trip toggle that shows/hides
the return block, a group grid (adults / children / infants-in-arms / hold
luggage / cabin luggage), price note and group notes. Passing `editTransfer`
opens straight into edit mode with the type locked (you can't convert a recorded
transfer into a parking booking). Submit (`CreateTransactionModal.js:948`) builds
the payload and calls `updateTransfer` or `createTransfer`, converting the
flatpickr `YYYY-MM-DD HH:MM` local strings to ISO, then reports
`{ transfer: true }` so the host page jumps to the Transfers tab.

### Check-in Transfers tab — `src/pages/admin/AdminCheckIns.js`

- A dedicated subscription (`subscribeCollection('transfers', …)`,
  `AdminCheckIns.js:900`) feeds a `transfers` tab alongside checkin/checkout/
  overdue/noshow.
- `transferLegs(tr)` expands a transfer into its dated events: always the
  outbound `pickupAt`, plus the return `returnAt` for round trips. Each **leg
  gets its own card on its own date**, so a round-trip shows twice — once per
  window it falls into. The tab count sums in-window legs.
- `transferCardHtml(tr, { leg })` renders a collapsible "mini-dashboard" card:
  header (contact · phone · type chip · leg badge · time · per-leg status
  badge); the expanded body lists contact, pickup address + time, flight,
  passengers (`adults · children · infants`), luggage (`hold · cabin`), price,
  the return line (round-trip), and group notes, plus actions.
- **Actions** carry `data-transfer` (+ `data-leg`) so the booking-row handler
  no-ops on them (`AdminCheckIns.js:946`): edit (re-opens the modal with
  `editTransfer`), complete/cancel (per-leg `setTransferStatus`), and delete
  (admin/agent only, gated by `canCancel` = `PERM.REFUNDS`).
- Search (`matchesTransferSearch`) matches on contact/phone/email/flights/
  address/id — transfers have no plate or booking code.

### Activity feed — `src/pages/admin/AdminActivity.js`

The `/admin/activity` timeline merges parking events and transfers. A transfer
contributes up to two events: `transfer-out` (at `pickupAt`) and, for round
trips, `transfer-return` (at `returnAt`), only while that leg is still
`scheduled` and inside the window (`AdminActivity.js:295`). Rows are collapsed
and expand to `transferDetailHtml(...)` (address, pickup time, flight,
passengers, price, notes). Clicking a transfer row deep-links to the check-in
Transfers tab focused on that id.

## Key files

- `src/services/transferService.js` — CRUD + normalization + schema comment.
- `src/pages/admin/AdminCheckIns.js` — Transfers tab, cards, actions (`:470`+,
  `:812`, `:900`, `:946`).
- `src/pages/admin/AdminActivity.js` — transfer events in the timeline (`:295`).
- `src/components/admin/CreateTransactionModal.js` — transfer create/edit branch
  (`:82` opts, `:261` fields, `:948` submit).
- `firestore.rules` — `transfers` (`:231`).

## Data (Firestore)

**`transfers/{auto}`** (from `transferService.js:9`):

| field | notes |
|---|---|
| `contactName`, `phone`, `email` | passenger / contact |
| `pickupAddress`, `pickupAt` (ISO) | home pickup |
| `transferType` | `'oneway'` \| `'roundtrip'` |
| `flightNumber` | outbound flight no. |
| `adults` (≥1), `children`, `infantsInArms` | passenger counts |
| `holdLuggage`, `cabinLuggage` | bag counts |
| `returnAt`, `returnFlightNumber`, `returnTo` | round-trip only (blanked for one-way) |
| `price` | free-text note, e.g. "150 lei" — **not** a money field |
| `groupNotes` | oversized luggage / disability / etc. |
| `status` | outbound leg: `scheduled`\|`completed`\|`cancelled` |
| `returnStatus` | return leg (same enum) |
| `createdBy`, `createdAt`, `updatedAt` | provenance |

Rules (`firestore.rules:231`): `read, create, update` for any `isStaff()`
(admin/agent/driver); `delete` limited to `isAgent()` (admin/agent) so drivers
can't remove records.

## Gotchas / edge cases

- **Client-written, not a callable** — because there's no money, transfers write
  directly under `isStaff()` rules (unlike parking bookings, which go through
  callables). The optional `price` is intentionally free-text, not validated.
- **Per-leg lifecycle.** Completing/cancelling the outbound doesn't touch the
  return, and vice-versa — the two status fields are independent.
- **Round trips appear twice** in the Transfers tab / Activity feed (one card per
  dated leg), by design, so each leg shows on its own date.
- **Switching to one-way wipes the return fields** on the next save
  (`normalize()`), avoiding a stale return leg.
- Delete is not available to drivers even though they can create/edit.
