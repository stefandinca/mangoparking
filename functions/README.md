# Mango Parking Functions

Cloud Functions (Gen 2, Node 20, `europe-west1`) bridging Netopia Mobilpay
v2 payments to Firestore. The two endpoints are `createPayment` and
`netopiaCallback`; the crypto helpers live in `src/netopia.js`.

## First-time setup

```bash
cd functions
npm install
```

Deploying requires the **Blaze** (pay-as-you-go) plan on the Firebase
project. Free tier still applies within the generous limits — expect
near-zero cost for MVP traffic.

## Secrets (required before deploy)

Five secrets, bound at runtime via `defineSecret()`. Set them via:

```bash
firebase functions:secrets:set NETOPIA_SIGNATURE      # string, e.g. ABCD-EFGH-...
firebase functions:secrets:set NETOPIA_PUBLIC_KEY < path/to/public.cer
firebase functions:secrets:set NETOPIA_PRIVATE_KEY < path/to/private.key
firebase functions:secrets:set NETOPIA_ENV            # 'sandbox' or 'live'
firebase functions:secrets:set NETOPIA_API_KEY        # reserved; paste anything for now
```

`NETOPIA_PUBLIC_KEY` and `NETOPIA_PRIVATE_KEY` are multi-line PEM strings —
pipe from the files Netopia gave you. Never commit them.

## Flow

```
Client (BookingLongTerm / BookingCredits)
   │
   ▼  POST /createPayment  { orderType, …, customerData }
Cloud Function: createPayment
   │  build XML
   │  encrypt with NETOPIA_PUBLIC_KEY  (AES-256-CBC + RSA-PKCS1)
   │  persist pendingOrders/{orderId}
   ▼
 { action, env_key, data, cipher, iv, orderId }
   │
Client builds a hidden POST form and submits it to `action`
   │
   ▼
Netopia hosted payment page  →  user enters card  →  pays
   │
   ├─► POST /netopiaCallback  (server-to-server IPN, encrypted)
   │     Function: decrypt with NETOPIA_PRIVATE_KEY,
   │                check action==='confirmed' + error_code==='0',
   │                credit tokens  OR  create bookings/{id},
   │                mark pendingOrders as paid,
   │                respond <crc>success</crc>.
   │
   └─► GET return_url  →  /booking/return?orderId=…
         Client shows "Payment processing…" and polls order status.
```

## Endpoints

| Function          | Trigger                 | Notes                                                        |
|-------------------|-------------------------|--------------------------------------------------------------|
| `createPayment`   | HTTPS POST (CORS on)    | Writes `pendingOrders/{orderId}`, returns encrypted envelope |
| `netopiaCallback` | HTTPS POST (server→srv) | Decrypts IPN, fulfils order, responds `<crc>success</crc>`   |

## Local emulation

```bash
npm run serve        # firebase emulators:start --only functions
```

Caveat: emulators can run without real secrets (uses empty strings), but
you can't hit Netopia sandbox without the real keys — test deploy to
Firebase instead.

## Deploy

```bash
cd functions && npm install && cd ..
firebase deploy --only functions
```

On first deploy Firebase prompts to enable the required APIs (Cloud Build,
Cloud Run). Answer yes.

## Test plan (sandbox)

1. Set `NETOPIA_ENV=sandbox` and the sandbox signature + key pair Netopia
   gave you.
2. In the Netopia admin panel, configure the IPN / confirm URL to the
   deployed callback URL:
   `https://europe-west1-<project>.cloudfunctions.net/netopiaCallback`
   and the return URL to `https://<your-domain>/booking/return`.
3. Deploy (`firebase deploy --only functions`).
4. From `/booking/long-term` in the dev site, submit a booking → should
   POST to the function → redirect to Netopia sandbox.
5. Use Netopia's test card, complete the payment.
6. Verify:
   - `pendingOrders/{orderId}.status === 'paid'`
   - a `bookings/{id}` doc exists with `paymentId === orderId`
   - server logs show `<crc>success</crc>` response

## Client wiring (TODO)

`src/pages/public/BookingLongTerm.js` and `BookingCredits.js` currently
use local stubs (direct Firestore writes via `createLongTermBooking` /
`purchaseTokens`). To switch them to Netopia:

```js
const resp = await fetch(FUNCTIONS_BASE + '/createPayment', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ orderType: 'longTerm', ... }),
});
const { action, env_key, data, cipher, iv, orderId } = await resp.json();

// Build a hidden form and submit it
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

Plus a new `/booking/return` page that reads `?orderId` and polls
`pendingOrders/{orderId}` for `status === 'paid'`.

I'll wire this once you've confirmed the function works against sandbox.
