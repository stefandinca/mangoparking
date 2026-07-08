# Mango Parking — Documentation

_Last reconciled against the codebase: **2026-07-09**._

Reference documentation for Mango Parking — parking near Henri Coandă (Otopeni)
airport with a free shuttle, run as two products (daily **credits** and
**long-term bookings**) plus an `/admin` back office.

## How these docs are organized

Docs are organized **by topic — backend, feature, and section — not by release
or feedback round.** The goal is that a fresh session can read this folder and
**completely understand the project: what is implemented and what is planned.**

| Folder | What's in it |
|---|---|
| [`backend/`](backend/) | How the server works: data model, Cloud Functions, security rules, payments, email, external integrations, i18n & permissions. |
| [`features/`](features/) | One doc per product feature (credits, long-term bookings, pricing, vouchers, billing, cashbook & refunds, capacity, transfers, shuttle, reviews, trip info). |
| [`sections/`](sections/) | The app surfaces: public site, customer account, admin panel. |
| [`admin-flows/`](admin-flows/) | Detailed step-by-step staff walkthroughs, one per admin area, + the [BUGS.md](admin-flows/BUGS.md) register. |
| [`roadmap/`](roadmap/) | **Planned / not built** — design docs for future work. |
| [`archive/`](archive/) | **Historical** — superseded plans, raw change notes, past feedback rounds. |

> **Maintenance rule.** After any task that changes behavior, structure, or plans,
> update the affected doc(s) here in the same commit (and `CLAUDE.md` / `Brief.md`
> when conventions or architecture shift). Keeping these current is part of
> "done," not a follow-up.

## Start here

- [../Brief.md](../Brief.md) — product + architecture overview (the big picture).
- [../CLAUDE.md](../CLAUDE.md) — working guide: stack, commands, directory map, conventions.

## Backend

- [backend/data-model.md](backend/data-model.md) — every Firestore collection, doc shape, and ID convention.
- [backend/cloud-functions.md](backend/cloud-functions.md) — every Cloud Function (HTTP, callable, trigger, scheduled).
- [backend/security-rules.md](backend/security-rules.md) — Firestore/Storage rules and the "server-only writes" principle.
- [backend/payments-netopia.md](backend/payments-netopia.md) — Netopia Mobilpay (legacy crypto-envelope flow; **refunds are manual**).
- [backend/email-brevo.md](backend/email-brevo.md) — Brevo transactional emails + ops alerts.
- [backend/integrations.md](backend/integrations.md) — ANAF CUI lookup, flight-status lookup (dormant), planned SmartBill/ANPR.
- [backend/i18n-and-permissions.md](backend/i18n-and-permissions.md) — the i18n system and the roles/permissions model.

## Features

- [features/credits.md](features/credits.md) — daily-parking credits/tokens.
- [features/long-term-bookings.md](features/long-term-bookings.md) — date-range reservations.
- [features/pricing.md](features/pricing.md) — tiers, seasonal periods, online discount, server-authoritative recompute.
- [features/vouchers.md](features/vouchers.md) — promo / signup / credit / days vouchers.
- [features/billing.md](features/billing.md) — PF/PJ invoice capture + CUI/ANAF (capture-only; SmartBill not wired).
- [features/cashbook-refunds.md](features/cashbook-refunds.md) — cash drawer + manual refund queue.
- [features/capacity.md](features/capacity.md) — spots/zones, live occupancy, the capacity map.
- [features/transfers.md](features/transfers.md) — door-to-airport passenger transfers.
- [features/shuttle.md](features/shuttle.md) — the ManGO buzz shuttle + opening hours.
- [features/reviews.md](features/reviews.md) — customer reviews CMS.
- [features/trip-info.md](features/trip-info.md) — passengers, flight numbers, flight delay/cancel warnings.

## Sections

- [sections/public-site.md](sections/public-site.md) — public routes/pages + SEO prerender.
- [sections/account.md](sections/account.md) — auth + customer account area.
- [sections/admin.md](sections/admin.md) — the `/admin` panel, section by section (→ [admin-flows/](admin-flows/) for deep walkthroughs).

## Shipped-feature records (historical detail)

Per-increment records kept for provenance; the topic docs above are the canonical
current reference:

- [v.1.7_checkin_redesign.md](v.1.7_checkin_redesign.md) — admin check-in/out redesign + `markNoShows`.
- [v.1.8_credit_checkin.md](v.1.8_credit_checkin.md) — manual commuter check-in against credits.
- [v.1.9_days_vouchers.md](v.1.9_days_vouchers.md) — splittable "free days" vouchers.
- [v.1.10_credit_vouchers.md](v.1.10_credit_vouchers.md) — credit gift vouchers + admin credit grants.

## Roadmap (planned / not built)

- [roadmap/v.1.2_smartbill.md](roadmap/v.1.2_smartbill.md) — SmartBill fiscal invoicing.
- [roadmap/v.1.3_anpr.md](roadmap/v.1.3_anpr.md) — ANPR camera auto check-in/out.
- [roadmap/v.1.4_netopia_v2_migration.md](roadmap/v.1.4_netopia_v2_migration.md) — Netopia v2 REST (automated refunds/voids).
- [roadmap/cloud-switch.md](roadmap/cloud-switch.md) — move the Firebase project to the client's account.

## Deploy

- [vercel-deploy.md](vercel-deploy.md) — frontend ships on push to `main` (Vercel); Firebase CLI deploys functions/rules/indexes/storage.

## Big integrations at a glance

- **Payments (Netopia)** — live, on the legacy crypto-envelope flow. **Refunds are manual** (admin refund queue). v2 REST automation is [planned](roadmap/v.1.4_netopia_v2_migration.md).
- **Invoicing (SmartBill)** — **not built.** Billing identity is captured at checkout but no invoice is issued. [Plan](roadmap/v.1.2_smartbill.md).
- **ANPR cameras** — **not built.** (The overstay/no-show pieces that plan referenced did ship independently.) [Plan](roadmap/v.1.3_anpr.md).
- **Flight status** — code shipped but **dormant** until a flight-API key is configured. See [backend/integrations.md](backend/integrations.md).
