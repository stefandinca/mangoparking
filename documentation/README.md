# Mango Parking — Documentation Index

_Last reconciled against the codebase: **2026-07-01**._

This folder holds the product/architecture docs, per-version feature records, the
admin-flow audit, and the deploy guide. Docs are split three ways so it's always
clear whether something is **live**, **planned**, or **historical**:

| Location | Meaning |
|---|---|
| `documentation/` (this folder) | **Current** — describes what is live on `main`, or shipped-feature records. |
| `documentation/roadmap/` | **Planned / deferred** — design docs for work **not yet built**. |
| `documentation/archive/` | **Historical** — superseded plans and raw change notes, kept for provenance. |

Start with [../Brief.md](../Brief.md) for the product + architecture overview.

---

## Version docs — shipped vs. planned

Each `v.1.x_*.md` doc now carries a status banner at the top. Summary:

| Version | Feature | Status | Doc |
|---|---|---|---|
| v1 (baseline) | Credits storefront + manual plate-lookup admin | ✅ Shipped | [archive/implementation.md](archive/implementation.md) |
| v1 | Brevo email layer, pay-at-pickup, PF/PJ billing + CUI lookup, admin users/invites, unified check-in dashboard, reservation codes | ✅ Shipped | [archive/v1-plan.md](archive/v1-plan.md) _(plan, archived)_ |
| v1.1 | Billing prefill, cancellation-with-refund, step-through date picker, cashbook | ✅ Shipped | [archive/v1.1-plan.md](archive/v1.1-plan.md) _(plan, archived)_ |
| **v1.2** | **SmartBill fiscal invoicing (facturi / e-Factura)** | 📋 **Planned — not built** | [roadmap/v.1.2_smartbill.md](roadmap/v.1.2_smartbill.md) |
| **v1.3** | **ANPR camera integration** (auto check-in/out by plate) | 📋 **Planned — not built** | [roadmap/v.1.3_anpr.md](roadmap/v.1.3_anpr.md) |
| **v1.4** | **Netopia v1.x → v2 REST migration** (automated refunds/voids) | 📋 **Planned — not built** | [roadmap/v.1.4_netopia_v2_migration.md](roadmap/v.1.4_netopia_v2_migration.md) |
| v1.5 – v1.6 | _(no docs — numbering gap; see note below)_ | — | — |
| v1.7 | Admin check-in/check-out redesign (3 tabs) + `markNoShows` | ✅ Shipped | [v.1.7_checkin_redesign.md](v.1.7_checkin_redesign.md) |
| v1.8 | Manual commuter check-in against existing credits | ✅ Shipped | [v.1.8_credit_checkin.md](v.1.8_credit_checkin.md) |
| v1.9 | Long-term "free days" vouchers (splittable day balances) | ✅ Shipped | [v.1.9_days_vouchers.md](v.1.9_days_vouchers.md) |
| v1.10 | Credit gift vouchers + direct admin credit grants | ✅ Shipped | [v.1.10_credit_vouchers.md](v.1.10_credit_vouchers.md) |
| June'26 | Client feedback round (real online discount, voucher breakdowns, billing prefill, single-name field, check-in/overdue polish) | ✅ Shipped | [feedback-june.md](feedback-june.md) · [feedback-june-status.md](feedback-june-status.md) |

> **The numbering gap (v1.2–v1.6).** v1.2/1.3/1.4 were *planned* but leapfrogged —
> the work that actually shipped jumped to **v1.7+**. The three planned docs now
> live under `roadmap/` so they're not mistaken for shipped features.

---

## What the big integrations actually do today

The three headline integrations are the easiest to misread, so explicitly:

- **Payments (Netopia)** — **live**, but on the **legacy crypto-envelope flow**
  (`functions/src/netopia.js`: RSA + AES over XML, `createPayment` +
  `netopiaCallback` IPN). **Refunds are manual** — handled through the admin
  refund queue, not an API. The JSON-REST "v2" rewrite that would automate
  refunds/voids is the **planned** [roadmap/v.1.4](roadmap/v.1.4_netopia_v2_migration.md).
- **Invoicing (SmartBill)** — **not built.** Billing identity (PF/PJ, CUI via
  ANAF `lookupCui`) is *captured* at checkout, but no invoice is ever issued.
  Plan: [roadmap/v.1.2](roadmap/v.1.2_smartbill.md).
- **ANPR cameras** — **not built.** No ingestion endpoints, no `plateEvents`, no
  `/admin/anpr`. _Exception:_ the standalone overstay pieces that plan referenced
  **did** ship independently — the `adminChargeOverstay` callable and the
  `markNoShows` scheduled detector are live. Plan: [roadmap/v.1.3](roadmap/v.1.3_anpr.md).

---

## Current reference docs (live)

- [../Brief.md](../Brief.md) — product + architecture overview.
- [admin-flows/](admin-flows/) — staff-flow walkthroughs, one per admin area,
  plus the consolidated **[BUGS.md](admin-flows/BUGS.md)** register (note its
  status banner: a 2026-06 pass fixed a batch).
- [vercel-deploy.md](vercel-deploy.md) — how the frontend ships (Vercel, on push
  to `main`); Firebase CLI for functions/rules/indexes/storage.
- [feedback-june.md](feedback-june.md) / [feedback-june-status.md](feedback-june-status.md)
  — the June client-feedback round and its item-by-item resolution.

## Roadmap (planned / deferred, not built)

- [roadmap/v.1.2_smartbill.md](roadmap/v.1.2_smartbill.md) — SmartBill invoicing.
- [roadmap/v.1.3_anpr.md](roadmap/v.1.3_anpr.md) — ANPR cameras.
- [roadmap/v.1.4_netopia_v2_migration.md](roadmap/v.1.4_netopia_v2_migration.md) — Netopia v2 REST.
- [roadmap/cloud-switch.md](roadmap/cloud-switch.md) — move the Firebase project
  from the developer's personal Google account to the client's (deferred infra;
  partly stale re: Plesk → Vercel).

## Archive (historical, superseded)

- [archive/implementation.md](archive/implementation.md) — original MVP build record.
- [archive/v1-plan.md](archive/v1-plan.md), [archive/v1.1-plan.md](archive/v1.1-plan.md)
  — the v1 / v1.1 implementation plans (both shipped; kept for provenance).
- [archive/changes 10-05.md](archive/changes%2010-05.md),
  [archive/changes 13-05.md](archive/changes%2013-05.md) — raw client change notes (May 2026).
- [archive/client-feedback.md](archive/client-feedback.md),
  [archive/feedback-plan.md](archive/feedback-plan.md) — early feedback + planning notes.
