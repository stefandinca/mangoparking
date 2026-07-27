# i18n & Roles/Permissions

> Status: ✅ Shipped · Last verified: 2026-07-09

Two cross-cutting systems that touch nearly every page: the bilingual (RO/EN)
i18n layer and the role-based permission model. Both are small, dependency-free,
and deliberately single-source-of-truth.

Related: [Public site](../sections/public-site.md) · [Account area](../sections/account.md) ·
[Admin panel](../sections/admin.md) · [Admin-flows role matrix](../admin-flows/README.md)

---

## 1. Internationalisation (i18n)

Romanian is the **default**; English is served under an `/en` path prefix. There
is no framework — the whole layer is `src/i18n/{index,ro,en}.js`.

### Files & structure
- `src/i18n/ro.js` (~1977 lines) and `src/i18n/en.js` (~1961 lines) each
  `export default` one plain nested object. Both currently have **54 top-level
  key groups** (`nav`, `hero`, `pricing`, `booking`, `account`, `admin`,
  `checkins`, `cashbook`, `refunds`, `vouchers`, `legal`, …).
- `src/i18n/index.js` holds the runtime: `getLocale`/`setLocale`
  (`index.js:11-23`), `detectLocale` (`index.js:28-33`), `onLocaleChange`
  subscription (`index.js:38-44`), `t()` (`index.js:50-61`), and the path
  helpers `localePath` / `altLocalePath` / `stripLocale`
  (`index.js:67-91`).

`currentLocale` is a module-level variable (default `'ro'`). `setLocale()`
also sets `document.documentElement.lang` and notifies listeners so live
components can re-render on a language switch.

### `t(key, params)` — translation lookup
`t('hero.badge', { count: 87 })` splits the dotted key, walks the current
locale object, and returns the string (falling back to the raw key if any
segment is missing, so a missing translation is visible rather than blank).
See `index.js:50-61`.

**Interpolation is single-brace only.** The replace uses
`value.replace(/\{(\w+)\}/g, …)` (`index.js:60`). So `'{count} locuri'`
interpolates, but **`{{ name }}` renders its braces literally** — the regex
requires exactly one brace on each side and `\w+` does not match the leading
space inside `{{ … }}`.

