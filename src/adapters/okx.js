/**
 * OKX data adapter — the ONE module through which every exchange call goes.
 *
 * Two modes, selected by env var OKX_MODE (default "mock"):
 *
 *   mock  — fully working. Returns a realistic, internally consistent snapshot
 *           (position notional = size x mark price, uPnL = (mark - entry) x size
 *           x direction, margin = entry notional / leverage, every asset has a
 *           price, every perp has a funding rate). Contains deliberate findings
 *           for the audit to surface: heavy BTC concentration, a SOL perp
 *           bleeding funding, idle stablecoins that could be earning.
 *
 *   real  — clearly marked stubs. Each method throws OkxRealModeNotWiredError
 *           and documents the EXACT `okx` CLI command (from okx/agent-skills,
 *           npm package @okx_ai/okx-trade-cli — binary name `okx`) and the
 *           underlying OKX v5 REST endpoint it will call once a read-only API
 *           key is configured. See STATUS.md for the wiring checklist.
 *
 * Snapshot shape returned by getSnapshot(nowMs):
 * {
 *   meta:         { mode, accountLabel, asOf },
 *   balances:     [{ ccy, total, available, inEarn }],          // spot + funding assets
 *   positions:    [{ instId, sizeCcy, side, size, entryPx, lever,
 *                    markPx, notionalUsd, uplUsd, marginUsd }], // open perpetual swaps
 *   openOrders:   [{ instId, side, ordType, px, sz, cTime }],   // pending limit orders
 *   prices:       { CCY: usdPrice },                            // spot marks, USD(T)
 *   fundingRates: { INSTID: ratePer8h },                        // decimal, per 8h period
 *   earnRates:    { CCY: { apy, product, isStable } },          // best available Earn APY
 *   marketStats:  { betas: { CCY: betaToBtc }, vol30d: { CCY: annualizedVol } }
 * }
 *
 * Notes on the model:
 * - `balances` are spot/funding holdings. Perp collateral is NOT double counted
 *   there; it lives on each position as `marginUsd`. Total account equity =
 *   sum(balances value) + sum(marginUsd) + sum(uplUsd).
 * - Funding sign convention: rate > 0 means longs pay shorts (OKX standard).
 */

import crypto from 'node:crypto';
import { round } from '../util/format.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// OKX v5 REST. Account endpoints are signed with the CUSTOMER's read-only key
// (supplied per request — never stored); market endpoints are public (no auth).
const OKX_BASE = process.env.OKX_API_BASE_URL || 'https://www.okx.com';
const OKX_HTTP_TIMEOUT_MS = Number(process.env.OKX_HTTP_TIMEOUT_MS || 8000);
const baseCcy = (instId) => instId.split('-')[0];

async function okxFetch(path, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), OKX_HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(`${OKX_BASE}${path}`, { signal: ctrl.signal, headers });
    const json = await res.json();
    if (String(json.code) !== '0') {
      throw new Error(`OKX API ${json.code}: ${json.msg} (${path.split('?')[0]})`);
    }
    return json.data;
  } finally {
    clearTimeout(t);
  }
}

const publicGet = (path) => okxFetch(path, { 'User-Agent': 'portfolio-doctor' });

// Signed GET for authenticated account endpoints (read-only key).
function signedGet(path, creds) {
  const ts = new Date().toISOString();
  const sign = crypto
    .createHmac('sha256', creds.secret)
    .update(ts + 'GET' + path)
    .digest('base64');
  return okxFetch(path, {
    'OK-ACCESS-KEY': creds.key,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': ts,
    'OK-ACCESS-PASSPHRASE': creds.passphrase,
    'Content-Type': 'application/json',
    'User-Agent': 'portfolio-doctor',
  });
}

export class OkxRealModeNotWiredError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OkxRealModeNotWiredError';
  }
}

export function getConfiguredMode(env = process.env) {
  return (env.OKX_MODE ?? 'mock').toLowerCase();
}

/* ------------------------------------------------------------------------ *
 *  MOCK DATA
 *  Primitives only — everything derivable (notional, uPnL, margin) is
 *  computed in buildMockSnapshot() so consistency holds by construction.
 * ------------------------------------------------------------------------ */

