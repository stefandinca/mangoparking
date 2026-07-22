# ParkVia (ParkCloud) — setup steps

A clear, do-this-next guide for connecting the ParkVia auto-import. Work through
it top to bottom. Paste results back to me and I'll wire the code.

> **Your key** lives in `documentation/parkcloud.md` (gitignored — never commit it).
> Wherever a step says "your ParkCloud key", use that value.

---

## 👉 DO THIS NEXT (current blocker: we need an Azure subscription key)

**What we just learned (2026-07-22):** running Get Operators with your key returned:

```
HTTP/1.1 401 Unauthorized
{ "statusCode": 401,
  "message": "Access denied due to invalid subscription key. Make sure to
              provide a valid key for an active subscription." }
```

So your key `ff03d3dd-…` is **NOT the Azure subscription key** — it's your
**ParkCloud.Net private key** (the `?key=` value). Keep it, we'll need it. But the
Azure gateway needs a *second* credential you don't have yet: an **active
subscription** + its **subscription key**. That's the only thing blocking us.

### Get the subscription key — pick one:

- **Try self-serve first:** ParkCloud developer portal → **Products** (top nav) →
  open the **Operator** product → **Subscribe** (give it any name).
  - If it activates immediately → go to **Profile** → your subscription → copy the
    **Primary key** → send it to me.
  - If it says **"pending approval"** → ParkVia has to approve it (next option).

- **Ask ParkVia (surest):** email your account manager —
  > *"We subscribed to the Operator product in the developer portal but need an
  > **active subscription**. Please approve/activate it and send our Azure
  > **subscription key** (`Ocp-Apim-Subscription-Key`). The private key you sent us
  > earlier is rejected at the gateway with 'invalid subscription key' — we
  > understand that key is the `?key=` value, not the subscription key."*

Once you have the subscription key, send it to me (add it to `parkcloud.md`, which is
gitignored). Then we can run Get Operators for real — which also gives us your
operator_id. You don't need to touch any code.

---

## Where we are

- ✅ Confirmed we need ParkVia's **Operator API** (not Affiliate / Location Enquiry).
- ✅ Base URL: `https://parkcloud.azure-api.net`
- ✅ The operations we'll use: **Get Recent Events**, **Get Booking Details**,
  **Get Operators**, **Get Arrivals/Departures**.
- ✅ The whole import pipeline is already built and shipped **dormant** — it does
  nothing until we plug in your credentials + confirm the field names.

**What's blocking go-live:** your `operator_id`, confirming how auth works, and one
or two sample API responses so I can finalize the field mapping.

---

## The key you have — which credential is it?

The portal's **Try it** form is asking for a **subscription key**. There are two
possible credentials in play:

- **Azure subscription key** → goes in the *"subscription key"* field in Try it
  (sent as the `Ocp-Apim-Subscription-Key` header). Gets you *through the gateway*.
- **ParkCloud.Net private key** → goes in the operation's own **`key`** field
  (sent as the `?key=` query param). Identifies *your account*.

Your Azure profile shows no subscriptions, but ParkCloud handed you a key directly —
so **that key is most likely the Azure subscription key** (ParkCloud provisioned the
subscription for you, which is why it doesn't show under your self-serve Profile).

**Don't overthink it — just test it (Step 1).**

---

## How to find your operator_id (a number)

The `operator_id` is the numeric id of your car park. Every Operator API call needs
it in the URL. You do **not** have to have the API working to find it — here are
three ways, easiest first:

### Method A — From your ParkCloud.Net account (no API, no keys needed)

1. Log in at **https://www.parkcloud.net** (the operator portal — a *different* site
   from the Azure developer portal where the API docs live).
2. Look on your **account / operator / car-park profile** page. The operator id is a
   number, usually shown next to your car park's name — it may be labelled
   **"Operator ID"**, **"Car Park ID"**, or **"Operator No."**.
3. It also often appears **in the page URL** when you open your car park, e.g.
   `.../operator/12345/...` → `12345` is your operator_id.

This is the quickest route and sidesteps the whole subscription-key question.

### Method B — From the "Get Operators" API call (once auth works)

Once Step 1 returns data, the **Get Operators** response lists every operator on your
account, each with its numeric id. That id is your `operator_id`. (This is why Step 1
is the ideal first call — it confirms auth *and* reveals the id in one go.)

### Method C — Just ask ParkVia (fastest if you're stuck)

Email your ParkVia / ParkCloud account manager:

> *"What is our ParkCloud operator_id — the number for our car park used in the
> Operator API URLs?"*

They'll reply with the number.

### What to do with it

Once you have the number, **paste it to me** (or jot it in `parkcloud.md`, which is
gitignored). I'll set it as `PARKVIA_OPERATOR_ID` when wiring the integration — you
don't need to put it anywhere in the code yourself.

---

## Can't find the operator_id anywhere? Two ways to unblock

You checked the ParkCloud.Net profile pages and URLs and it's not shown — that's
common (the id often only lives in the API / your account record). Do **one** of
these:

### Option 1 — Let the API tell you: just run "Get Operators"

You keep hitting "it wants a subscription key I don't have" — but **you *do* have a
key** (`ff03d3dd-…` in `parkcloud.md`). Whether or not it's *officially* the
subscription key doesn't matter; pasting it and sending is exactly how we find out.

1. **Operator** API page → **Get Operators** → **Try it**.
2. Paste your key into the **subscription key** field.
3. If a **`key`** field also appears, paste the **same value** there too.
4. Click **Send**.
5. **Copy the entire result — success *or* the exact error text — and paste it to me.**

