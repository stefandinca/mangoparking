# Netopia Deploy & Setup Runbook

Step-by-step to take the Cloud Function live with Netopia Mobilpay.
Use this after `functions/src/index.js` is wired (already done in commit
`68c4bfd`) and you have credentials from Netopia.

---

## Prerequisites

- Firebase project on the **Blaze** (pay-as-you-go) plan. Spark won't
  deploy Functions.
- Netopia merchant account with a **POS** configured. From the POS
  settings page you should have downloaded:
  - **Signature code** — short string, e.g. `ABCD-EFGH-IJKL-MNOP-QRST`
  - **Public key** — `.cer` or `.pem` file
  - **Private key** — `.key` or `.pem` file
- Firebase CLI installed and logged in:
  ```bash
  npm install -g firebase-tools
  firebase login
  firebase projects:list   # confirm the project is visible
  ```

---

## Step 1 — Install deps and deploy the function

From the project root:

```bash
cd functions && npm install && cd ..
firebase deploy --only functions
```

First deploy will prompt to enable Cloud Build and Cloud Run APIs.
Answer yes to both. Deploy takes ~2–3 minutes.

When deploy finishes, the function URLs are printed, e.g.:

```
https://europe-west1-<project-id>.cloudfunctions.net/createPayment
https://europe-west1-<project-id>.cloudfunctions.net/netopiaCallback
```

Write the `netopiaCallback` URL down — you need it in step 3.

---

## Step 2 — Set the 5 secrets

From the project root:

```bash
# Signature: short string, paste at the prompt then Enter
firebase functions:secrets:set NETOPIA_SIGNATURE

# Environment: type either 'sandbox' or 'live'
firebase functions:secrets:set NETOPIA_ENV

# Reserved for v3 REST API (currently unused — paste any non-empty value)
firebase functions:secrets:set NETOPIA_API_KEY

# Multi-line PEM files — pipe from disk
firebase functions:secrets:set NETOPIA_PUBLIC_KEY  < path/to/netopia_public.cer
firebase functions:secrets:set NETOPIA_PRIVATE_KEY < path/to/netopia_private.key
```

Each set command either reads stdin (for the piped PEM files) or prompts
for the value. Values land in Google Secret Manager, bound to the
function at runtime via `defineSecret()` — nothing lands in git.

After setting secrets you must redeploy so the function picks them up:

```bash
firebase deploy --only functions
```

---

## Step 3 — Configure URLs in Netopia's admin panel

Log into Netopia's merchant panel. In the POS configuration page set:

| Field              | Value                                                                           |
|--------------------|---------------------------------------------------------------------------------|
| **IPN URL**        | `https://europe-west1-<project-id>.cloudfunctions.net/netopiaCallback`          |
| **Return URL**     | `https://mangoparking.ro/booking/return` (or your deployed domain)              |

Save. Netopia validates the URLs are reachable (HTTPS only).

---

## Step 4 — Test in sandbox

Set `NETOPIA_ENV=sandbox` and use the sandbox signature + key pair (they
differ from live). Then:

1. From the deployed site, open `/booking/long-term`.
2. Pick dates, fill plate + contact.
3. Click **Plătește cu Netopia**.
4. You should land on `https://sandboxsecure.mobilpay.ro/...` with a
   card form.
5. Use the Netopia test card (numbers live in their docs — usually
   `9900004400000006` or similar, any future expiry, any CVV).
6. Complete payment. Netopia redirects your browser back to the return
   URL.
7. Out-of-band, Netopia POSTs the IPN to your `netopiaCallback` URL.

Verify in Firestore:
- `pendingOrders/{orderId}.status` should become `paid`
- `bookings/{id}` doc should exist with `paymentId === orderId`
- Function logs (`firebase functions:log`) should show a
  `<crc>success</crc>` response.

If `pendingOrders.status` stays `pending`:
- IPN URL not reachable → check Netopia sent the callback, check function
  logs for the decrypt error.
