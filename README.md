# Portfolio Doctor

**Paid one-shot portfolio audit.** User connects a read-only OKX API key, pays a few dollars, and gets back a clean report: concentration risk, perp funding that's bleeding them, idle assets that could be earning, and 3 concrete fixes.

## Target: Revenue Rocket (+ Finance Copilot side category)

Cheap, high-volume, zero-trust-required (read-only keys). Every audit is a logged, paid, completed job on the marketplace — exactly what "real usage" means during the judging window.

## Revenue model

- $2–5 per audit (impulse-buy pricing, volume play)
- Upsell: weekly re-audit subscription

## How it works

```
User (read-only API key)
        │
        ▼
┌─ Ingest ────────────────┐   okx-trade-cli: portfolio skill
│ balances, positions,    │   (balances, positions, P&L)
│ open orders, funding    │   + market-data skill (prices,
└──────────┬──────────────┘   funding rates, candles)
           ▼
┌─ Analysis engine ───────┐
│ • concentration score   │
│ • perp funding bleed    │
│ • idle assets vs earn   │   earn skill (staking/lending APYs)
│ • drawdown exposure     │
└──────────┬──────────────┘
           ▼
┌─ Report renderer ───────┐
│ HTML → PDF, scored 0-100│
│ + top 3 fixes           │
└─────────────────────────┘
```

## Stack

- Plain Node.js (ESM, zero runtime deps — no build step)
- `okx/agent-skills` (`okx` CLI from `@okx_ai/okx-trade-cli`: portfolio, market-data, earn) — behind `src/adapters/okx.js`
- Self-contained styled HTML report (dark theme, print-to-PDF friendly — no puppeteer)
- Claude for the narrative section ("what this means, what to do") — behind `src/adapters/llm.js`
- Web layer on `node:http` (landing page + demo audit flow + JSON service API) — still zero deps, fully offline

Every external call goes through the two adapter modules. `OKX_MODE=mock` (default) runs fully offline on realistic, internally consistent demo data; `OKX_MODE=real` is stubbed until read-only API keys exist — each stub documents the exact `okx` CLI command it will run. See [STATUS.md](STATUS.md).

## Run it

```
npm run audit          # writes out/report-<timestamp>.html + prints a summary
npm run serve          # web UI + service API on http://localhost:4101 (PORT overrides)
npm test               # 28 unit + integration tests (node:test, no deps)
```

## Web UI + service API

`npm run serve` starts a zero-dependency `node:http` server (port `4101`, `PORT` env to override) with a clinical "lab report" look — light paper theme, teal accent, serif display headings, everything inline (system fonts, inline SVG wordmark + favicon), so it works fully offline.

| Route | What it does |
|---|---|
| `GET /` | Landing page: what the audit screens for, how it works (3 steps), pricing ($3/audit placeholder), demo-mode badge |
| `GET /audit` | Audit form. API-key fields are present but **disabled** ("Demo mode — sample portfolio") |
| `POST /api/audit` | Runs the audit engine in-process (mock mode) and returns `{score, grade, headline, fixes, reportUrl}` — the future pay-per-call service endpoint (contract in [STATUS.md](STATUS.md)) |
| `GET /reports/<file>` | Serves the generated reports from `out/` |
| `GET /api/health` | Liveness: `{ok:true}` |

The audit page shows a result summary card (score gauge strip, lab-style findings rows with H/OK flags, ranked fixes) linking to the full report. Every page clearly badges demo/mock mode.

## Build plan

- [ ] Phase 1 — Exchange wiring: install agent-skills, read-only key flow, pull balances/positions/funding for a test account
  - [x] Ingest layer behind one adapter (`src/adapters/okx.js`): balances (9 assets incl. dust + idle stables), 3 perp positions, open orders, prices, funding rates, earn APYs — mock mode fully working, snapshot shape final
  - [x] Real-mode stubs documenting the exact `okx` CLI call per data source (`balance-all`, `positions`, `spot/swap orders`, `tickers`, `funding-rate`, `earn savings rate-history`, `candles`)
  - [ ] Create read-only OKX API key, install `@okx_ai/okx-trade-cli`, wire the stubs (checklist in STATUS.md)
- [x] Phase 2 — Analysis: concentration score (HHI), funding-bleed $/day/$/month, idle-asset vs earn-APY $/yr, drawdown exposure (beta to BTC + shock scenario), 0–100 health score with transparent breakdown, ranked top-3 fixes — pure functions, unit-tested
- [x] Phase 3 — Report: self-contained HTML (inline CSS + SVG gauge, dark theme, light print stylesheet = PDF export via browser print), findings sections with computed numbers, top-3-fixes with $ impact, timestamp + not-financial-advice disclaimer
- [ ] Phase 4 — Marketplace: package as ASP, define service + pricing, submit for OKX.AI listing
  - [x] Web layer: landing page + demo audit flow + `POST /api/audit` service endpoint (`node:http`, zero deps) — the endpoint the paid service will expose
  - [ ] Payment gate on `/api/audit` + listing
- [ ] Phase 5 — Demo: 90s video — connect key → run audit → flip through report
- [ ] Submit Google form (after listing, before Jul 17 00:00 UTC)
- [ ] Post demo on X with #okxai

## Demo script (≤90s)

1. (0–15s) The problem: "You're holding 9 coins and paying funding on 3 perps. Do you know what it's costing you?"
2. (15–60s) Connect read-only key → audit runs → report appears
3. (60–90s) Flip through: health score, the funding bleed number, the 3 fixes. "Read-only. $3. 60 seconds."