// Spot mark prices in USD(T).
const MOCK_PRICES = {
  BTC: 104500,
  ETH: 3850,
  SOL: 172.4,
  OKB: 52.3,
  USDT: 1.0,
  USDC: 0.9998,
  DOGE: 0.118,
  ARB: 0.61,
  PEPE: 0.0000092,
};

// Spot/funding holdings. Deliberate findings baked in:
//  - BTC alone is ~69% of spot value (heavy concentration)
//  - 12,400 USDT + 1,850 USDC idle at 0% (inEarn: 0 across the board)
//  - ARB and PEPE are sub-$150 dust
const MOCK_BALANCES = [
  { ccy: 'BTC', total: 0.85, available: 0.85, inEarn: 0 },
  { ccy: 'ETH', total: 4.2, available: 4.2, inEarn: 0 },
  { ccy: 'SOL', total: 38, available: 38, inEarn: 0 },
  { ccy: 'OKB', total: 25, available: 25, inEarn: 0 },
  { ccy: 'USDT', total: 12400, available: 12400, inEarn: 0 },
  { ccy: 'USDC', total: 1850, available: 1850, inEarn: 0 },
  { ccy: 'DOGE', total: 5200, available: 5200, inEarn: 0 },
  { ccy: 'ARB', total: 240, available: 240, inEarn: 0 },
  { ccy: 'PEPE', total: 12_000_000, available: 12_000_000, inEarn: 0 },
];

// Open perpetual swap positions (primitives; derived fields computed below).
// Deliberate finding: the SOL long pays 0.0385%/8h funding — a meaningful bleed.
const MOCK_POSITION_PRIMITIVES = [
  { instId: 'SOL-USDT-SWAP', sizeCcy: 'SOL', side: 'long', size: 120, entryPx: 158.2, lever: 3 },
  { instId: 'BTC-USDT-SWAP', sizeCcy: 'BTC', side: 'short', size: 0.15, entryPx: 101900, lever: 5 },
  { instId: 'ETH-USDT-SWAP', sizeCcy: 'ETH', side: 'long', size: 2.0, entryPx: 3720, lever: 2 },
];

// Current funding rates, decimal per 8h period. Positive = longs pay shorts.
//  SOL +0.0385%/8h  -> 42.2% APR paid by longs (elevated — the bleed)
//  BTC +0.0112%/8h  -> our SHORT actually collects this
//  ETH +0.0248%/8h  -> longs pay, moderate bleed
const MOCK_FUNDING_RATES = {
  'SOL-USDT-SWAP': 0.000385,
  'BTC-USDT-SWAP': 0.000112,
  'ETH-USDT-SWAP': 0.000248,
};

// Best currently-available Earn APY per currency (Simple Earn flexible for
// stables/OKB, on-chain staking for ETH/SOL). BTC omitted deliberately: its
// 0.8% flexible rate is below the 1% floor the analysis considers meaningful.
const MOCK_EARN_RATES = {
  USDT: { apy: 0.078, product: 'Simple Earn — Flexible', isStable: true },
  USDC: { apy: 0.069, product: 'Simple Earn — Flexible', isStable: true },
  ETH: { apy: 0.031, product: 'On-chain Earn — ETH staking', isStable: false },
  SOL: { apy: 0.065, product: 'On-chain Earn — SOL staking', isStable: false },
  OKB: { apy: 0.012, product: 'Simple Earn — Flexible', isStable: false },
};

// 30-day beta to BTC and annualized volatility per asset. In real mode these
// are computed from daily candles (see realAdapter docs + computeBetaFromCloses
// in src/analysis/drawdown.js); in mock mode we supply plausible values.
const MOCK_MARKET_STATS = {
  betas: {
    BTC: 1.0,
    ETH: 1.15,
    SOL: 1.35,
    OKB: 0.85,
    USDT: 0.0,
    USDC: 0.0,
    DOGE: 1.45,
    ARB: 1.5,
    PEPE: 1.8,
  },
  vol30d: {
    BTC: 0.42,
    ETH: 0.55,
    SOL: 0.71,
    OKB: 0.48,
    USDT: 0.002,
    USDC: 0.003,
    DOGE: 0.88,
    ARB: 0.95,
    PEPE: 1.4,
  },
};

