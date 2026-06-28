# 05 — Vouchers, Promotions, Pricing & Capacity

**Pages:** `/admin/vouchers` (`AdminVouchers.js`), `/admin/promotions`
(`AdminPromotions.js`), `/admin/pricing` (`AdminPricing.js`), `/admin/capacity`
(`AdminCapacity.js`).
**Permissions:** `perm:vouchers`, `perm:promotions`, `perm:pricing`,
`perm:capacity`.
**Server cross-check:** `functions/src/pricingValidate.js` (authoritative price +
voucher resolution).

## In plain words

- This is the **"business settings"** corner of the admin panel.
- **Vouchers:** create discount codes — a fixed amount off, a percentage off, or
  the new **"free parking days"** type. Codes can be public or assigned to
  specific customers. Public codes appear on the public **Promotions page** only
  if you tick **"Show on promotions page"** (opt-in, off by default).
- **Promotions:** edit the content of the public promotions page (text + image),
  in both Romanian and English.
- **Pricing:** set the **daily parking rates** by length of stay, plus special
  **seasonal periods** (e.g. holiday pricing).
- **Capacity:** a visual map of every parking spot — tap a spot to mark it free,
  occupied, reserved, or under maintenance.
- **Things to watch (see bugs):** the pricing table has **no safety checks**, so a
  typo (a missing day range or a 0 rate) silently mis-prices bookings. Deleting a
  voucher leaves leftover "free-day" balances behind, and there's no screen to see
  who redeemed what.

---

## Flows

### Flow 1 — Create a voucher (percent / fixed)
1. `/admin/vouchers` loads all `promoVouchers` (by `createdAt desc`) **and the
   entire `users` collection** in parallel (`:91`). Page is `await`ed before
   mount, so the route shows nothing until both resolve (no spinner).
2. **+ Voucher nou** → modal defaults `type='percent'`, `value=10`,
   `visibility='public'`, `active=true`.
3. Code field uppercases/strips to `[A-Z0-9]` live. Pick Percent/Fixed, value,
   start/end dates, optional max-redemptions, Active, and — for public codes —
   **"Show on promotions page"** (opt-in, off by default; hidden for private codes
   and forced off on save). Sets the `showOnPromotions` flag the public
   `/promotions` page filters on (alongside active + in-window).
4. Submit validation: code format (3–24), name non-empty, value > 0, **percent
   > 100 rejected** (`:324`), days-integer (`:325`), both dates present,
   `startDate > endDate` rejected (`:329`), private-assignees, max ≥ 1. Duplicate
   code checked in memory (`:351`).
5. `saveVoucher` → `setDocument('promoVouchers', CODE, …, {merge:true})` (doc ID =
   code) + audit; `redeemedCount` forced to 0. Toast `vouchers.saved`.

### Flow 2 — Create a "days" voucher (v1.9)
As Flow 1 but type **"Zile gratuite (termen lung)"**; selecting it reveals the
contextual hint; `value` validated as a positive **integer**. Table shows
"N zile gratuite". No balance/ledger doc created at save time (server writes those
on first redemption).

### Flow 3 — Edit a voucher
Edit → modal seeded from the doc. **Code is `readonly`**; **type and value are
freely editable with no warning even if `redeemedCount > 0`**. `redeemedCount` and
`createdAt` preserved. `setDocument` merges.

### Flow 4 — Deactivate a voucher
**No dedicated control** — Edit → untick "Voucher activ" → Save. Server rejects
inactive codes (`pricingValidate.js:159`).

### Flow 5 — Delete a voucher
Șterge → `confirmModal` → removes the `promoVouchers/{CODE}` doc + audit. **No
cleanup** of `voucherDayBalances/*` or `voucherRedemptions` keyed to that code
(Bugs 5 & 6).

### Flow 6 — Assign a private voucher
Private radio → assignees block reveals a **checkbox list of every registered
user** (name/email/uid) with a live text filter. No raw-uid entry. Private with
zero selected is rejected. Server enforces membership. (Can't assign a guest-by-
plate; whole user table loaded client-side.)

### Flow 7 — Edit the promotions page
`siteContent/promotions`: shared hero image URL + RO/EN {title, intro, Quill
body}. Live preview on hero URL. Locale tab flushes the editor HTML into `working`
before swapping. Save trims + persists + audit. Body sanitized on **render**, not
save. **No required-field validation** — empty title/intro/body save silently.

### Flow 8 — Edit long-term rate tiers
`/admin/pricing` loads packs, rates, commuter policy, discount %, seasonal periods
in parallel. One row per tier (minDays/maxDays/perDay), bound on `input`; blank
maxDays → `null` (unlimited). **Add tranșă** pushes `{minDays:lastMax+1,
maxDays:null, perDay:29}`. **Salvează** writes rates + commuter policy + discount
together; `saveLongTermRates` does a bare `setDocument` — **zero validation**.
Takes effect immediately on the next server price recompute.

### Flow 9 — Seasonal pricing period
**+ Adaugă perioadă** → modal seeded from current default tiers. Enter name,
start/end, active, per-period tier table. Validation: name, both dates,
`startDate > endDate`, ≥ 1 tier, each tier truthy `minDays` & non-null `perDay`,
then `findOverlap` against existing **active** periods (excl. self). Server applies
the period whose inclusive `[start,end]` contains the **pick-up day** in Bucharest.