- ✅ If it returns data → your **operator_id** is in that response, and we've also
  confirmed the key works.
- ❌ If it errors → the *exact wording* tells me precisely what's missing (a real
  subscription key vs. the private key). Paste it word-for-word; that's genuinely
  useful, not a failure.

### Option 2 — One email to ParkVia unblocks everything

The most reliable route. Email your ParkVia / ParkCloud account manager — copy-paste
this (don't include the key value itself; just reference it):

> **Subject:** ParkCloud Operator API — operator_id & key confirmation
>
> Hi [name],
>
> We're setting up the ParkCloud **Operator API** for our car park (Mango Parking,
> Otopeni). Could you please send us:
>
> 1. Our **operator_id** — the number used in the Operator API URLs.
> 2. Confirmation of the key you already sent us: is it our **Azure subscription
>    key** (`Ocp-Apim-Subscription-Key` header) or our **ParkCloud.Net private key**
>    (the `?key=` query value)?
> 3. If we need a **separate Azure subscription key**, please send it — our Azure
>    developer profile shows "no subscriptions".
>
> Thanks!

Their reply gives us the operator_id, clears up the key, and (if needed) the missing
subscription key — all at once.

---

## Step 1 — Test the key in "Get Operators"

1. Open the **Operator** API page in the ParkCloud developer portal.
2. In the operations list (left), click **Get Operators**.
3. Click the green **Try it** button.
4. Paste **your ParkCloud key** (from `parkcloud.md`) into the **subscription key**
   field.
5. If Try it *also* shows a **`key`** field (the query param), paste the **same
   value** there too for now.
6. Click **Send**.
7. **Copy the entire response and paste it back to me** (data *or* error — either
   tells us what we need).

### How to read the result

- **You get a list of operators** → 🎉 that key is the subscription key and auth
  works. The response contains your **operator_id** (a number) — the value I need
  for every other call.
- **The subscription is rejected (`401 Access denied due to invalid subscription
  key`)** → that key is *not* the subscription key. It's probably the ParkCloud.Net
  private key instead → go to **Step 1b** to get a subscription key.
- **The subscription passes but it complains about `key`** → the subscription key is
  fine, but you *also* need the separate **ParkCloud.Net private key** → **Step 1c**.

---

## Step 1b — If the subscription key was rejected

You need an Azure subscription key. Two ways:

- **Ask ParkCloud/ParkVia to send it.** Since they already gave you a key, email your
  ParkVia account manager: *"Please send my ParkCloud Operator API subscription key
  (Ocp-Apim-Subscription-Key) — my Azure profile shows no subscriptions."*
- **Or self-subscribe:** top nav **Products** → open the **Operator** product →
  **Subscribe**. If it says *pending approval*, the account manager approves it, then
  the key appears under **Profile**.

Send me the subscription key once you have it.

## Step 1c — If it needs a separate ParkCloud.Net private key

The `?key=` value comes from your **ParkCloud.Net account** (the operator portal at
parkcloud.net — *not* the Azure developer portal). Log into ParkCloud.Net → account /
API settings → copy the **private key**. Send it to me (add it to `parkcloud.md`,
which is gitignored).

---

## Step 2 — Grab two sample responses (so I can finalize the field mapping)

Once Step 1 works and you have your **operator_id**, run these two in **Try it** and
paste the responses. These show me the real field names, so imported bookings carry
the correct plate, dates, price, etc.

1. **Get Recent Events** — the feed of new / changed / cancelled bookings.
   - Paste the response. I'm looking for: booking reference, event type, timestamp.
2. **Get Booking Details** — use one booking reference from the events above.
   - Paste the response. I'm looking for: number plate, drop-off & pick-up
     date/time (and their exact format), price, customer name/email/phone, status.

> **Tip:** if "Try it" lets you set an **Accept** header, try `application/json` —
> JSON is simpler than XML. Tell me which formats it offers.

### Faster alternative to Step 2

At the top of the Operator page there's an **API definition** dropdown. If you can
**download/export** it (OpenAPI / Swagger / any format) and drop the file into the
repo (e.g. `documentation/parkcloud-api.json`), that contains **every endpoint and
field name at once** — then I may not need the samples at all.

---

## Step 3 — I wire it up (my job, once you send the above)

With your operator_id + auth confirmed + one sample (or the API definition), I will:

1. Point `functions/src/parkvia.js` at the real endpoints (Get Recent Events +
   Get Booking Details), the real base URL, and the correct auth
   (`?key=` private key, plus a subscription header only if Step 1b applied).
2. Finalize `mapParkviaBookingToImport` against the real field names + datetime
   format, and update the unit test to a real sample.
3. Set the poll to work off the events feed.
4. Store your credentials properly (Secret Manager), **not** in a repo file.

Then you run **Check connection** on `/admin/pricing` — green means it's live, and
ParkVia bookings start importing automatically every 15 minutes.

---

## Quick checklist — what to send me

- [ ] **Step 1:** the full "Get Operators" response (data *or* the error).
- [ ] **Your operator_id** (the number from that response).
- [ ] **Step 2:** a "Get Recent Events" response + a "Get Booking Details" response
      — *or* the exported **API definition** file.
- [ ] If Step 1b applied: your **Azure subscription key** from Profile.

**Right now, just do Step 1** and paste me the result. Everything else follows from
that. 👇
