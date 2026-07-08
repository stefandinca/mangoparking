# Public Site

> Status: ✅ Shipped · Last verified: 2026-07-09

Every route reachable without signing in — marketing pages, the two booking
funnels, the payment/return handoff, and the legal pages. All public routes are
declared with `guards: []` in `src/router/routes.js` and each page module
`export default function(container)`.

Related: [Account area](./account.md) · [Admin panel](./admin.md) ·
[i18n & permissions](../backend/i18n-and-permissions.md) · product overview in
[Brief.md](../../Brief.md)

---

## Routing & locale

The SPA uses a History-API router (`src/router/index.js`). On each navigation it:
1. Strips query string, hash, and any trailing slash before matching
   (`index.js:93`) — Netopia return URLs and the `404.html` `?redirect=` handoff
   both carry query strings.
2. Detects locale from the path and calls `setLocale` (`index.js:96-97`).
   `/en/...` (or exactly `/en`) is English; everything else is Romanian
   (`src/i18n/index.js:28-33`).
3. Strips the `/en` prefix and matches against the locale-agnostic route table
   (`index.js:99-103`). Unknown paths fall back to the home page
   (`index.js:105-109`).

Link clicks are intercepted for SPA navigation, but external links, `mailto:`/
`tel:`/hash links, downloads, `blob:` URLs, `target="_blank"`, and modifier-key
new-tab gestures are passed through to the browser (`index.js:20-38`). The first
dispatch waits for Firebase auth to rehydrate so a hard refresh doesn't misfire
guards (`index.js:44-50`). Internal links must use `localePath()` to stay in the
active language — see [i18n](../backend/i18n-and-permissions.md#path-helpers--routing).

## SEO / prerender

There is **no runtime SSR**; instead the build injects per-route `<head>` tags.
`scripts/prerender.mjs` runs after `vite build`, takes the built
`dist/index.html` shell, and for each route in `scripts/seo-routes.mjs` rewrites
title / description / OG / Twitter / canonical / hreflang / JSON-LD, writing
`dist/<route>/index.html` for **both** locales (EN at `/en` + path). It is
pure-Node (no headless Chromium) because Vercel's build container can't launch
Chromium, and it is **non-fatal** — a failure logs a warning and the plain SPA
still ships (`prerender.mjs:90-94`). Each page also sets its own tags at runtime
via `updateMeta()` (and `setStructuredData()` on Home) so client navigations
stay correct. `seo-routes.mjs` only carries the marketing/funnel routes
(`/`, `/pricing`, `/about`, `/contact`, `/shuttle`, `/promotions`, `/booking`,
`/booking/credits`, `/booking/long-term`); legal and account pages are not
prerendered.

---

## Pages

### `/` — Home (`src/pages/public/Home.js`)
The landing page and primary upsell surface. Sections: hero with a **live
capacity badge** and CTAs to both funnels; "how it works" carousel; pricing
preview (long-term tiers + credit packs) pulled from `getLongTermRates()` +
`getTokenPacks()`; amenities carousel; on-demand shuttle card; published reviews
grid; a 5-item FAQ accordion; a facility gallery with lightbox; and a closing
CTA with a Google-Maps embed and a contact form. Live data: `subscribeCapacity()`
keeps the badge current, `getPublishedReviews()` and `getGalleryImages()` fill
the review/gallery blocks, and the contact form calls `submitContactMessage()`.
SEO: `updateMeta()` plus `setStructuredData()` emitting a `ParkingFacility` +
`LocalBusiness` schema.org object (mirrored in `seo-routes.mjs`'s `HOME_JSONLD`).

### `/booking` — Funnel picker (`src/pages/public/Booking.js`)
A thin chooser: two cards linking to `/booking/long-term` (date-range
reservation) and `/booking/credits` (commuter credit packs). No data, no state.

### `/booking/credits` — Buy credits (`src/pages/public/BookingCredits.js`)
Multi-step accordion wizard (`STEP_ORDER = ['pack','details','billing','voucher']`)
with a sticky price-summary sidebar. Steps: pick a credit pack (packs from
`getTokenPacks()`, best-value badge); vehicle + contact details (prefilled from
saved vehicles for signed-in users); billing identity (PF/PJ, "same as contact"
sync); optional promo voucher (`previewVoucher()`). Payment method toggles
**online (Netopia)** vs **pay-at-pickup**. Submit calls `startNetopiaPayment()`
to hand off to the encrypted Netopia envelope; on success it can persist a new
vehicle to the user profile. A profile-completeness gate redirects signed-in
users with incomplete profiles before checkout. `getOnlineDiscountPercent()`
drives the online-vs-arrival price delta.

### `/booking/long-term` — Long-term booking (`src/pages/public/BookingLongTerm.js`)
The most complex funnel. Accordion steps
`['dates','details','billing','paymethod','voucher']`. The **dates** step has
dropoff/pickup datetime pickers with flight-number fields; price is recomputed
live from tiered `getLongTermRates()` with `listSeasonalPeriods()` overrides
(seasonal badge shown when a period applies) and the online-discount and voucher
deltas. Details captures vehicle, passenger count, and contact; billing captures
PF/PJ identity; paymethod toggles online vs pay-at-pickup; voucher runs
`previewVoucher()`. `getOpeningHours()` feeds an **after-hours + last-minute
gate**: a same-day booking outside office hours triggers a modal that routes the
customer to a phone call instead of self-serve checkout. Submit hands off to
Netopia. Same profile-completeness gate as the credits funnel.

### `/booking/return` — Order return listener (`src/pages/public/BookingReturn.js`)
Where Netopia (and pay-at-pickup) land after checkout. Reads `?orderId=ord_…`
and opens a **real-time `subscribeDoc('pendingOrders', orderId)`** listener,
flipping the UI between processing → success / pay-at-pickup / failure as the IPN
(`netopiaCallback`) updates the order. A 90-second watchdog shows a "still
processing" message if no terminal status arrives. Guests get a signup CTA
(register for a voucher, email prefilled); pay-at-pickup orders stay "pending"
with a nudge to pay online for the discount.

### `/pay` — Repay a pay-at-pickup order (`src/pages/public/PayOrder.js`)
Self-service page to pay an order that was left pay-at-pickup. Reads
`?orderId=ord_…` (with backward-compat resolution by `bookingId`), loads the
order, applies `getOnlineDiscountPercent()` to show the online savings, and on
submit calls `submitNetopiaHandoff()` (the `repayOrder` path), redirecting back
to `/booking/return` once the IPN confirms.

### `/pricing` — Pricing reference (`src/pages/public/Pricing.js`)
Read-only reference showing all long-term tiers (`getLongTermRates()`) and credit
packs (`getTokenPacks()`) side by side, with struck-through standard vs online
price using `getOnlineDiscountPercent()`, a best-pack highlight, a "how credits
work" info box, and CTAs into both funnels.

### `/shuttle` — Shuttle & schedules (`src/pages/public/Shuttle.js`)
Describes the on-demand "ManGO buzz" shuttle and renders a train-schedule table
(`getTrainSchedule()`) plus a popular-flights table (`getPopularFlights()`),
responsive down to mobile.

### `/about` — About (`src/pages/public/About.js`)
Static marketing: story, a security-features checklist (from the
`about.securityFeatures` i18n array), an amenities grid, and a small image
gallery. No live data.

### `/contact` — Contact (`src/pages/public/Contact.js`)
Contact form (`submitContactMessage()`), a contact-info card with phone/email/
address and an **office-hours table patched from `getOpeningHours()`** after
first paint, a Google-Maps embed with a directions link, and an operator/company
registration details card (legal name, CUI, reg com).

### `/promotions` — Promotions (`src/pages/public/Promotions.js`)
Marketing page for active promo codes. Renders an admin-editable hero + body
(`getPromotionsPage()`, rich text via `renderPromoBody()`) followed by a grid of
**public** vouchers filtered to `visibility === 'public'` **and**
`showOnPromotions === true` within their active date range (compared in
Europe/Bucharest time), each with a copy-to-clipboard button. Locale falls back
`page[locale] || page.ro || page.en`. Editable from
[admin → website (promotions tab)](./admin.md#website--adminwebsite-adminwebsitejs--admin-only).

### Legal pages — `/terms`, `/privacy`, `/gdpr`, `/delivery`, `/cancellation`
Files: `Terms.js`, `Privacy.js`, `GDPR.js`, `Delivery.js`, `Cancellation.js`.
Required for Netopia / ANPC compliance. Each is thin: it calls
`renderLegalPage(container, { slug, … })` from
`src/components/core/LegalPageShell.js` with i18n default content, which:
- paints the i18n defaults immediately (works even before/without any CMS data),
- then async-patches with a Firestore override via `getLegalPage(slug, locale)`
  if an admin has edited that page (no override → prerendered defaults stay),
- interpolates company placeholders (`{site}`, `{company}`, `{address}`, `{cui}`,
  `{regcom}`, `{email}`, `{dpo}`), escapes HTML, and paragraph-ifies `\n\n`.

The override bodies are edited from
[admin → website (legal tab)](./admin.md#website--adminwebsite-adminwebsitejs--admin-only)
(`AdminLegal.js`, `legalPageService`).

---

## Notes / caveats
- Line references in this doc are indicative; the load-bearing routing facts were
  verified in `src/router/{index,routes}.js` and `src/i18n/index.js`. Page-level
  line numbers may drift as pages evolve — grep the named service/handler.
- The Shuttle page has an auto-refresh interval stub that is not implemented
  (unverified whether it re-fetches in production).
- `Commuter.js` (`/commuter`) exists but its route is commented out in
  `routes.js` (hidden) — see [admin doc → hidden routes](./admin.md#hidden--commented-out-routes).
