# SmartBill — credentials template (DEMO / placeholders)

> **This file contains PLACEHOLDER values only — safe to commit.**
> Swap in the real values locally when you have them, run the "Set the secrets"
> steps below, then **revert this file to placeholders** (or `git checkout` it)
> so real credentials never land in git. The `.gitignore` only excludes
> `netopia*keys*.md`, so this file is NOT auto-ignored — keep it clean.

## The three secrets

SmartBill auth is HTTP Basic: **username = account email**, **password = API
token**. `CIF` is the seller (our) fiscal code, sent as `cif` on every request.

```
SMARTBILL_USERNAME = you@yourcompany.ro         # SmartBill account email (the login)
SMARTBILL_TOKEN    = 000000000000000000000000|00000000000   # API token (may contain a '|')
SMARTBILL_CIF      = RO00000000                 # seller fiscal code (RO######## or unprefixed)
```

## Where to get each

- **SMARTBILL_USERNAME** — the email you log in to SmartBill with.
- **SMARTBILL_TOKEN** — SmartBill web app → **Contul meu → Integrări → API** (a.k.a.
  "Informații API"). The token is **per-user**: it inherits that user's rights.
  For proforma issuing you need a user with **emitere proformă** + **acces serii**
  rights (see the doc file). Regenerating the token invalidates the old one.
- **SMARTBILL_CIF** — the company fiscal code the invoices are issued under
  (Setări → Date firmă). Must match the company the token's user belongs to.

## Set the secrets (after swapping in real values here)

Secrets live in Google Secret Manager, bound per-function. Updating a secret
creates a NEW version, so the functions that bind it must be **redeployed** to
pick it up.

```bash
firebase functions:secrets:set SMARTBILL_USERNAME
firebase functions:secrets:set SMARTBILL_TOKEN
firebase functions:secrets:set SMARTBILL_CIF          # only if the company changes

# redeploy the functions that bind these secrets
firebase deploy --only functions:smartbillHealthcheck,functions:smartbillTestIssue
```

> Tip: `firebase functions:secrets:set NAME` prompts for the value on stdin so
> it's never echoed to the shell history. You can also pipe:
> `printf %s 'value' | firebase functions:secrets:set NAME --data-file -`.

## Verify after setting

Admin → **`/admin/pricing`** → SmartBill card:

1. **Check SmartBill connection** → expect `ready` (invoice series + 21% VAT).
2. **Test document issue** → expect three green rows: Proforma (PF), Proforma
   (PJ), Invoice (draft). Any red row's text tells you exactly what's missing.

## Current status (2026-07-16)

Secrets are at **version 2** — swapped to a full-rights user, which resolved the
earlier proforma-rights blocker (`Nu poti emite proforma. Lipsesc drepturile
de: emitere proforma, acces serii (ACR).`). Account series are pinned in code
(per GET /series — note the casing): fiscal invoice **`Mango`** (type `f`),
proforma **`MANGO`** (type `p`).

> Scratch file for real values: `documentation/smartbill-creds.md` — gitignored,
> never commit it. See `smartbill-doc.md` for the full state snapshot.
