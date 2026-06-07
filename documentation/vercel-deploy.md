# Deploying the frontend with Vercel (replaces Plesk uploads)

Vercel hosts the **static SPA** (`dist/`) and rebuilds + redeploys automatically
on every push to `main`. No more manual `dist/` uploads.

> **What Vercel does NOT do:** Firebase **Cloud Functions**, **Firestore rules**,
> **indexes**, and **Storage rules** still deploy via the Firebase CLI — those
> are backend and live on Firebase, not Vercel. See [§5](#5-backend-still-firebase).

The repo already contains everything Vercel needs:
- `vercel.json` — build command, output dir, SPA fallback rewrite, cache headers.
- `npm run build` is safe for CI: if the Puppeteer prerender can't run in
  Vercel's build container it **skips prerendering and the deploy still
  succeeds** (the SPA works; it just loses per-route prerendered HTML for that
  build). Locally, prerendering runs as normal.

---

## 1. Connect the repo (one-time)

1. Go to **vercel.com → Add New… → Project**.
2. **Import Git Repository** → pick `stefandinca/mangoparking` (authorize GitHub
   if asked).
3. Framework preset: **Vite** (or "Other" — `vercel.json` already sets the build
   command + output dir, so the preset doesn't matter much).
4. **Root Directory:** leave as the repo root (`.`). Do **not** point it at
   `functions/`.
5. Don't deploy yet — add the environment variables first (next step), then
   deploy.

## 2. Environment variables

Add these under **Project → Settings → Environment Variables** (scope: all —
Production, Preview, Development). They're the Firebase **web** config (public
client keys — they already ship inside the JS bundle, so they're not secrets):

```
VITE_FIREBASE_API_KEY=AIzaSyAw3i1Il7FZ1OM02yElENNXW4-kOLnVMDw
VITE_FIREBASE_AUTH_DOMAIN=mango-parking.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=mango-parking
VITE_FIREBASE_STORAGE_BUCKET=mango-parking.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=77605096604
VITE_FIREBASE_APP_ID=1:77605096604:web:af745de56b34771087b159
VITE_FIREBASE_MEASUREMENT_ID=G-25CN9LYL9F
```

(These are the same values as your local `.env.local`.) After adding them,
trigger the first deploy (**Deployments → Redeploy**, or just push a commit).

## 3. Custom domain (mangoparking.ro)

1. **Project → Settings → Domains → Add** `mangoparking.ro` (and `www.mangoparking.ro`).
2. Vercel shows the DNS records to set. At your domain registrar / DNS host:
   - Apex `mangoparking.ro` → **A** record to Vercel's IP (`76.76.21.21`), or an
     **ALIAS/ANAME** to `cname.vercel-dns.com` if your DNS supports it.
   - `www` → **CNAME** to `cname.vercel-dns.com`.
3. Vercel issues the HTTPS certificate automatically once DNS resolves.
4. **Firebase Auth:** add `mangoparking.ro` (and the `*.vercel.app` preview
   domain if you use it) under **Firebase Console → Authentication → Settings →
   Authorized domains**, otherwise Google sign-in is rejected on the new host.

Until DNS is cut over you can test on the free `*.vercel.app` URL Vercel gives you.

## 4. Day-to-day

- `git push` to `main` → Vercel builds + deploys production automatically.
- Pull requests / other branches get their own **preview URL** automatically.
- Roll back instantly from **Deployments → … → Promote to Production** on an
  older build.

## 5. Backend (still Firebase)

When you change Cloud Functions, Firestore rules/indexes, or Storage rules, deploy
them with the Firebase CLI as before:

```
cd functions && npm install            # only when deps change
firebase deploy --only functions
firebase deploy --only firestore:rules,firestore:indexes,storage
```

### Optional: auto-deploy the backend from GitHub too

If you want pushes to also redeploy functions/rules (so nothing is manual),
add a GitHub Actions workflow. It needs a Google service-account key:

1. Firebase Console → Project Settings → **Service accounts** → *Generate new
   private key* → download the JSON.
2. GitHub repo → Settings → **Secrets and variables → Actions** → add
   `FIREBASE_SERVICE_ACCOUNT` = the full JSON contents.
3. Create `.github/workflows/firebase-deploy.yml`:

```yaml
name: Firebase deploy
on:
  push:
    branches: [main]
    paths: ['functions/**', 'firestore.rules', 'firestore.indexes.json', 'storage.rules', 'firebase.json']
  workflow_dispatch:
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: cd functions && npm ci
      - uses: w9jds/firebase-action@master
        with:
          args: deploy --only functions,firestore:rules,firestore:indexes,storage
        env:
          GCP_SA_KEY: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          PROJECT_ID: mango-parking
```

(Leave the backend on manual CLI deploys if you'd rather review each one — the
Vercel frontend automation works independently either way.)

## Notes / gotchas

- **SPA routing:** `vercel.json` rewrites any path with no matching static file
  to `/index.html`, so client routes like `/account`, `/admin/...`, `/login`
  boot the SPA. Prerendered public routes (`/pricing`, `/en/about`, …) are served
  as their own static HTML first (better SEO/social previews).
- **Plesk:** once the domain points at Vercel you can stop uploading `dist/` to
  Plesk entirely. Keep the Plesk site until DNS has fully propagated, then retire it.
- **`firebase.json` hosting block** is now unused (we host on Vercel, not Firebase
  Hosting) — harmless to leave; the `firestore`/`functions`/`storage` blocks are
  still used by the CLI.
