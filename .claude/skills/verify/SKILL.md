---
name: verify
description: How to runtime-verify UI changes in this repo (vanilla-JS SPA, no test infra, admin flows gated by Firebase auth).
---

# Verifying changes in mangoparking

No test framework exists — verification is runtime observation.

## Build check
`npm run build:vite` (fast). Full `npm run build` adds the pure-Node SEO
prerender (no browser involved).

## Driving the app
- `npx vite` serves on port 3000 with `open: true` (pops the user's browser).
  For automation, use a config override with a plain-object export (a config
  outside the repo can't `import 'vite'`): `{ root: '<repo>', publicDir:
  'public', server: { port: 3100, open: false } }` and
  `npx vite --config <override>` from the repo root.
- Public pages (`/booking/long-term`, `/pricing`, …) work unauthenticated;
  Firestore config reads fail silently through `.catch()` fallbacks.
- **Admin pages need a real Firebase login** — no seeded test account. To
  exercise admin components without credentials, mount them from a temporary
  harness page in the repo root (vite serves any root `*.html` in dev) that
  imports the component from `/src/...`, e.g.
  `import { openCreateTransactionModal } from '/src/components/admin/CreateTransactionModal.js'`.
  Delete the harness before committing.
- Puppeteer is NOT a dependency (prerender is pure Node). Install
  `puppeteer-core` in the scratchpad and launch the system Chrome
  (`C:/Program Files/Google/Chrome/Application/chrome.exe`) with
  `headless: true` plus an explicit scratch `userDataDir` (default profile
  fails to launch with "Code: 0").
- Cloud callables POST to `europe-west1-mango-parking.cloudfunctions.net`.
  To test submit paths without writing data: `page.setRequestInterception`,
  let the CORS preflight (OPTIONS) through, capture + `abort('failed')` the
  POST only — the UI's error path runs and nothing reaches the server.
  Unauthenticated callables are also rejected server-side (`assertStaff`).

## Gotchas
- flatpickr date inputs: the visible field is `.flatpickr-alt-input`; the
  submitted value lives in the hidden original input (`Y-m-d H:i`). Set dates
  via `input.__fpInstance.setDate(date, true)` for write-through.
- Modal backdrop is `[data-modal-bg]`; dispatch `.click()` on it directly —
  coordinate clicks are geometry-fragile.
