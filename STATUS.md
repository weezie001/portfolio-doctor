# STATUS — Portfolio Doctor

_Last updated: 2026-07-03. Phases 1–3 of the README build plan are code-complete in mock mode, plus a web UI + JSON service API and an x402 pay-per-call payment layer (mock-verified); real-mode wiring is stubbed and documented below._

## How to run

```bash
cd portfolio-doctor
npm run audit        # = node src/index.js audit  -> writes out/report-<timestamp>.html
npm run serve        # = node src/server.js       -> web UI + API on http://localhost:4101 (PORT overrides)
npm test             # = node --test              -> 38 tests, all passing
npm run x402-demo    # = node scripts/x402-demo.js -> full 402->pay->receipt handshake in mock mode
node src/index.js audit --out some/dir           # custom output dir (relative to project root)
```

No `npm install` needed — zero runtime dependencies, plain Node ESM (Node >= 18; developed on Node 24).

Open the report in any browser; use the browser's Print → Save as PDF for a PDF copy (the report ships a light print stylesheet).

## What works today (verified end-to-end)

- `npm run audit` runs the full pipeline in mock mode: ingest → analysis → narrative → HTML report, in ~150 ms.
- Demo output on the current mock book: health **52/100 (At Risk)**, equity **$142,653**, BTC **69.4%** of spot (heavily concentrated), net funding **−$24.36/day**, idle yield **$2,038/yr**, beta to BTC **0.98**, −20% BTC shock ≈ **−$27,959**. Top fixes: SOL-USDT-SWAP funding bleed (**$8,722/yr**), trim BTC to 50% (**$4,968 per −20% event**), idle balances → Earn (**$2,038/yr**).
- Report is one self-contained HTML file: inline CSS, inline SVG score gauge, no external requests (test-enforced), mock-data banner, generated timestamp, not-financial-advice disclaimer.
- `npm run serve`: web server on `node:http` (still zero deps, still fully offline — inline CSS/SVG, system fonts). Landing page (`/`), audit form with disabled API-key fields and a demo-mode notice (`/audit`), demo audit API (`POST /api/audit` → JSON summary + `reportUrl`), report hosting (`GET /reports/<file>` from `out/`), liveness (`GET /api/health`). Verified end-to-end: pages return 200, a POSTed audit generates a real report reachable at its `reportUrl`. Light "clinical lab report" theme, mobile-responsive, every page badges demo mode.
- `npm test`: 38 passing tests — unit tests for every analyzer + health score, mock-consistency invariants (notional = size × mark, uPnL/margin formulas, every lookup resolves, deliberate findings present), an end-to-end smoke test on the written report, web-layer tests (routes, audit API contract, report hosting, path-traversal rejection), and x402 tests (off-mode passthrough, 402 challenge shape, atomic-amount math, mock payment round trip, bad-payment rejection, real-mode fail-fast).
- `npm run x402-demo`: spawns the server with `X402_MODE=mock` and walks the full pay-per-call handshake — 402 challenge → decode `PAYMENT-REQUIRED` → mock payment → 200 with `PAYMENT-RESPONSE` receipt + audit JSON. Verified end-to-end.

## What is mocked

| Piece | Mock behaviour | Where |
|---|---|---|
| Exchange data (balances, positions, orders, prices, funding, earn APYs, betas) | Realistic, internally consistent snapshot with deliberate findings: 69% BTC concentration, SOL perp paying 0.0385%/8h funding, $14.2k idle stables, one stale order, 2 dust positions | `src/adapters/okx.js` (`buildMockSnapshot`) |
| Narrative prose | Well-written canned templates that interpolate the real computed numbers and adapt tone to severity | `src/adapters/llm.js` (`mockNarrative`) |

Everything else — the analysis engine, scoring, fix ranking, report renderer, CLI — is real code that will run unchanged against live data.

Mode selection: `OKX_MODE=mock|real` (default `mock`); `LLM_MODE` overrides for the narrative side and falls back to `OKX_MODE`. `OKX_MODE=real` currently throws a clear `...NotWiredError` naming the exact command each stub will run (the web server maps these to HTTP 501 with the same message).

## Web service API — `POST /api/audit` (the future pay-per-call endpoint)

