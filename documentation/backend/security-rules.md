# Security Rules

> Status: ✅ Shipped · Last verified: 2026-07-09

How [`firestore.rules`](../../firestore.rules) and [`storage.rules`](../../storage.rules)
gate access. Sibling docs: [data-model.md](./data-model.md) · [cloud-functions.md](./cloud-functions.md).

## Core principle

**Clients never write money or privileged rows.** Anything that moves value —
order fulfilment, cash ledgers, booking paid-state transitions, `tokenTransactions`
`use` rows, voucher redemption counters, audit rows — is written by **admin-SDK
Cloud Functions that bypass rules entirely**. The matching rules therefore *deny*
those client writes on purpose, so a rule write can't skip the side-effects
(credit grant, spot reservation, audit log) that the callable performs. See
[cloud-functions.md](./cloud-functions.md).

Config + content collections are **public-read / admin-write**. Owner-scoped data
(users, balances, transactions, bookings) is **owner-or-staff read** with narrow
writes. Guest checkout is enabled by an explicit `plate_*` allowance.

## Helper functions

Defined at the top of `firestore.rules` (lines 6–27):

| Helper | Definition | Meaning |
|---|---|---|
| `isAuthenticated()` | `request.auth != null` | any signed-in user |
| `userRole()` | `get(users/$(uid)).data.role` | reads the caller's role doc |
| `isAdmin()` | role `== 'admin'` | admin only |
| `isAgent()` | role `∈ {admin, agent, staff}` | money-bearing backoffice (drivers excluded) |
| `isStaff()` | role `∈ {admin, agent, staff, driver}` | any backoffice user (drivers included) |
| `isOwner(userId)` | `request.auth.uid == userId` | the record's owner |

**Agent/staff back-compat:** the role was renamed `staff → agent`, but legacy docs
still carry `role: 'staff'`, so `isAgent()`/`isStaff()` accept both. `isStaff()` is the
broad on-lot gate (drivers can check cars in/out); `isAgent()` excludes drivers for
anything touching money. This mirrors `assertStaff` / `assertAgent` server-side.

> Note: `userRole()` costs one `get()` per evaluation. Because the public read
> branches are written **first** in `promoVouchers` and `tokenBalances`, an anonymous
> read resolves without ever calling `userRole()`.

## Per-collection access

### Public-read / admin-write (config & content)
`settings`, `pricingTiers`, `addOns`, `tokenPacks`, `seasonalPricing`, `siteContent`,
`reviews`, `galleryImages`, `legalPages` — `read: if true; write: if isAdmin()`.

### Public-read / staff-write (operational)
`spots`, `shuttleSchedule`, `trainSchedule` — `read: if true; write: if isStaff()`.

### promoVouchers (line 71)
- **read:** public vouchers (`visibility == 'public'`) are anonymously readable (the
  Promotions page lists them); admins read all; private vouchers only by an assigned uid
  (`request.auth.uid in resource.data.assignedUserIds`).
- **write:** `isAdmin()`. The public branch is first so anonymous `where('visibility','==','public')`
  list queries pass without touching the authed branches.

### tokenBalances (line 101)
- **read/update:** `isStaff()` **or** the owning uid (`docId == request.auth.uid`) **or**
  any `plate_*` doc (`docId.matches('plate_.*')`).
- **create:** `if true` (guest checkout must create a `plate_*` balance).
- **delete:** `isAdmin()`.
- The `plate_*` allowance is the deliberate guest-checkout escape hatch — a guest with no
  account can read/write their plate-keyed balance.

### tokenTransactions (line 113) — append-only
- **read:** `isStaff()` or the owning customer (`resource.data.customerId == uid`).
- **create:** `if request.resource.data.type != 'use'` — clients may seed purchase/checkout/refund
  rows but **not `use`** (those originate from staff actions via the admin SDK; allowing client
  `use` rows would spam the `credit-used` email trigger).
- **update/delete:** denied.

