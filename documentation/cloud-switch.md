# Cloud Account Switch — Personal → Client

**Status:** deferred. Currently deployed to **`mango-parking`** under the developer's personal Google account. The client now has their own Google Cloud / Firebase access; we will move the project there before launch.

This document is the checklist for that switch. Nothing here is urgent — resume work on `v1-plan.md` first, come back to this when the client account is ready.

---

## Current state (as of 2026-05-12)

- Firebase project ID: `mango-parking`
- Region for Functions / Firestore: `europe-west1`
- Hosting: not used (Plesk upload of `dist/`)
- Auth providers: Google, Email/Password
- Secrets set: `BREVO_API_KEY`, `NETOPIA_SIGNATURE`, `NETOPIA_PUBLIC_KEY`, `NETOPIA_PRIVATE_KEY`, `NETOPIA_ENV`, `NETOPIA_API_KEY`
- Domain authentication on `mangoparking.ro`: SPF + DKIM + DMARC complete on the registrar DNS (independent of Firebase — carries over for free)
- Brevo: account-scoped (not Firebase-scoped) — same API key works after the switch
- Netopia: IPN URL currently points at the `mango-parking` Cloud Function URL — will change on switch

---

## What we need from the client / user before flipping

### 1. New project identity
- [ ] New Firebase project ID (suggestion: `mango-parking-prod` or similar)
- [ ] Confirm Blaze plan enabled (required for Functions + Secret Manager)
- [ ] Region stays `europe-west1`

### 2. Web app SDK config
Register a Web app on the new project (Firebase Console → Project settings → "Your apps" → Add app → Web). Capture these six values for `.env.local`:
- [ ] `VITE_FIREBASE_API_KEY`
- [ ] `VITE_FIREBASE_AUTH_DOMAIN`
- [ ] `VITE_FIREBASE_PROJECT_ID`
- [ ] `VITE_FIREBASE_STORAGE_BUCKET`
- [ ] `VITE_FIREBASE_MESSAGING_SENDER_ID`
- [ ] `VITE_FIREBASE_APP_ID`

### 3. Access / IAM
- [ ] Deployer's Google account has Owner (or: Firebase Admin + Cloud Functions Admin + Secret Manager Admin) on the new project
- [ ] Local `firebase login --reauth` to pick up the new identity

### 4. Auth providers on the new project
- [ ] Enable Google sign-in
- [ ] Enable Email/Password sign-in
- [ ] Authorized domains: add `mangoparking.ro`, `www.mangoparking.ro`, and `localhost` (for dev)

### 5. Data migration decision
- [ ] **Fresh start** (recommended if no real production traffic yet) — leave old `mango-parking` data behind; start clean on the new project.
- [ ] **Migrate** — `gcloud firestore export` from old project → import on new project. Touches `users`, `tokenBalances`, `bookings`, `tokenTransactions`, `pendingOrders`, `activeCheckIns`, `settings`, `pricing`, `audit_logs`.

### 6. Netopia
- [ ] After the new functions URL is known, paste it as the IPN URL in the Netopia merchant dashboard.

### 7. Brevo (no action — informational)
- Domain auth records stay (DNS is on the domain, not the Firebase project).
- Template IDs in `functions/src/emailTemplates.js` stay.
- Same `BREVO_API_KEY` value gets re-set as a secret on the new project.

---

## Switch procedure (when ready)

1. Update `.firebaserc` → `"default": "<new-project-id>"`.
2. Overwrite `.env.local` with the six new `VITE_FIREBASE_*` values.
3. `firebase login --reauth` → confirm `firebase projects:list` shows the new project.
4. `firebase use <new-project-id>`.
5. Re-set all six secrets:
   ```
   firebase functions:secrets:set BREVO_API_KEY
   firebase functions:secrets:set NETOPIA_SIGNATURE
   firebase functions:secrets:set NETOPIA_PUBLIC_KEY
   firebase functions:secrets:set NETOPIA_PRIVATE_KEY
   firebase functions:secrets:set NETOPIA_ENV
   firebase functions:secrets:set NETOPIA_API_KEY
   ```
6. (Optional) Firestore data migration:
   ```
   gcloud config set project mango-parking
   gcloud firestore export gs://<old-bucket>/backup-YYYY-MM-DD
   gcloud config set project <new-project-id>
   gcloud firestore import gs://<old-bucket>/backup-YYYY-MM-DD
   ```
7. `firebase deploy --only firestore:rules,firestore:indexes,functions`.
8. Grab the new Cloud Function URLs from the deploy output; paste the IPN callback URL into Netopia.
9. Add Auth providers + authorized domains in the new project's console.
10. Rebuild + redeploy frontend: `npm run build`, upload `dist/` to Plesk.
11. Smoke-test: signup, long-term booking (online), pay-at-pickup, credit purchase, admin check-in, admin mark-paid — all should fire Brevo emails.
12. Once verified, the old `mango-parking` project can be put into "do-not-disturb" (keep it readable for a month, then delete).

---

## Things to NOT forget

- The Netopia IPN URL changes — without updating it, payments will complete on the gateway side but our Functions will never hear back and bookings will stay `pending`.
- Firebase Storage bucket name changes — anything referencing `mango-parking.appspot.com` (search the repo before switching) breaks.
- Google sign-in OAuth client lives in GCP under the new project. If users had Google logins on the old project, their UIDs do NOT carry over — they will appear as new users on first login. Anything keyed by UID (loyalty points, vehicles, history) needs migration if we go that route.
- Cloud Scheduler jobs (Phase F, once built) are project-scoped — they get re-created automatically on first `firebase deploy --only functions` against the new project.