This is the endpoint the paid service will expose: one call = one audit = one fee. It already runs the full engine in-process; only auth + payment are missing.

**Today (demo build):**

- `POST /api/audit` — no auth, no body required (any body ≤ 64 KB is accepted and ignored). Runs the mock-mode audit and writes a real report to `out/`.
- Response `200`:

```json
{
  "ok": true, "service": "portfolio-doctor", "mode": "mock", "demo": true,
  "score": 52, "grade": "At Risk",
  "scoreComponents": [{ "key": "concentration", "label": "Diversification", "earned": 4.7, "max": 25 }, "…"],
  "headline": {
    "equityUsd": 142653.4, "topHolding": { "ccy": "BTC", "weight": 0.694, "level": "heavily concentrated" },
    "netFundingUsdPerDay": -24.36, "netFundingUsdPerMonth": -730.7,
    "idleYieldUsdPerYear": 2038.15, "idleStablesUsd": 14249.63,
    "betaToBtc": 0.98, "betaLevel": "market-level", "btcShock20LossUsd": 27959.4
  },
  "formatted": { "equity": "$142,653", "topHolding": "BTC at 69.4% of spot", "…": "…" },
  "fixes": [{ "rank": 1, "title": "Stop the funding bleed on SOL-USDT-SWAP", "impactUsd": 8722, "impactPeriod": "/yr", "impact": "$8,722/yr" }, "…"],
  "reportUrl": "/reports/report-2026-07-02T18-21-24.html",
  "generatedAt": "2026-07-02T18:21:24.000Z", "elapsedMs": 119,
  "disclaimer": "Educational tooling, not financial advice."
}
```

- Errors: `405` (non-POST), `413` (body too large), `501` (`OKX_MODE=real` before wiring, with a hint), `500` (unexpected, `{ok:false, error}`).
- Companions: `GET /api/health` → `{ok:true}` liveness probe; `GET /reports/<file>` serves only whitelisted `report-*.html` names from `out/` (no path traversal).

**Planned (paid service):** the request body becomes `{ "apiKey", "apiSecret", "passphrase" }` — a **read-only** exchange key used for that single audit and never stored. The pay-per-call side is now BUILT: the x402 payment gate below meters this exact endpoint at 3 USDT/call (`X402_MODE=mock` verified end-to-end; `real` needs facilitator creds). Response shape stays exactly as above with `"mode": "real"`, `"demo": false`. Rate limiting still lands with README Phase 4.

## x402 payment layer (pay-per-call for `POST /api/audit`)

OKX.AI lists this service as A2MCP — "every API call triggers billing, settled instantly." The gate implements the x402 standard (HTTP 402 handshake) around the one listed route. UI pages, `/reports/*` and `/api/health` are never gated.

**Env vars:**

| Var | Values | Meaning |
|---|---|---|
| `X402_MODE` | `off` (default) / `mock` / `real` | `off` = gate disabled, every route behaves exactly as before this layer existed. `mock` = in-process facilitator (demo/tests, no network). `real` = OKX x402 facilitator over HTTPS. |
| `X402_PAY_TO` | wallet address | Receiving wallet in the challenge (default placeholder `0xREPLACE_OWNER_WALLET` — set before going live). |
| `X402_PRICE_USDT` | decimal string, ≤6 dp | Price per call, default `3` (= LISTING.md fee). Converted to atomic units exactly (3 → `3000000`, 6-decimal USDT). |
| `OKX_X402_API_KEY` / `OKX_X402_SECRET` / `OKX_X402_PASSPHRASE` | strings | Facilitator credentials, **real mode only**. Missing creds in real mode fail fast at server construction with a clear message. |
| `OKX_X402_FACILITATOR_URL` | URL | Override the facilitator base (default `https://web3.okx.com`). |

**Flow (mock and real):**

