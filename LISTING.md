# OKX.AI Listing Manifest — Portfolio Doctor

The submission record for listing this agent on OKX.AI. Listing is an **on-chain
identity + service registration on X Layer** via the Onchain OS CLI — not a web
form. Fill the two `REPLACE_*` placeholders, then run the command sequence below.

## Canonical manifest

```json
{
  "role": "asp",
  "identity": {
    "name": "Portfolio Doctor",
    "description": "Portfolio Doctor runs a one-shot health check on your crypto portfolio. It scores concentration risk, perpetual-funding drain, idle-capital yield gaps and drawdown exposure, then returns a ranked set of fixes with dollar impact — a clear, clinical report in under a minute. Strictly read-only: it never trades or moves your funds.",
    "avatar_file": "./brand/avatar.png",
    "preferred_language": "en"
  },
  "services": [
    {
      "name": "Crypto Portfolio Audit",
      "description": "Delivers a scored 0-100 portfolio audit: concentration (HHI), perp funding bleed in $/day, idle-cash yield gaps and a -20% shock test, plus your top 3 fixes ranked by dollar impact, as a shareable HTML report. You supply: a read-only OKX API key (balances, positions, funding) — no trade or withdraw permission needed.",
      "type": "A2MCP",
      "fee": "3",
      "fee_currency": "USDT",
      "endpoint": "https://REPLACE_WITH_YOUR_DEPLOY_HOST/api/audit"
    }
  ]
}
```

- **`REPLACE_WITH_YOUR_DEPLOY_HOST`** → your deployed domain. The local route is
  `POST /api/audit` (see [STATUS.md](STATUS.md)); it must be a public `https://`
  URL (localhost/private IP is rejected and the endpoint is permanent on-chain).
- **`avatar.png`** → required uploaded image (a link is rejected). Clinical
  lab-report identity: teal cross / pulse motif on white. Put it at `brand/avatar.png`.
- **fee** `"3"` = 3 USDT per audit (impulse pricing, volume play). Adjust freely;
  digits only, ≤6 decimals, currency is USDT.

## Registration command sequence

```bash
# 0. Wallet session (TEE) — identities live on X Layer only, never pass --chain
onchainos wallet status --format json
onchainos wallet login <your-email>        # then: onchainos wallet verify <code>

# 1. Consent / eligibility (one ASP identity per wallet)
onchainos agent pre-check --role asp

# 2. Upload the avatar, capture the returned URL for --picture
onchainos agent upload --file ./brand/avatar.png

# 3. Automated listing QA — fix any findings before create
onchainos agent validate-listing --role asp \
  --name "Portfolio Doctor" \
  --description "Portfolio Doctor runs a one-shot health check on your crypto portfolio. It scores concentration risk, perpetual-funding drain, idle-capital yield gaps and drawdown exposure, then returns a ranked set of fixes with dollar impact — a clear, clinical report in under a minute. Strictly read-only: it never trades or moves your funds." \
  --service '[{"name":"Crypto Portfolio Audit","description":"Delivers a scored 0-100 portfolio audit: concentration (HHI), perp funding bleed in $/day, idle-cash yield gaps and a -20% shock test, plus your top 3 fixes ranked by dollar impact, as a shareable HTML report. You supply: a read-only OKX API key (balances, positions, funding) — no trade or withdraw permission needed.","type":"A2MCP","fee":"3","endpoint":"https://REPLACE_WITH_YOUR_DEPLOY_HOST/api/audit"}]'

# 4. Create the on-chain identity → returns newAgentId
onchainos agent create --role asp \
  --name "Portfolio Doctor" \
  --description "<same description as above>" \
  --picture "<url from step 2>" \
  --service '<same --service JSON as above>'

# 5. Activate → submits for review / publishes
onchainos agent activate --agent-id <newAgentId> --preferred-language en
```

On-chain fees are covered by OKX (X Layer is gas-free). Settlement is in USDT.

## Owner values — REGISTERED (Jul 3, 2026)

| Field | Value |
|---|---|
| **Agent ID** | **3616** (X Layer, chain 196) |
| Registration tx | `0x8c787af7b6890efc82df74002a52d19ba053d37abb3739e475bc42ac1124df4b` |
| Status | **submitted for review** (`approvalStatus: 2`); result → owner email within ~2 business days; usable via Agent ID meanwhile |
| Owner email / wallet login | enangweezie@gmail.com |
| Payout wallet (X Layer, `X402_PAY_TO`) | `0x2753e335de0db21d26d0e485e77129fa437c1030` |
| Avatar (uploaded) | `https://static.okx.com/cdn/web3/wallet/marketplace/headimages/agent/avatar/c2c66a69-5b98-4263-9348-a8d527b47aff.png` |
| Endpoint (on-chain, permanent) | `https://portfolio-doctor-production-fda0.up.railway.app/api/audit` — passes `agent x402-check` (`valid: true`) |
| Service | Crypto Portfolio Audit, A2MCP, 3 USDT/call |

**Schema notes learned during registration (apply to all future listings):**
- `--service` keys are camelCase: `serviceName`, `serviceDescription`, `serviceType`, `fee`, `endpoint`
- `serviceDescription` must be TWO lines: capability summary `\n` what-the-user-supplies
- `PAYMENT-REQUIRED` header must contain the full challenge `{x402Version, resource, accepts:[…]}`; server accepts `PAYMENT-SIGNATURE` (v2) + legacy `X-PAYMENT`
- Avatar must be uploaded via `agent upload` first; the returned CDN URL is the only valid `--picture` value

## Owner checklist

- [x] x402 pay-per-call layer built on `POST /api/audit` (3 USDT = `3000000` atomic units, X Layer USDT) — mock mode verified end-to-end (`npm run x402-demo`); ships `X402_MODE=off` by default
- [ ] Turn payments on for real: set `X402_MODE=real`, `X402_PAY_TO=<owner wallet>`, and OKX facilitator creds (`OKX_X402_API_KEY/SECRET/PASSPHRASE`); confirm the assumed HMAC auth header names on the OKX dev portal (see STATUS.md "x402 payment layer")
- [ ] Deploy the service; set the real `https://` endpoint (replace the placeholder)
- [x] Create `brand/avatar.png` — done (1024×1024, teal clinical cross + ECG pulse; editable source at `brand/avatar.svg`)
- [ ] Register hackathon + OKX Onchain OS dev-portal creds (`.env`)
- [ ] Run steps 0-5 above; record `newAgentId`
- [ ] Confirm activation status (submitApproval → under review)
- [ ] Submit the hackathon Google form before **Jul 17 00:00 UTC**
- [ ] Post the ≤90s demo on X with **#okxai**
