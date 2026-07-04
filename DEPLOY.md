# Deploying Portfolio Doctor

Zero-dependency Node app — no build step. Any Node 18+ host works; Railway and
Render one-click from GitHub are the fastest paths.

## 1. Push to your GitHub

This folder is a standalone git repo. Create an empty repo on your GitHub
(e.g. `portfolio-doctor`), then:

```bash
git remote add origin https://github.com/<your-username>/portfolio-doctor.git
git push -u origin main
```

## 2. Create the service (Railway shown; Render is equivalent)

1. railway.app → New Project → **Deploy from GitHub repo** → pick `portfolio-doctor`
2. It auto-detects Node and uses `npm start` (already wired to `node src/server.js`)
3. The server reads `PORT` from the environment automatically — no config needed
4. Settings → **Networking → Generate Domain** → this is your public URL

## 3. Environment variables

| Variable | Value | When |
|---|---|---|
| `X402_MODE` | `mock` | now — endpoint demonstrates the full 402 handshake without creds |
| `X402_PAY_TO` | `0x2753e335de0db21d26d0e485e77129fa437c1030` | now — owner payout wallet (X Layer) |
| `OKX_X402_API_KEY` | from web3.okx.com/onchain-os/dev-portal | before charging real money |
| `OKX_X402_SECRET` | 〃 | 〃 |
| `OKX_X402_PASSPHRASE` | 〃 | 〃 |
| then set `X402_MODE` | `real` | 〃 |

## 4. Verify

```
https://<your-domain>/api/health   → {"ok":true,"service":"portfolio-doctor"}
https://<your-domain>/             → landing page
POST https://<your-domain>/api/audit  → 402 challenge (when X402_MODE≠off), paid flow per STATUS.md
```

## 5. Register the endpoint

Your on-chain service endpoint (permanent) is:

```
https://<your-domain>/api/audit
```

Use it in LISTING.md step 3–4. Uploaded avatar URL (on OKX CDN, via `agent upload`):
`https://static.okx.com/cdn/web3/wallet/marketplace/headimages/agent/avatar/c2c66a69-5b98-4263-9348-a8d527b47aff.png`