1. `POST /api/audit` with no `X-PAYMENT` header → `402` with header `PAYMENT-REQUIRED: <base64(JSON PaymentRequirements)>` and a small JSON body (`{ok:false, x402Version:1, error, accepts:[requirements]}`). Requirements: `scheme:"exact"`, `network:"eip155:196"` (X Layer), `maxAmountRequired:"3000000"` (3 USDT × 10⁶ atomic units), `asset:` USDT contract `0x779d…3736`, `resource:"/api/audit"`, `maxTimeoutSeconds:60`.
2. Client retries with `X-PAYMENT: <base64(JSON PaymentPayload)>` → server runs `facilitator.verify()` then `facilitator.settle()`; on success the normal audit handler runs and the `200` carries `PAYMENT-RESPONSE: <base64(JSON settle receipt)>` (`{success, transaction, network, payer, status}`).
3. Any verify/settle failure → `402` again with an `error` field explaining why (bad base64, scheme/network mismatch, insufficient amount, missing payer, facilitator error).

**Where:** `src/x402/gate.js` (challenge + handshake, pure of I/O) and `src/adapters/facilitator.js` (ALL verify/settle I/O — same adapter pattern as `okx.js`/`llm.js`). Demo client: `scripts/x402-demo.js` (`npm run x402-demo`).

**Confirmed vs assumed:**