> ✅ **Fixed (2026-07-23).** Several real keys had been authored with `{{ … }}`
> and displayed the braces to users in both locales (seasonal-pricing dialogs +
> the public `seasonal.appliedBadge`, refunds history/resend, voucher
> delete/duplicate — [admin-flows/BUGS.md](../admin-flows/BUGS.md) #1). All 8
> keys were rewritten to single-brace; the regex is unchanged. **Convention:
> always write `{name}`, never `{{ name }}`** — there is no automated check.

### Path helpers & routing
- `localePath('/booking')` → `'/booking'` in RO, `'/en/booking'` in EN
  (`index.js:67-73`). **All internal links must be wrapped in `localePath()`**
  so navigation preserves the active language.
- `stripLocale(path)` removes the `/en` (or `/ro`) prefix so the router can
  match against locale-agnostic route paths (`index.js:89-91`).
- `altLocalePath(currentPath)` returns the same page in the other language —
  used by the navbar language switcher (`index.js:78-84`).

The router ties it together: on every navigation it calls `detectLocale` +
`setLocale` from the path, then `stripLocale` before matching routes
(`src/router/index.js:96-100`, `:103`). `detectLocale` treats a path as EN only
when it starts with `/en/` or equals `/en` (`index.js:29`) — anything else is RO.

### Build-time SEO
Per-route `<title>`/description/OG/canonical/hreflang for both locales is
injected at build time by `scripts/prerender.mjs` from the table in
`scripts/seo-routes.mjs`. The EN variant of each route lives at `/en` + path,
and every prerendered page emits `hreflang` alternates (`ro`, `en`,
`x-default`). See [Public site → SEO](../sections/public-site.md#seo--prerender).

### Parity requirement (convention)
**Every key must exist in both `ro.js` and `en.js`.** Because `t()` falls back
to the raw dotted key on a miss, a key present in only one locale silently
shows `some.key.path` to users of the other language. There is no automated
parity check — keep the two files structurally identical when editing (both
currently expose the same 54 top-level groups). When adding a feature, add the
key to **both** files in the same place.

---

## 2. Roles & Permissions

A single `PERM` map plus a `role → permissions` table in
`src/utils/permissions.js` is the **one source of truth** shared by three
consumers, kept mutually consistent:

1. **Route guards** — `src/router/guards.js` (`perm:<name>` guards).
2. **Admin sidebar** — `src/components/admin/AdminLayout.js` filters links by
   permission (`AdminLayout.js:25-28`).
3. **Firestore rules** — `firestore.rules` gates privileged writes with
   `isAdmin()` etc. (the JS map and the rules are maintained in parallel; the
   rules are the real security boundary — the JS map only controls UI/routing).

### The roles
Defined at `permissions.js:20-25`:

| Role | Const | Notes |
|------|-------|-------|
| `admin` | `ROLE_ADMIN` | Full access incl. all configuration surfaces. |
| `agent` | `ROLE_AGENT` | Back-office operations. **Legacy `role: 'staff'` is normalized to `agent`** (`permissions.js:63-67`) — no data migration needed. |
| `driver` | `ROLE_DRIVER` | Shuttle driver at the lot — a reduced ops subset. |
| `customer` | `ROLE_CUSTOMER` | No admin access. **All new users are created `customer`** (enforced by rules). |

### The permission identifiers
`PERM` (`permissions.js:28-46`) has **17 entries**, one per admin section:
`dashboard`, `activity`, `checkins`, `transactions`, `cashbook`, `capacity`,
`pricing`, `shuttle`, `reviews`, `users`, `legal`, `refunds`, `vouchers`,
`promotions`, `website`, `help`, `audit`.

### Role → permission table
`ROLE_PERMISSIONS` (`permissions.js:47-60`):

| Permission | admin | agent | driver | customer |
|------------|:---:|:---:|:---:|:---:|
| dashboard | ✅ | ✅ | ✅ | — |
| activity | ✅ | ✅ | ✅ | — |
| checkins | ✅ | ✅ | ✅ | — |
| transactions | ✅ | ✅ | — | — |
| cashbook | ✅ | ✅ | — | — |
| capacity | ✅ | ✅ | ✅ | — |
| shuttle | ✅ | ✅ | ✅ | — |
| refunds | ✅ | ✅ | — | — |
| help | ✅ | ✅ | ✅ | — |
| audit | ✅ | ✅ | ✅ | — |
| pricing | ✅ | — | — | — |
| users | ✅ | — | — | — |
| vouchers | ✅ | — | — | — |
| promotions | ✅ | — | — | — |
| reviews | ✅ | — | — | — |
| legal | ✅ | — | — | — |
| website | ✅ | — | — | — |

- **admin** = `Object.values(PERM)` → all 17.
- **agent** = `dashboard, activity, checkins, transactions, cashbook, capacity,
  shuttle, refunds, help, audit` (10). Intentionally excludes every configuration /
  public-content surface (pricing, users, legal, vouchers, promotions, reviews,
  website). Note **reviews moved under the admin-only "Public website" section**,
  so agents no longer see it (the code comment at `permissions.js:51-56` and the
  slightly older [admin-flows README](../admin-flows/README.md) role matrix,
  which still lists reviews for agents, differ — the code above is authoritative).
- **driver** = `dashboard, activity, checkins, capacity, shuttle, help, audit` (7).
- **customer** = `[]`.

### Helper functions
- `normalizeRole(role)` — maps `'staff'` → `agent`, any unknown value →
  `customer` (`permissions.js:63-67`).
- `rolePermissions(role)` — the permission array for a role
  (`permissions.js:69-71`).
- `hasPermission(role, perm)` — membership test (`permissions.js:73-75`).
- `hasAdminAccess(role)` — true when the role has **any** permission; gates the
  `/admin` base and decides whether a blocked user bounces to `/admin` vs `/`
  (`permissions.js:78-80`).

### Route guards
`checkGuards(guards)` (`src/router/guards.js:14-42`) returns `null` when allowed
or a redirect path when blocked:

- **`'auth'`** — must be signed in, else → `localePath('/login')` (`guards.js:20-22`).
- **`'admin'`** — profile must pass `hasAdminAccess`, else → `localePath('/')`
  (`guards.js:24-28`).
- **`'perm:<name>'`** — must pass `hasPermission(role, name)`. If it fails but
  the user still has *some* admin access, they bounce to `/admin` (wrong section,
  not wrong site); otherwise to `/` (`guards.js:30-39`).

Admin routes therefore declare `guards: ['auth', 'admin', 'perm:<section>']`
(see `src/router/routes.js`), account routes declare `['auth']`, and public
routes declare `[]`. The router awaits Firebase auth rehydration before the
first dispatch so a hard refresh doesn't wrongly bounce a signed-in user to
`/login` (`src/router/index.js:44-50`).

### Sidebar consistency
`AdminLayout` builds `ADMIN_LINKS` (14 links — dashboard, activity, checkins,
transactions, cashbook, refunds, vouchers, website, capacity, pricing, shuttle,
users, audit, help) and filters them with `hasPermission` in `visibleLinks()`
(`AdminLayout.js:9-29`). The three consolidated editors — **promotions,
reviews, legal** — have `PERM` entries and standalone routes for deep links but
**no sidebar link**; they are reached through the `/admin/website` tabs. So the
sidebar shows at most 14 items even though `PERM` has 17 entries. Because the
sidebar and the route guards read the same map, a role can never see a link it
cannot open, and vice versa.
