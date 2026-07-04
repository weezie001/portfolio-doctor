/**
 * Concentration analysis — Herfindahl–Hirschman Index over spot holdings.
 *
 * HHI = sum of squared portfolio weights. 1/n (equal weight) .. 1 (one asset).
 * We report a normalized HHI in [0, 1]: (HHI - 1/n) / (1 - 1/n), so 0 means
 * perfectly equal-weighted and 1 means everything in a single asset.
 * "Effective assets" = 1 / HHI (how many equal-weight positions the portfolio
 * behaves like).
 */

export const CONCENTRATION_LEVELS = [
  { min: 0.4, level: 'heavily concentrated' },
  { min: 0.28, level: 'concentrated' },
  { min: 0.15, level: 'moderately concentrated' },
  { min: 0, level: 'well diversified' },
];

export function analyzeConcentration(balances, prices, { dustUsd = 150 } = {}) {
  const rows = balances
    .map((b) => ({
      ccy: b.ccy,
      amount: b.total,
      valueUsd: b.total * (prices[b.ccy] ?? 0),
    }))
    .filter((r) => r.valueUsd > 0)
    .sort((a, b) => b.valueUsd - a.valueUsd);

  const totalUsd = rows.reduce((s, r) => s + r.valueUsd, 0);
  const weights = rows.map((r) => ({
    ...r,
    weight: totalUsd > 0 ? r.valueUsd / totalUsd : 0,
  }));

  const hhi = weights.reduce((s, r) => s + r.weight ** 2, 0);
  const n = weights.length;
  const normalizedHhi = n > 1 ? (hhi - 1 / n) / (1 - 1 / n) : n === 1 ? 1 : 0;
  const effectiveAssets = hhi > 0 ? 1 / hhi : 0;
  const topAsset = weights[0] ?? null;
  const dust = weights.filter((r) => r.valueUsd < dustUsd);
  const dustTotalUsd = dust.reduce((s, r) => s + r.valueUsd, 0);
  const { level } = CONCENTRATION_LEVELS.find((l) => normalizedHhi >= l.min) ?? {
    level: 'well diversified',
  };

  return {
    totalUsd,
    weights,
    hhi,
    normalizedHhi,
    effectiveAssets,
    topAsset,
    dust,
    dustTotalUsd,
    dustThresholdUsd: dustUsd,
    level,
  };
}
