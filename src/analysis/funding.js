/**
 * Perp funding-bleed analysis.
 *
 * OKX funding settles every 8 hours (3 periods/day). Sign convention:
 * rate > 0 means longs pay shorts; rate < 0 means shorts pay longs.
 *
 * For each position we compute the holder's funding cash flow:
 *   dailyUsd = -direction * rate8h * notional * periodsPerDay
 * where direction = +1 for long, -1 for short. Negative dailyUsd = the
 * position is PAYING funding (bleeding); positive = collecting.
 */

export function analyzeFunding(positions, fundingRates, { periodsPerDay = 3 } = {}) {
  const rows = positions.map((p) => {
    const rate8h = fundingRates[p.instId];
    if (rate8h === undefined) {
      throw new Error(`analyzeFunding: no funding rate for ${p.instId}`);
    }
    const dir = p.side === 'long' ? 1 : -1;
    const dailyUsd = -dir * rate8h * p.notionalUsd * periodsPerDay;
    return {
      instId: p.instId,
      side: p.side,
      sizeCcy: p.sizeCcy,
      size: p.size,
      notionalUsd: p.notionalUsd,
      lever: p.lever,
      uplUsd: p.uplUsd,
      rate8h,
      /** funding rate annualized (magnitude of the market rate, decimal) */
      annualRate: rate8h * periodsPerDay * 365,
      dailyUsd,
      monthlyUsd: dailyUsd * 30,
      annualUsd: dailyUsd * 365,
      /** holder's annual funding flow as a fraction of notional (signed) */
      annualPctOfNotional: p.notionalUsd > 0 ? (dailyUsd * 365) / p.notionalUsd : 0,
      paying: dailyUsd < 0,
    };
  });

  const netDailyUsd = rows.reduce((s, r) => s + r.dailyUsd, 0);
  const bleeders = rows.filter((r) => r.paying).sort((a, b) => a.dailyUsd - b.dailyUsd);
  const earners = rows.filter((r) => r.dailyUsd > 0).sort((a, b) => b.dailyUsd - a.dailyUsd);

  return {
    positions: rows,
    netDailyUsd,
    netMonthlyUsd: netDailyUsd * 30,
    netAnnualUsd: netDailyUsd * 365,
    worst: bleeders[0] ?? null,
    bleeders,
    earners,
  };
}
