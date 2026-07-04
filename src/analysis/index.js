/**
 * Analysis engine entry point: runs every analyzer over an adapter snapshot
 * and derives the ranked "Top fixes" list with expected dollar impact.
 * Everything here is pure — no I/O, no clocks unless injected.
 */

import { analyzeConcentration } from './concentration.js';
import { analyzeFunding } from './funding.js';
import { analyzeIdle } from './idle.js';
import { analyzeDrawdown } from './drawdown.js';
import { analyzeOrders } from './orders.js';
import { healthScore } from './health.js';
import { fmtUsd, fmtPct, fmtAmount } from '../util/format.js';

export { analyzeConcentration } from './concentration.js';
export { analyzeFunding } from './funding.js';
export { analyzeIdle } from './idle.js';
export { analyzeDrawdown, computeBetaFromCloses } from './drawdown.js';
export { analyzeOrders } from './orders.js';
export { healthScore, HEALTH_CONFIG, HEALTH_BANDS } from './health.js';

export function analyzePortfolio(snapshot, opts = {}) {
  const { balances, positions, openOrders, prices, fundingRates, earnRates, marketStats } =
    snapshot;
  const nowMs = opts.nowMs ?? Date.now();

  const concentration = analyzeConcentration(balances, prices, opts.concentration);
  const funding = analyzeFunding(positions, fundingRates, opts.funding);
  const idle = analyzeIdle(balances, prices, earnRates, opts.idle);
  const drawdown = analyzeDrawdown(
    { balances, positions, prices, betas: marketStats.betas },
    opts.drawdown
  );
  const orders = analyzeOrders(openOrders, prices, opts.orders, nowMs);
  const health = healthScore({ concentration, funding, idle, drawdown });
  const fixes = topFixes(
    { concentration, funding, idle, drawdown, orders },
    { betas: marketStats.betas, ...(opts.fixes ?? {}) }
  );

  return { concentration, funding, idle, drawdown, orders, health, fixes };
}

/**
 * Rank concrete fixes by expected dollar impact. Recurring impacts are per
 * year ("/yr"); the concentration fix is loss avoided per -20% BTC event.
 * Returns at most `limit` fixes (default 3).
 */
export function topFixes(
  { concentration, funding, idle, drawdown, orders },
  { betas = {}, topWeightTarget = 0.5, limit = 3 } = {}
) {
  const candidates = [];

  if (funding.worst) {
    const w = funding.worst;
    candidates.push({
      id: 'funding',
      title: `Stop the funding bleed on ${w.instId}`,
      impactUsd: -w.annualUsd, // annualUsd is negative for a payer
      impactPeriod: '/yr',
      action:
        `Close or resize the ${w.side} (${fmtAmount(w.size)} ${w.sizeCcy}, ` +
        `${fmtUsd(w.notionalUsd)} notional, ${w.lever}x). At the current rate of ` +
        `${fmtPct(w.rate8h, 4)} per 8h it pays ${fmtUsd(-w.dailyUsd, 2)} per day — ` +
        `${fmtPct(Math.abs(w.annualPctOfNotional))} APR on notional. If you want the ` +
        `exposure, holding spot ${w.sizeCcy} carries none of this cost.`,
    });
  }

  if (concentration.topAsset && concentration.topAsset.weight > topWeightTarget) {
    const top = concentration.topAsset;
    const sellUsd = (top.weight - topWeightTarget) * concentration.totalUsd;
    const beta = betas[top.ccy] ?? 1;
    const shockSaveUsd = sellUsd * Math.abs(beta) * 0.2;
    candidates.push({
      id: 'concentration',
      title: `Trim ${top.ccy} from ${fmtPct(top.weight, 0)} to ${fmtPct(topWeightTarget, 0)} of spot`,
      impactUsd: shockSaveUsd,
      impactPeriod: ' per -20% BTC event',
      action:
        `Rotate about ${fmtUsd(sellUsd)} of ${top.ccy} into stables or uncorrelated ` +
        `assets. That single move cuts the loss in a -20% BTC drawdown by roughly ` +
        `${fmtUsd(shockSaveUsd)} and lowers the portfolio's dependence on one chart.`,
    });
  }

  if (idle.totalAnnualUsd > 100) {
    candidates.push({
      id: 'idle',
      title: 'Put idle balances to work in Earn',
      impactUsd: idle.totalAnnualUsd,
      impactPeriod: '/yr',
      action:
        `${fmtUsd(idle.idleStableUsd)} of stablecoins is earning nothing — flexible ` +
        `Earn alone is worth ${fmtUsd(idle.stableAnnualUsd)}/yr with same-day ` +
        `redemption. Staking the majors you already hold adds another ` +
        `${fmtUsd(idle.totalAnnualUsd - idle.stableAnnualUsd)}/yr.`,
    });
  }

  if (orders.staleOrders.length > 0) {
    candidates.push({
      id: 'orders',
      title: `Cancel ${orders.staleOrders.length} stale open order${orders.staleOrders.length > 1 ? 's' : ''}`,
      impactUsd: null,
      impactPeriod: '',
      action:
        `Orders resting >7 days and >10% from mark (${fmtUsd(orders.staleValueUsd)} ` +
        `of locked quote) are usually forgotten intentions. Cancel and re-place ` +
        `deliberately if still wanted.`,
    });
  }

  if (concentration.dust.length >= 2) {
    candidates.push({
      id: 'dust',
      title: `Sweep ${concentration.dust.length} dust positions`,
      impactUsd: null,
      impactPeriod: '',
      action:
        `${concentration.dust.map((d) => d.ccy).join(', ')} total ` +
        `${fmtUsd(concentration.dustTotalUsd)} — too small to matter, big enough to ` +
        `clutter every decision. Convert to a core holding.`,
    });
  }

  candidates.sort((a, b) => (b.impactUsd ?? -1) - (a.impactUsd ?? -1));
  return candidates.slice(0, limit).map((c, i) => ({ rank: i + 1, ...c }));
}