// Pending limit orders, cTime as "days ago" offsets from `now`.
// Deliberate finding: the BTC bid is 12% below mark and 21 days old (stale).
const MOCK_OPEN_ORDER_PRIMITIVES = [
  { instId: 'BTC-USDT', side: 'buy', ordType: 'limit', px: 92000, sz: 0.05, ageDays: 21 },
  { instId: 'SOL-USDT', side: 'sell', ordType: 'limit', px: 195, sz: 20, ageDays: 3 },
  { instId: 'ETH-USDT', side: 'buy', ordType: 'limit', px: 3690, sz: 1.0, ageDays: 2 },
];

export function buildMockSnapshot(nowMs = Date.now()) {
  const positions = MOCK_POSITION_PRIMITIVES.map((p) => {
    const markPx = MOCK_PRICES[p.sizeCcy];
    const dir = p.side === 'long' ? 1 : -1;
    return {
      ...p,
      markPx,
      notionalUsd: round(p.size * markPx),
      uplUsd: round((markPx - p.entryPx) * p.size * dir),
      marginUsd: round((p.size * p.entryPx) / p.lever),
    };
  });

  const openOrders = MOCK_OPEN_ORDER_PRIMITIVES.map(({ ageDays, ...o }) => ({
    ...o,
    cTime: nowMs - ageDays * DAY_MS,
  }));

  return {
    meta: {
      mode: 'mock',
      accountLabel: 'OKX unified account •••• (demo data)',
      asOf: new Date(nowMs).toISOString(),
    },
    balances: MOCK_BALANCES.map((b) => ({ ...b })),
    positions,
    openOrders,
    prices: { ...MOCK_PRICES },
    fundingRates: { ...MOCK_FUNDING_RATES },
    earnRates: structuredClone(MOCK_EARN_RATES),
    marketStats: structuredClone(MOCK_MARKET_STATS),
  };
}

/* ------------------------------------------------------------------------ *
 *  MOCK ADAPTER
 * ------------------------------------------------------------------------ */

const mockAdapter = {
  mode: 'mock',
  async getBalances(nowMs) {
    return buildMockSnapshot(nowMs).balances;
  },
  async getPositions(nowMs) {
    return buildMockSnapshot(nowMs).positions;
  },
  async getOpenOrders(nowMs) {
    return buildMockSnapshot(nowMs).openOrders;
  },
  async getPrices() {
    return { ...MOCK_PRICES };
  },
  async getFundingRates() {
    return { ...MOCK_FUNDING_RATES };
  },
  async getEarnRates() {
    return structuredClone(MOCK_EARN_RATES);
  },
  async getMarketStats() {
    return structuredClone(MOCK_MARKET_STATS);
  },
  async getSnapshot(nowMs) {
    return buildMockSnapshot(nowMs);
  },
};

/* ------------------------------------------------------------------------ *
 *  REAL ADAPTER — STUBS (no credentials exist yet)
 *
 *  Wiring plan (documented per method below). All CLI calls go through the
 *  `okx` binary from `npm i -g @okx_ai/okx-trade-cli` (okx/agent-skills).
 *  Auth first:
 *    okx config init            # read-only API key wizard (AK/SK/passphrase)
 *    # or OAuth: okx auth login --manual --site global
 *  Verify:  okx config show --json  /  okx auth status --json
 *
 *  Every method is expected to shell out via a single helper:
 *    execFile('okx', [...args, '--json'])  ->  parse stdout JSON
 *  which keeps this file the only place process boundaries are crossed.
 * ------------------------------------------------------------------------ */

function notWired(method, lines) {
  return new OkxRealModeNotWiredError(
    [
      `okx adapter: OKX_MODE=real but real mode is not wired yet (${method}).`,
      'No API credentials exist. When wiring, this method will run:',
      ...lines.map((l) => `  ${l}`),
      'Run with OKX_MODE=mock (the default) for a fully working demo,',
      'or follow the "Real mode wiring" checklist in STATUS.md.',
    ].join('\n')
  );
}

/**
 * REAL adapter for a CUSTOMER-supplied read-only OKX key. Account data
 * (balances/positions/orders) is signed with their key; prices/funding are
 * public. Earn APYs and asset betas are market-wide (the mock constants) — not
 * account-specific, so they need no per-user call. Read-only: this never
 * places or cancels anything.
 */
