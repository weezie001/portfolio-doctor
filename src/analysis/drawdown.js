/**
 * Drawdown-exposure analysis — portfolio beta to BTC plus a shock scenario.
 *
 * Model:
 *   equity      = spot value + perp margin + perp unrealized PnL
 *   betaDollars = sum(spot value_i x beta_i)
 *               + sum(direction_j x notional_j x beta_j)   (perps; shorts subtract)
 *   portfolioBeta = betaDollars / equity
 *
 * Shock scenario: if BTC moves shockPct (default -20%), the expected equity
 * change is portfolioBeta x shockPct x equity. We report the loss as a
 * positive dollar number.
 *
 * Gross leverage = (non-stable spot value + gross perp notional) / equity —
 * how much market exposure each dollar of equity is carrying.
 */

export const DRAWDOWN_LEVELS = [
  { max: 0.5, level: 'defensive' },
  { max: 0.85, level: 'moderate' },
  { max: 1.1, level: 'market-level' },
  { max: 1.35, level: 'elevated' },
  { max: Infinity, level: 'aggressive' },
];

export function analyzeDrawdown(
  { balances, positions, prices, betas },
  { shockPct = -0.2 } = {}
) {
  let spotValueUsd = 0;
  let spotBetaUsd = 0;
  let nonStableSpotUsd = 0;

  for (const b of balances) {
    const value = b.total * (prices[b.ccy] ?? 0);
    const beta = betas[b.ccy] ?? 1; // unknown assets treated as market-beta
    spotValueUsd += value;
    spotBetaUsd += value * beta;
    if (beta !== 0) nonStableSpotUsd += value;
  }

  let perpMarginUsd = 0;
  let perpUplUsd = 0;
  let perpBetaUsd = 0;
  let grossPerpNotionalUsd = 0;

  for (const p of positions) {
    const dir = p.side === 'long' ? 1 : -1;
    const beta = betas[p.sizeCcy] ?? 1;
    perpMarginUsd += p.marginUsd;
    perpUplUsd += p.uplUsd;
    perpBetaUsd += dir * p.notionalUsd * beta;
    grossPerpNotionalUsd += Math.abs(p.notionalUsd);
  }

  const equityUsd = spotValueUsd + perpMarginUsd + perpUplUsd;
  const betaDollarsUsd = spotBetaUsd + perpBetaUsd;
  const portfolioBeta = equityUsd > 0 ? betaDollarsUsd / equityUsd : 0;

  const shockLossUsd = -(portfolioBeta * shockPct * equityUsd); // positive = loss
  const equityAfterShockUsd = equityUsd - shockLossUsd;

  const grossExposureUsd = nonStableSpotUsd + grossPerpNotionalUsd;
  const grossLeverage = equityUsd > 0 ? grossExposureUsd / equityUsd : 0;

  const { level } = DRAWDOWN_LEVELS.find((l) => Math.abs(portfolioBeta) <= l.max);

  return {
    spotValueUsd,
    perpMarginUsd,
    perpUplUsd,
    equityUsd,
    grossPerpNotionalUsd,
    betaDollarsUsd,
    portfolioBeta,
    shockPct,
    shockLossUsd,
    equityAfterShockUsd,
    grossExposureUsd,
    grossLeverage,
    level,
  };
}

/**
 * Beta of an asset vs a benchmark from two aligned close-price series
 * (oldest -> newest, same length, length >= 3).
 *
 * beta = cov(assetReturns, benchReturns) / var(benchReturns)
 *
 * Used by the REAL adapter path: feed 31 daily closes from
 * `okx market candles <ccy>-USDT --bar 1D --limit 31 --json` (and BTC-USDT as
 * the benchmark) to get the 30-day beta.
 */
export function computeBetaFromCloses(assetCloses, benchCloses) {
  if (assetCloses.length !== benchCloses.length) {
    throw new Error('computeBetaFromCloses: series must be the same length');
  }
  if (assetCloses.length < 3) {
    throw new Error('computeBetaFromCloses: need at least 3 closes (2 returns)');
  }
  const returns = (xs) => xs.slice(1).map((x, i) => x / xs[i] - 1);
  const a = returns(assetCloses);
  const b = returns(benchCloses);
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(a);
  const mb = mean(b);
  let cov = 0;
  let varB = 0;
  for (let i = 0; i < a.length; i++) {
    cov += (a[i] - ma) * (b[i] - mb);
    varB += (b[i] - mb) ** 2;
  }
  if (varB === 0) return 0;
  return cov / varB;
}