### Flow 10 — Capacity / spot status
`/admin/capacity` loads `spots`, in-flight bookings, `activeCheckIns`; builds a
plate-by-spot map. 4 zone grids of tiles colored by status; real-time
`subscribeCapacity` updates the header/legend. **Click a tile** cycles
`available → occupied → reserved → maintenance` (optimistic, rollback on failure).
**No date-based blocking/closure feature, no create/delete-spot UI, no
zero-capacity guard.**

---

## Bugs & inconsistencies

1. **[HIGH] `{{ … }}` i18n keys render literally** — `vouchers.deleteConfirm`,
   `vouchers.errorCodeTaken`, `seasonal.deleteConfirm`, `seasonal.errorOverlap`,
   `seasonal.appliedBadge` (the last is public-facing). Both locales. Admins see
   "Ștergi voucherul {{ code }}?" verbatim. See BUGS #1.
2. **[HIGH] Long-term tier table has no validation** — gaps, overlaps, inverted
   ranges, and `perDay = 0` all save (`longTermService.js:22`, `AdminPricing.js:266`).
   Server `tierForDays` silently falls back to the **last tier** for any uncovered
   day count, so a gap (e.g. `1-6` then `8-13`, day 7 missing) charges an
   unintended rate with no error. Same hole inside seasonal-period tiers.
3. **[MED] Editing type/value after redemptions: no warning, balances not
   reconciled.** Lowering a days voucher's `value` below an identity's used days
   silently zeroes their remaining balance (`daysAvailable=max(0,value-used)`);
   raising it silently re-grants. Changing percent↔fixed↔days mid-campaign changes
   economics for a code people already hold. No confirmation.
4. **[MED] No admin visibility into redemptions or day-balances.** The only signal
   is `redeemedCount / cap`. There's no view of `voucherRedemptions` or
   `voucherDayBalances` (who redeemed, split-days remaining). For days vouchers
   `redeemedCount` counts *distinct holders*, but the column is labelled generic
   "Usage" — misleading. Can't troubleshoot a customer's "no-days-left" complaint.
5. **[MED] Deleting a voucher orphans `voucherDayBalances`; reusing the code
   resurrects stale balances.** Delete only removes `promoVouchers/{CODE}`. Because
   balance doc IDs are `{CODE}_{identity}`, recreating a voucher with a reused code
   makes `resolveVoucher` read the **old** `daysUsed` — a returning customer is
   wrongly denied days on a brand-new campaign.
6. **[MED] Delete/recreate does not reset fixed/percent redemption state.**
   `voucherRedemptions` rows survive deletion; the new doc resets `redeemedCount`
   (global cap resets) but `resolveVoucher`'s per-identity dup check still returns
   `already-used` for prior redeemers — inconsistent state.
7. **[MED] Pricing/seasonal edits break in-flight checkouts (hard error, no
   preview).** Price is recomputed at pay time with zero tolerance
   (`index.js:309`); an edit while a customer holds an older quote → `createPayment`
   returns "price mismatch — refresh" (400). No "applies to new bookings only", no
   scheduled activation, no preview of a tier change's effect.
8. **[MED] Pack name rendered unescaped into `value=""`** (`AdminPricing.js:44`) —
   a name with `"` breaks the attribute / injects. Admin-entered (lower
   exploitability) but inconsistent with the rest of the codebase.
9. **[MED] Mobile: tier rows use a non-collapsing `grid-cols-12`** (`:62`) and the
   modal tier rows (`:353`) cram three number inputs + a delete button into
   `max-w-lg` — very tight on phones.
10. **[LOW] Capacity headline uses a `TOTAL_CAPACITY` constant, not the real spot
    count** (`:75`); legend (real counts) and headline disagree on first paint if
    the collection size differs. `getAllSpots()` failure `.catch(()=>[])` →
    four empty zones look like a real "0 spots" state. Tile tooltip loses the
    occupying plate after a toggle (`:157`).
11. **[LOW] Online-discount input clamps silently.** `max="50"` is a hint only;
    typing 80 saves as 50 (`discountService.js:32`) with no toast — the field
    showed 80.
12. **[LOW] "Add tier" after an unlimited tier produces a dead duplicate
    catch-all** (`:241` → `minDays:1, maxDays:null`), since `tierForDays` returns
    the first match.
13. **[LOW] Fixed voucher accepts non-integer lei** — only `days` enforces
    `Number.isInteger` (`:325`); a `fixed` 49.5 yields a fractional discount
    against the whole-lei convention. The single value field also doesn't relabel
    its unit (lei/%/days).
14. **[LOW] Voucher & seasonal windows allow `startDate === endDate` and
    entirely-past windows with no notice** (only `start > end` is rejected).

**Correct:** percent>100, negatives, empty dates, private-no-assignee all
validated; seasonal active-vs-active overlap rejected with inclusive logic
matching the server; inclusive `[start,end]` semantics match the server; private
assignment is checkbox-based + `escapeHtml`'d; days-voucher type + label wired in
both locales.
