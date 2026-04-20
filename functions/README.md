# Mango Parking Functions

Cloud Functions (Gen 2, Node 20, europe-west1) bridging Netopia payments to Firestore.

## First-time setup

```bash
cd functions
npm install
```

Deploying requires the **Blaze** (pay-as-you-go) plan on the Firebase project. Free tier still applies within the generous limits — expect near-zero cost for MVP traffic.

## Secrets (required before deploy)

```bash
firebase functions:secrets:set NETOPIA_API_KEY
firebase functions:secrets:set NETOPIA_SIGNATURE
```

These bind to the functions at runtime; no values land in source.

## Local emulation

```bash
npm run serve       # firebase emulators:start --only functions
```

## Deploy

```bash
npm run deploy      # firebase deploy --only functions
```

## Endpoints

| Function          | Trigger                 | Purpose                                  |
|-------------------|-------------------------|------------------------------------------|
| `createPayment`   | HTTPS POST              | Create pending order + return Netopia redirect URL |
| `netopiaCallback` | HTTPS POST (server→srv) | Verify signature, credit tokens, mark order paid |

Both are stubbed — see `// TODO(netopia)` blocks in `src/index.js`. The token-credit logic (`creditTokens`) mirrors `src/services/tokenService.js` → `purchaseTokens` and runs in a Firestore transaction.

## Updating the client

Once deployed, update `src/pages/public/Booking.js` to call `createPayment` instead of the local stub, and redirect to the returned `redirectUrl`.
