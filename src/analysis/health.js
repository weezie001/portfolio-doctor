/**
 * Overall health score, 0-100, with a fully transparent breakdown.
 *
 * Four components, 25 points each. Every component maps one measured input
 * onto a linear scale between a "good" threshold (full credit) and a "bad"
 * threshold (zero credit):
 *
 *   concentration  normalized HHI            full <= 0.15   zero >= 0.85
 *   funding        net funding paid per year full <= 0      zero >= 10%
 *                  as a % of equity
 *   idle           un-earned yield per year  full <= 0      zero >= 3%
 *                  as a % of equity
 *   drawdown       |portfolio beta to BTC|   full <= 0.60   zero >= 1.60
 *
 * The thresholds live in HEALTH_CONFIG so the scoring is auditable and easy
 * to tune; the report prints each component with its measured input.
 */

import { fmtPct } from '../util/format.js';

export const HEALTH_CONFIG = {
  concentration: {
    max: 25,
    good: 0.15,
    bad: 0.85,
    label: 'Diversification',
    describe: (v) =>
      `normalized HHI ${v.toFixed(2)} (0 = equal-weight, 1 = single asset); full credit <= 0.15, zero >= 0.85`,
  },
  funding: {
    max: 25,
    good: 0,
    bad: 0.1,
    label: 'Funding efficiency',
    describe: (v) =>
      `net funding paid = ${fmtPct(v, 2)} of equity per year; full credit at 0%, zero >= 10%`,
  },
  idle: {
    max: 25,
    good: 0,
    bad: 0.03,
    label: 'Capital at work',
    describe: (v) =>
      `un-earned yield = ${fmtPct(v, 2)} of equity per year; full credit at 0%, zero >= 3%`,
  },
  drawdown: {
    max: 25,
    good: 0.6,
    bad: 1.6,
    label: 'Drawdown exposure',
    describe: (v) =>
      `|portfolio beta to BTC| = ${v.toFixed(2)}; full credit <= 0.60, zero >= 1.60`,
  },
};

export const HEALTH_BANDS = [
  { min: 85, band: 'Excellent' },
  { min: 70, band: 'Healthy' },
  { min: 55, band: 'Needs Work' },
  { min: 40, band: 'At Risk' },
  { min: 0, band: 'Critical' },
];

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Lower-is-better linear scale: 1 at `good`, 0 at `bad`. */
function credit(value, good, bad) {
  if (bad === good) return value <= good ? 1 : 0;
  return clamp01((bad - value) / (bad - good));
}

export function healthScore({ concentration, funding, idle, drawdown }, config = HEALTH_CONFIG) {
  const equity = drawdown.equityUsd;
  const inputs = {
    concentration: concentration.normalizedHhi,
    funding: equity > 0 ? Math.max(0, -funding.netAnnualUsd) / equity : 0,
    idle: equity > 0 ? idle.totalAnnualUsd / equity : 0,
    drawdown: Math.abs(drawdown.portfolioBeta),
  };

  const components = Object.entries(config).map(([key, cfg]) => {
    const value = inputs[key];
    const earned = Math.round(cfg.max * credit(value, cfg.good, cfg.bad) * 10) / 10;
    return {
      key,
      label: cfg.label,
      value,
      earned,
      max: cfg.max,
      detail: cfg.describe(value),
    };
  });

  const total = Math.round(components.reduce((s, c) => s + c.earned, 0));
  const { band } = HEALTH_BANDS.find((b) => total >= b.min);

  return { total, band, components, inputs };
}