function createRealAdapter(creds) {
  if (!creds?.key || !creds?.secret || !creds?.passphrase) {
    throw new OkxRealModeNotWiredError(
      'okx adapter: real mode needs a read-only OKX API key (key, secret, passphrase). ' +
        'Supply them in the audit request, or run in mock mode for the sample demo.'
    );
  }

  async function getPrices() {
    const tickers = await publicGet('/api/v5/market/tickers?instType=SPOT');
    const prices = { USDT: 1 };
    for (const t of tickers) {
      if (t.instId.endsWith('-USDT')) prices[baseCcy(t.instId)] = Number(t.last);
    }
    return prices;
  }

  async function getBalances() {
    const data = await signedGet('/api/v5/account/balance', creds);
    const details = data?.[0]?.details ?? [];
    return details
      .map((d) => ({
        ccy: d.ccy,
        total: Number(d.cashBal || d.eq || 0),
        available: Number(d.availBal || d.availEq || d.cashBal || 0),
        inEarn: 0,
      }))
      .filter((b) => b.total > 0);
  }

  async function getPositions() {
    const rows = await signedGet('/api/v5/account/positions?instType=SWAP', creds);
    return (rows ?? [])
      .filter((p) => Number(p.pos) !== 0)
      .map((p) => {
        const size = Math.abs(Number(p.pos));
        const side = p.posSide === 'net' ? (Number(p.pos) >= 0 ? 'long' : 'short') : p.posSide;
        return {
          instId: p.instId,
          sizeCcy: baseCcy(p.instId),
          side,
          size,
          entryPx: Number(p.avgPx),
          lever: Number(p.lever),
          markPx: Number(p.markPx),
          notionalUsd: round(Number(p.notionalUsd)),
          uplUsd: round(Number(p.upl)),
          marginUsd: round(Number(p.margin || p.imr || 0)),
        };
      });
  }

  async function getOpenOrders() {
    const rows = await signedGet('/api/v5/trade/orders-pending', creds);
    return (rows ?? []).map((o) => ({
      instId: o.instId,
      side: o.side,
      ordType: o.ordType,
      px: Number(o.px),
      sz: Number(o.sz),
      cTime: Number(o.cTime),
    }));
  }

  async function getFundingRates(instIds = []) {
    const out = {};
    for (const instId of instIds) {
      try {
        const d = await publicGet(`/api/v5/public/funding-rate?instId=${encodeURIComponent(instId)}`);
        out[instId] = Number(d[0].fundingRate);
      } catch { /* skip a momentarily-unavailable funding rate */ }
    }
    return out;
  }

  // Market-wide (not account-specific) — reuse the curated constants.
  async function getEarnRates() {
    return structuredClone(MOCK_EARN_RATES);
  }
  async function getMarketStats() {
    return structuredClone(MOCK_MARKET_STATS);
  }

  async function getSnapshot(nowMs = Date.now()) {
    const [balances, positions, openOrders, prices] = await Promise.all([
      getBalances(),
      getPositions(),
      getOpenOrders(),
      getPrices(),
    ]);
    const fundingRates = await getFundingRates(positions.map((p) => p.instId));
    return {
      meta: {
        mode: 'real',
        accountLabel: `OKX account •••• (live, read-only key ${String(creds.key).slice(0, 4)}…)`,
        asOf: new Date(nowMs).toISOString(),
      },
      balances,
      positions,
      openOrders,
      prices,
      fundingRates,
      earnRates: structuredClone(MOCK_EARN_RATES),
      marketStats: structuredClone(MOCK_MARKET_STATS),
    };
  }

  return {
    mode: 'real',
    getBalances,
    getPositions,
    getOpenOrders,
    getPrices,
    getFundingRates,
    getEarnRates,
    getMarketStats,
    getSnapshot,
  };
}

/* ------------------------------------------------------------------------ */

/**
 * @param {string} mode 'mock' | 'real'
 * @param {{creds?: {key,secret,passphrase}}} [opts] real mode needs a read-only key
 */
export function createOkxAdapter(mode = getConfiguredMode(), opts = {}) {
  if (mode === 'mock') return mockAdapter;
  if (mode === 'real') return createRealAdapter(opts.creds);
  throw new Error(`Unknown OKX_MODE "${mode}" — expected "mock" or "real".`);
}
