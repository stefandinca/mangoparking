# 04 — Users, Accounts & Roles

**Page:** `/admin/users` (`src/pages/admin/AdminUsers.js`).
**Permission:** `perm:users` (**admin only**).
**Server:** `adminCreateUser`, `adminSendInvite`, `finishInviteSignup`,
`adminChangeUserRole`, `adminDeleteUser` in `functions/src/index.js`.
**Detail view:** `src/components/admin/UserDetailModal.js` (read-only; client reads only).

## In plain words

- This is where admins **manage staff and customer accounts**.
- You can **see everyone**, grouped by role (admins, agents, drivers, customers),
  and search by name or email.
- You can **create a new account** two ways: set an email + password directly, or
  **send an invite email** where the person clicks a link and picks their own
  password. Both create a real login.
- You can **change someone's role** or **delete an account** — with safety guards
  so an admin can't accidentally lock themselves out or remove the last admin.
- **Note:** this page is **admin-only**, and it does *not* handle parking credits —
  those are granted from the check-in screen by license plate, not here.
- **Things to watch (see bugs):** server error messages show up untranslated, the
  tables get cut off on phones, and a customer who puts code into their display
  name could inject it into the delete pop-up (a security fix needed).

---

> Account creation genuinely provisions **Firebase Auth** accounts (not
> Firestore-only ghosts) — both the direct and invite paths produce a login.
> Self-lockout and last-admin demotion/deletion are guarded on **both** client
> and server. No privilege-escalation path found (route guard, sidebar,
> `assertAdmin`, and `firestore.rules` all agree). The bugs below are quality
> issues, not security holes — with one XSS exception (#1).

---

## Flows

### Flow 1 — List / search users
1. `/admin/users` → `reload()` shows a `…` placeholder, then
   `getCollection('users')` loads the **entire** users collection client-side,
   sorted by `createdAt` desc.
2. Grouped into fixed sections: Administratori → Agenți → Șoferi → Clienți. Each
   a card/table: Name, Email (mono), Created, Role (`<select>`), Delete link.
3. Search filters client-side on `email + displayName` only (`:139`). Role names
   not searched. No match → `usersEmpty` card.
4. Each row's **name** is a button → opens the per-user detail modal (Flow 6).
**End state:** read-only listing; no pagination.

### Flow 2 — Create a user (email + password)
1. **Creează utilizator** → modal: Full name (optional), Email* , Password*
   (min 8), Role (customer/driver/agent/admin, default customer).
2. Submit → client validates email → `adminCreateUser`.
3. Server: `assertAdmin`, validates role + password ≥ 8, **`getAuth().createUser`**
   (real Auth account), writes `users/{uid}` with role + `createdBy`, audit-logs.
4. Toast `usersCreatedToast`, modal closes, list reloads.
**End state:** the user can log in immediately. Auth + Firestore doc both exist.

### Flow 3 — Invite a user (magic link)
1. **Trimite invitație** → modal: Name (optional), Email* , Role (no password).
2. `adminSendInvite`: generates a sign-in link to `/auth/finish-signup`, stores
   role + name in `pendingInvites/{email}`, sends a Brevo `admin-invite` email.
3. Recipient clicks link → `FinishSignup.js` completes sign-in →
   `finishInviteSignup` stamps role/name from `pendingInvites`, prompts for a
   password, redirects to `/account`.
**End state:** invited user can log in with their chosen password.
**Caveat:** `finishInviteSignup` only applies the invited role if the current
role is missing or `customer` (`:2587`) — re-inviting an existing agent/driver
with a different role silently won't upgrade them.

### Flow 4 — Change a role
1. Pick a new value in a row's role `<select>` → confirm modal ("Schimbi rolul
   din {from} în {to}?"), danger-styled when admin is involved. Cancel reverts.
2. `adminChangeUserRole`: `assertAdmin`; refuses changing **own** role; maps
   legacy `staff`→`agent`; refuses demoting the **last admin**; updates role;
   audit-logs.
3. Toast; reload. On failure the select reverts + a toast shows raw `err.message`.
**Self protection:** the admin's own row renders role as static text and hides
Delete.

### Flow 6 — View a user's detail (read-only)
1. Click a user's **name** in any role table → `openUserDetailModal(user)` opens a
   wide modal seeded from the already-loaded `users/{uid}` doc.
2. Profile, vehicles, and billing render immediately from that doc; the rest load
   in parallel (each `.catch`-guarded so one failure doesn't blank the panel):
   - **Credits** — `getBalance(uid)` (`tokenBalances/{uid}`): balance, total
     purchased, tracked plates.
   - **Credit transactions** — `getTransactions(uid, 50)` (`tokenTransactions`
     where `customerId == uid`, newest first; uses the `(customerId, timestamp)`
     index).
   - **Bookings** — `bookings` where `customerId == uid` **and** where
     `contact.email == email`, merged + deduped by id (catches guest bookings not
     yet reconciled to the account). The table shows the booked **plate** per row,
     so a guest reservation's plate is visible even before the plate reaches
     `vehicles` (see `addPlateToProfile` / `mergeGuestData` in
     [../backend/cloud-functions.md](../backend/cloud-functions.md)). The
     reservation **code is a clickable link** (`reservationCodeHtml`): a live
     booking closes the modal and jumps to the check-in page focused on the row;
     a historical one opens the read-only booking-detail modal.
   - **Vouchers** — `promoVouchers` assigned to the uid + `voucherRedemptions`
     (to flag spent codes) + legacy `vouchers/{uid}` (now admin-readable, see
     rules note).
**End state:** read-only overview; no edit/grant actions from the modal.
**Rules:** all reads are admin/staff-permitted; `vouchers/{voucherId}` read was
widened to `isAdmin() || owner` so the signup voucher shows here.

### Flow 5 — Delete a user
**Delete only — no deactivate/disable.** Per-row Delete link (hidden for self) →
`confirmModal` danger → `adminDeleteUser`: `assertAdmin`; refuses self-delete;
refuses deleting the **last admin**; `getAuth().deleteUser` + deletes the doc;
historical bookings/transactions/balances left intact; audit-logs.

### Not here — credit/balance grants
AdminUsers has **no** credit-granting UI. Credit grants live in
`CreateTransactionModal` (reached from check-ins/transactions) and are keyed by
**license plate**, not user account. Commit ccba235's "manual commuter check-in
against existing credits" = `checkInWithCredits`, invoked from the check-ins flow.
**Available via the detail modal (read-only, Flow 6):** a user's balance, credit
transactions, booking history, vouchers, contact, vehicles, and billing.
**Still not here:** you cannot grant credits, edit name/email/phone, or resend an
invite from this page — those remain write actions handled elsewhere (credit
grants live in `CreateTransactionModal`, keyed by plate).

---

## Bugs & inconsistencies

1. **[MED] Stored-XSS in the delete confirmation dialog.** The row writes the name
   into `data-name="${safeName}"` (escaped for the attribute). The delete handler
   reads it back with `btn.dataset.name` (`:87`) — which **HTML-entity-decodes**
   it — and passes it to `confirmModal(...)`, which injects the message via
   `innerHTML` (`Modal.js:61`, unescaped). A customer-controlled `displayName`
   (set via self-registration, `auth.js:85`) containing markup executes when an
   admin clicks Delete. The table cells are safe (`escapeHtml`); this one sink
   round-trips through `dataset` and loses escaping. Fix: pass the already-escaped
   name into the message, or have `confirmModal` treat the message as text.
2. **[MED] Wide tables clipped on mobile.** Each role table sits in a card with
   `overflow-hidden` (`:163`) and **no** `overflow-x-auto` wrapper; the 5-column
   table (incl. the role `<select>` and created-date) overflows narrow viewports
   and gets clipped rather than scrolled — admins may not reach the dropdown /
   Delete link.
3. **[LOW] Raw English server errors leak to the localized UI.** Create modal
   (`:294`), role-change toast (`:131`), delete toast (`:101`) show `err.message`
   directly — "Admin only", "Cannot demote the last admin" — untranslated.
4. **[LOW] Invalid-email feedback is a generic catch-all.** Both modals set the
   error to `usersError` ("Something went wrong") on a client-side email failure
   (`:280`, `:344`) instead of an email-specific message.
5. **[LOW] `fmtDate` breaks on Firestore-`Timestamp` `createdAt`.** `fmtDate`
   (`:220`) and the sort (`String(b.createdAt)`) assume ISO strings; any seeded/
   legacy doc holding a `Timestamp` renders `[object Object]` and sorts wrong.
6. **[LOW] Re-invite can't change an existing non-customer's role** (`:2587`) —
   the invite "succeeds" but the role doesn't change, with no UI signal.
7. **[LOW] Full-collection client read** (`:208`) — every user (incl. all
   customers) downloads on each load and after every action; no pagination.
8. **[LOW] Search doesn't cover role, and `usersEmpty` is reused** for both "no
   users" and "filter matched nothing".
9. **[NIT] Dead i18n:** `admin.usersCol.role` (`ro.js:607`) exists but the header
   uses `admin.usersRoleLabel`.

**Correct:** real Auth provisioning on both create + invite; self-lockout and
last-admin guards on client **and** server; no privilege-escalation path.
