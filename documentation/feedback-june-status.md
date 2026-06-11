# Feedback June — Resolution Status

Maps each item from [feedback-june.md](feedback-june.md) to what was changed.
Grouped into the clusters the work was committed in. Most server behaviour
needs a Functions deploy; email-template edits need a Brevo re-paste (see
**Deploy / activation** at the bottom).

## Pricing model (precursor work)

The online discount was a display anchor only — listed prices were treated as
the final online price and pay-at-pickup was grossed *up*, so the online total
never dropped below the listed rate (8d × 22 = 176 shown as 176). **Flipped to
a real cut:** DB prices are the STANDARD / on-site price; paying online applies
a real −10% on top; pay-at-pickup pays the standard price. Applied site-wide
(long-term, credit packs, `/pricing`) + server `createPayment`/`repayOrder`.
Booking records now store the actually-charged amount.

## Cluster A — vouchers & discount display

| # | Item | Resolution |
|---|------|-----------|
| 4–6 | Vouchers "codul nu este încă valabil" | Caused by a **future start date**. New vouchers default to today→+1yr; server compares date-only strings. Re-test with a fresh code. |
| 7 / 10 | Show discounts next to the final price + in the payment-method step | Long-term booking shows an itemized breakdown (subtotal, −X% online, −voucher) and echoes the live to-pay amount in the payment-method step. |
| 8 | Credit voucher "enter plate" despite a selected vehicle | Fixed — voucher apply now resolves the radio-selected saved vehicle. |
| 9 | Vouchers didn't work on pay-at-pickup | **Now they do** — promo codes apply to pickup; the agent collects the reduced amount; cashbook records the actual collected sum. |

## Cluster B — pricing consistency

| # | Item | Resolution |
|---|------|-----------|
| 23 | Homepage "de la 29 lei" vs "de la 22" | **Not yet done** — the hero hardcodes `29`; should read the cheapest tier dynamically. See Backlog. |

## Cluster C — booking flow & copy

| # | Item | Resolution |
|---|------|-----------|
| 11 | Thank-you page "pay online" had no link | Added a working "Plătește online acum" button → `/pay?orderId=`. |
| 19 | Check-out tab showed "Anulează rezervarea" | Removed from the check-out tab (kept on check-in / overdue). |
| 20 | Confirm button stuck after Netopia → Back | Re-enabled on bfcache restore (`pageshow`). |
| 21 | Pay-at-pickup said "Se procesează plata" | Now "Se procesează rezervarea/comanda". |

## Cluster D — account / billing

| # | Item | Resolution |
|---|------|-----------|
| 1 | Logged-in data not pre-filled | Prefill already works when the saved profile has the data (router awaits auth before render). |
| 2 | Contact "Nume" vs billing "Nume + Prenume" | Bridged by the now-usable "same as contact" auto-fill. |
| 3 | "Same as contact" locked the name field | Fixed — fields stay editable (tinted to show they're synced); typing releases the sync. |

## Cluster E — check-in / overdue / collection

| # | Item | Resolution |
|---|------|-----------|
| 17 | Commuters not in Overdue at 20:00 | Commuters now surface the moment they pass the 20:00 cutoff (no grace for visibility); the extra-day charge keeps the 2h grace. |
| 18 | Overstay only shown at check-out, not enforced | Check-out now opens the overstay charge dialog first; skipping requires an explicit "check out anyway" override. |
| 22 | No confirm on cash/card collection | Both the collect dialog and the overstay charge now ask "Confirm collecting N lei (cash/card)?" before recording. |

## Cluster F — credits & emails

| # | Item | Resolution |
|---|------|-----------|
| 13b | Credits online-only except walk-ins | Removed the pay-at-pickup option from the public credits funnel (walk-ins still pay cash via the admin modal). |
| 12 | Trade-registry number | Updated to `J2014000079041` in `constants.js` (site footer + legal) and all 24 email templates. |
| 15 | Google Maps button in email | Added to the long-term confirmation template (RO+EN). |
| 16 | Congestion disclaimer (arrive 2.5h early) | Added to the long-term confirmation template (RO+EN). |
| 13a | Credit-purchase explanatory email | Added a "How credits work" explainer to the credit-purchase template (RO+EN). |
| 14 | Bigger / clearer email font | **Not done** — best handled as a Brevo design pass across all templates. |

## Backlog (not done this round)

- **#23** homepage hero "de la 29 lei" → derive from the cheapest tier.
- **#14** larger body font across all email templates (Brevo design pass).
- Broker/prepaid (ParkVia) separate evidence + booking-code prefixes
  (LT0001 / N0001) — mentioned in the original list, not scoped here.

## Deploy / activation

- **Frontend** (all funnel/admin/i18n changes): ships on push to `main` (Vercel).
- **Cloud Functions** (pricing charge, vouchers on pickup, cashbook fix, voucher
  date check): `firebase deploy --only functions`. Ship together with the
  frontend so display and charge stay in sync.
- **Email templates**: `email-templates/*.html` are the SOURCE pasted into
  Brevo. The registry (#12), maps (#15), disclaimer (#16) and credit explainer
  (#13a) edits go live only after re-pasting the changed templates into Brevo
  (booking-longterm-confirm-ro/en, credit-purchase-ro/en, and — for the
  registry — all 24).