### bookings (line 154)
- **read:** `isStaff()` or the owning customer (`resource.data.customerId == uid`).
- **create:** any authenticated user. **update:** staff or owner. **delete:** `isAdmin()`.
- Note: staff/owner client-updates cover contact/plate/date edits and check-in/out;
  paid-state transitions and refunds go through callables, not client writes.

### activeCheckIns (line 120)
- `read/write: if isStaff()` — on-lot tracker, staff only.

### vouchers (legacy signup bonus, line 130)
- **read:** admin or the owning user.
- **create:** the caller, and only the signup voucher: `voucherId == uid`,
  `userId == uid`, `source == 'signup-incentive'`, `status == 'unused'`, `amount == 20`.
  Doc-ID `== uid` enforces one voucher per account (a second create collides).
- **update/delete:** denied — only the IPN callback (admin SDK) flips `status` to `'redeemed'`.

### pendingOrders (line 148) — server-written
- **read:** `if true` (the `/booking/return` poller reads by orderId).
- **create/update/delete:** **denied to all clients.** `adminMarkOrderPaid` /
  `adminMarkOrderUnpaid` exist precisely to perform the side-effects a raw write would skip.

### users (line 188)
- **read:** owner or any staff.
- **create:** owner **and** `request.resource.data.role == 'customer'` (new users are always
  customers; privilege escalation on signup is impossible).
- **update:** owner **only if the role is unchanged** (`request.resource.data.role == resource.data.role`),
  or `isAdmin()`. So a user can edit their profile but not their own role.
- **delete:** `isAdmin()`.

### auditLog (line 196) — append-only
- **read:** `isStaff()`. **create:** any authenticated user. **update/delete:** denied.

### Voucher ledgers (server-written)
- `voucherRedemptions` (line 87): read by staff or the owning `userId`; all writes denied.
- `voucherDayBalances` (line 95): read by staff; all writes denied.

### Cash ledgers (server-written)
- `cashHandovers` (line 257): read by `isAgent()` (drivers excluded); all writes denied.
- `cashEntries` (line 265): read by admin, or the owning agent (`resource.data.agentUid == uid`);
  all writes denied (written by `recordCashEntry` / `closeCashbook`).
- `cashbookReports` (line 272): same read model; immutable once generated.

### contactMessages (line 203)
- **create:** `if true` (public form). **read/update:** `isStaff()`. **delete:** `isAdmin()`.

### transfers (line 231)
- **read/create/update:** `isStaff()`. **delete:** `isAgent()` (so a driver can't remove records).
- Client-written (no money fields — `price` is a free-text note), like reviews/contact messages.

### subscriptions (line 162, hidden feature)
- **read:** staff or owner. **create:** authenticated. **update:** staff or owner. **delete:** `isAdmin()`.

### Fully server-only (all client access denied)
- `pendingInvites` (line 237): `read, write: if false` — admin SDK only
  (`adminSendInvite` / `finishInviteSignup`).
- `lookupCache` (line 242): `read, write: if false` — ANAF cache, `lookupCui` only.
- `flightStatusCache`: no explicit rule → **default-deny** to clients; written only by
  `lookupFlightStatuses` (admin SDK).

## Storage rules (`storage.rules`)

```
bookings/{bookingId}/{fileName}   read: authed;  write: authed + <5 MB + image/*
gallery/{fileName}                read: public;  write: authed + (delete OR <5 MB + image/*)
```

- **`bookings/…`** — booking photos, readable by any signed-in user, uploadable by any
  signed-in user (5 MB cap, images only).
- **`gallery/…`** — the homepage "Our facility" images: **public read** (shown on the
  homepage) and authed write. Admin is re-gated at the Firestore level (`galleryImages`
  writes require `isAdmin()`); a `request.resource == null` (delete) is allowed.

## Consistency with `PERM`

The role model in `src/utils/permissions.js` (route guards + admin sidebar), the
server gates (`assertAdmin` / `assertAgent` / `assertStaff` in `functions/src/index.js`),
and these rules are kept mutually consistent — the same `admin > agent(staff) > driver >
customer` hierarchy governs all three layers.