- Wrong key pair → decrypt fails, logs show `decrypt failed`.
- Signature mismatch → Netopia refuses to accept the request; browser
  lands on a Netopia error page before paying.

---

## Step 5 — Go live

Once sandbox round-trips cleanly:

1. Get production signature + key pair from Netopia.
2. Update the secrets:
   ```bash
   firebase functions:secrets:set NETOPIA_SIGNATURE       # live signature
   firebase functions:secrets:set NETOPIA_PUBLIC_KEY  < live.public.cer
   firebase functions:secrets:set NETOPIA_PRIVATE_KEY < live.private.key
   firebase functions:secrets:set NETOPIA_ENV              # 'live'
   ```
3. Redeploy: `firebase deploy --only functions`.
4. Switch the URLs in Netopia's panel from sandbox to live (same IPN +
   return URLs, just the POS mode toggles).
5. Do one real-card test transaction with a small amount, verify booking
   doc appears, then issue a refund from Netopia's panel.

---

## Step 6 — (pending) wire the customer pages

Currently `/booking/long-term` and `/booking/credits` still use local
stubs that write Firestore directly. To route them through Netopia the
pages need to:

1. `POST` to the function's `createPayment` URL with the booking data.
2. Receive `{ action, env_key, data, cipher, iv, orderId }`.
3. Build a hidden form and auto-submit it to `action`:

```js
const resp = await fetch(FUNCTIONS_BASE + '/createPayment', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    orderType: 'longTerm',
    startDate, endDate, days, totalPrice,
    customerData: { customerId, licensePlate, name, email, phone },
  }),
});
const { action, env_key, data, cipher, iv, orderId } = await resp.json();

const form = document.createElement('form');
form.method = 'POST';
form.action = action;
[['env_key', env_key], ['data', data], ['cipher', cipher], ['iv', iv]]
  .forEach(([name, value]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  });
document.body.appendChild(form);
form.submit();
```

A new `/booking/return` page reads `?orderId` from the query, subscribes
to `pendingOrders/{orderId}`, and shows "Payment processing…" until
`status === 'paid'`, then shows the confirmation.

Ask Claude to do this commit once sandbox works end-to-end.

---

## Common errors

| Symptom                                | Cause                                 | Fix                                              |
|----------------------------------------|---------------------------------------|--------------------------------------------------|
| `decrypt failed` in function logs      | Wrong private key for the POS         | Re-upload the matching `.key` file               |
| Browser shows "signature mismatch" on Netopia page | Wrong `NETOPIA_SIGNATURE` string | Copy signature from Netopia panel exactly        |
| IPN never arrives                      | `netopiaCallback` URL wrong in panel  | Fix URL; Netopia does retry for ~3 days          |
| `pendingOrders.status === 'failed'`    | Card declined / user cancelled        | Normal; customer retries                         |
| 403 on function URL                    | Function not deployed / wrong region  | `firebase deploy --only functions`, check region `europe-west1` |
| `Permission denied` creating booking   | Firestore rules too strict            | IPN function runs with admin SDK, bypasses rules — shouldn't happen; check logs |

---

## Useful commands

```bash
# Watch function logs in real time
firebase functions:log

# Tail only the netopiaCallback logs
firebase functions:log --only netopiaCallback

# List all secrets bound
firebase functions:secrets:access NETOPIA_ENV
firebase functions:secrets:destroy NETOPIA_ENV        # if rotating

# Redeploy only one function (faster)
firebase deploy --only functions:netopiaCallback
```

---

## Reference

- Netopia sample repo (the one this function ports):
  https://github.com/mobilpay/Node.js
- Netopia Node.js docs:
  https://doc.netopia-payments.com/docs/payment-sdks/nodejs
- Function source: `functions/src/index.js`
- Crypto helpers: `functions/src/netopia.js`
