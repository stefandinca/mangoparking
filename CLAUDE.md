# Mango Parking — Claude Code Guide

## Project Overview
Daily Travel Token parking for Henri Coandă Airport (Otopeni). Customers buy token packs online, staff deducts 1 token per parking day via plate lookup. RO default + EN i18n. See [Brief.md](Brief.md) for full MVP spec.

## Tech Stack
- **Frontend**: Vanilla JS SPA, Vite 7, TailwindCSS 4 (PostCSS), no framework
- **Backend**: Firebase (Auth: Google + Email, Firestore, Storage, Hosting)
- **Payments**: Netopia (currently stubbed — awaiting merchant creds)
- **Deployment**: Plesk (mangoparking.ro) — upload `dist/`
- **Fonts / Colors**: Space Grotesk + DM Sans + JetBrains Mono / #F28C28 #2D4A47 #34D399 #F0F2F5

## Essential Commands
- `npm run dev` — Vite dev server (port 3000, auto-opens)
- `npm run build` — production build to `dist/`
- `npm run preview` — preview built output
- `firebase deploy --only firestore:rules,firestore:indexes --project mango-parking`

## Directory Map
```
src/main.js                           — entry, seed hook, router init
src/router/{index,routes,guards}.js   — History API + locale prefix + guards
src/i18n/{index,ro,en}.js             — t(), localePath(), 250+ keys
src/firebase/{config,auth,db,storage}.js
src/components/core/                  — Navbar, Footer, Toast, Modal, Loader, FormField
src/components/{widgets,account,admin}/   — icons.js, AccountLayout, AdminLayout
src/pages/{public,auth,account,admin}/    — default export fn(container)
src/services/                         — tokenService (core), capacity, shuttle, audit, contact
                                        (hidden/preserved: booking, subscription, pricing, loyalty)
src/utils/{dom,date,validators,seo,constants}.js
firestore.rules / firestore.indexes.json / firebase.json
```

## Conventions
- Pages export `default function(container)` — receive DOM node, mount content, optionally return cleanup fn
- Components: factory functions returning DOM via `html` tagged template (src/utils/dom.js)
- Route guards: `['auth']` or `['auth','admin']` per route
- Firestore: small collections, client-side filter/sort
- Token balance IDs: `{uid}` for logged-in, `plate_{NORMALIZED_PLATE}` for guests
- Never commit secrets; `.env.local` holds Firebase config

## Agent Orchestration
When given a task, read [.claude/orchestrator.md](.claude/orchestrator.md) first — it routes work to the right specialist agent(s) in [.claude/agents/](.claude/agents/) without the user naming anyone. After each change: test, fix regressions, verify, then create a clean commit.

## Reference Docs
- [Brief.md](Brief.md) — MVP scope, routes, Firestore collections, flows
- [implementation.md](implementation.md) — historical implementation notes
- [firestore.rules](firestore.rules) — security model source of truth