- CONFIRMED (OKX web3 docs): facilitator base `https://web3.okx.com`, endpoints `POST /api/v6/pay/x402/verify` and `/settle`, request body `{paymentPayload, paymentRequirements}`.
- ASSUMED (pending OKX dev-portal confirmation): the auth header names in real mode. We implement OKX v5-style signing — `OK-ACCESS-KEY`, `OK-ACCESS-SIGN` = base64(HMAC-SHA256(timestamp+method+requestPath+body, secret)), `OK-ACCESS-TIMESTAMP`, `OK-ACCESS-PASSPHRASE` — flagged in a block comment in `facilitator.js`. Verify before go-live.
- Alternative to hand-rolled real mode: OKX's official SDK packages (`@okxweb3/x402-core`, `x402-express` middleware, `x402-evm`) — not used here because this project is deliberately zero-dependency, but a fine swap-in at deploy time.
- The mock facilitator checks payload shape, scheme/network match, and declared amount ≥ required; it does NOT verify an EIP-3009 signature (that is the real facilitator's job).

## Real mode wiring — exact steps

### A. OKX data (`src/adapters/okx.js`)

1. Install the CLI: `npm install -g @okx_ai/okx-trade-cli`, or local to the project — `npm install @okx_ai/okx-trade-cli` puts the binary at `./node_modules/.bin/okx` (v1.3.9). Smoke-test with the public surface first: `okx market ticker BTC-USDT --json` — market data needs **no auth** (rate limit 20 req / 2 s per IP), so it proves connectivity before any key exists.
2. Create a **read-only** API key on okx.com → `okx config init` (site → live/demo → AK/SK/passphrase), or OAuth via `okx auth login --manual --site global`. Verify: `okx config show --json` (authoritative for API keys) and `okx auth status --json` (authoritative for the OAuth session — its `apiKey` field is always `false`, ignore it). A configured API key always wins over an OAuth session; there is no fallback between them.
3. Add one helper in the adapter (single choke point): `execFile('okx', [...args, '--json'])` → parse stdout. Responses arrive in the OKX v5 envelope `{code, msg, data}` — treat `code !== "0"` as an error, map fields from `data`.
4. Replace each stub with its documented call and map fields to the snapshot shape:

| Adapter method | CLI call | Snapshot mapping |
|---|---|---|
| `getBalances` | `okx account balance-all --json` + `okx earn savings balance --json` | trading+funding `details[]` → `{ccy,total,available}`; savings amounts → `inEarn` |
| `getPositions` | `okx account positions --instType SWAP --json` | `instId, side/posSide, pos→size, avgPx→entryPx, upl→uplUsd, lever, margin→marginUsd`; `notionalUsd = size × markPx` |
| `getOpenOrders` | `okx spot orders --json` + `okx swap orders --json` | `instId, side, ordType, px, sz, cTime` |
| `getPrices` | `okx market tickers SPOT --json` | `last` per `<CCY>-USDT`, filtered to held ccys |
| `getFundingRates` | `okx market funding-rate <instId> --json` per open swap | `fundingRate` (decimal per 8h) |
| `getEarnRates` | `okx --profile live earn savings rate-history --ccy <ccy> --limit 1 --json` | use **`lendingRate`** as APY (not `rate`); staking APYs via okx-cex-earn on-chain commands |
| `getMarketStats` | `okx market candles <ccy>-USDT --bar 1D --limit 31 --json` (+ BTC-USDT benchmark) | feed closes into `computeBetaFromCloses()` (already implemented + tested in `src/analysis/drawdown.js`) |

REST equivalents (if bypassing the CLI): `GET /api/v5/account/balance`, `/api/v5/account/positions`, `/api/v5/trade/orders-pending`, `/api/v5/market/tickers`, `/api/v5/public/funding-rate`, `/api/v5/finance/savings/lending-rate-summary`, `/api/v5/market/candles`.

5. `OKX_MODE=real npm run audit` — the analysis/report layers need no changes.

Wiring notes:

- Earn commands are **live-only** (no demo profile); market data ignores auth entirely; account/earn calls need the key.
- The doctor is read-only by contract: never call write commands (`account transfer`, `earn savings purchase`/`redeem`, any order placement) from this codebase. Key permissions: Read — never Trade, never Withdraw.
- If the CLI throws `Failed to call OKX endpoint … check network connectivity`, suspect host DNS/proxy before auth: the CLI honors `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY`, `OKX_SITE`, and `OKX_API_BASE_URL` env vars plus a per-profile `proxy_url` in `~/.okx/config.toml`, and ships an `okx diagnose` command for exactly this. Surface the failure to the user — never silently fall back to mock data in real mode.

### B. Narrative (`src/adapters/llm.js`)

1. `npm i @anthropic-ai/sdk` and set `ANTHROPIC_API_KEY`.
2. Replace the stub body of `realLlmAdapter.generateNarrative` with the call spelled out in the file's block comment: `client.messages.create({ model: LLM_MODEL ?? 'claude-opus-4-8', max_tokens: 2048, system: NARRATIVE_SYSTEM_PROMPT, output_config: { format: { type: 'json_schema', schema: NARRATIVE_SCHEMA } }, messages: [{ role: 'user', content: JSON.stringify(buildFactsPayload(input)) }] })` → `JSON.parse` the text block.
3. The system prompt, JSON schema, and facts-payload builder are already exported and tested — only the API call is missing. Do not send `temperature`/`top_p` (rejected on current models).

## Architecture / file map

```
src/index.js                CLI (`audit` command, --out flag)
src/audit.js                orchestrator: ingest -> analyze -> narrate -> render -> write
src/server.js               web server (node:http): pages, POST /api/audit, report hosting
src/web/pages.js            landing + audit form HTML (light "lab report" theme, inline CSS/SVG)
src/x402/gate.js            x402 402-handshake gate for POST /api/audit (off|mock|real)
src/adapters/okx.js         ALL exchange I/O (mock working / real stubbed)
src/adapters/llm.js         ALL model I/O   (mock working / real stubbed)
src/adapters/facilitator.js ALL payment verify/settle I/O (mock working / real wired, creds pending)
scripts/x402-demo.js        pay-per-call demo client (npm run x402-demo)
src/analysis/*.js           pure functions: concentration (HHI), funding bleed,
                            idle-vs-earn, drawdown beta + shock, order hygiene,
                            health score (transparent 4x25 config), top-fixes ranking
src/report/render.js        self-contained HTML (dark theme, SVG gauge, print CSS)
src/util/format.js          en-US pinned number formatting
test/*.test.js              38 tests (node:test)
out/                        generated reports (gitignored)
```

## Known gaps / next steps

- Phase 1 real-key flow is the only unfinished item in phases 1–3 (blocked on credentials; wiring table above).
- The payment gate is built (x402 section above) but ships `X402_MODE=off` by default and mock-verified only: real settlement needs OKX facilitator creds + confirmation of the auth header names, plus a real `X402_PAY_TO` wallet. The form's API-key fields stay disabled until real data mode lands. Server binds plain HTTP for local/demo use — TLS/hosting is a deployment concern, not in this repo yet.
- Earn `inEarn` detection assumes Simple Earn savings; on-chain staking balances may need `okx-cex-earn` on-chain commands when wiring.
- Betas fall back to 1.0 for assets missing from `marketStats` (safe-ish default; real mode should compute all of them from candles).
- Phase 4 (ASP packaging/listing) and Phase 5 (demo video) not started — see README build plan.
