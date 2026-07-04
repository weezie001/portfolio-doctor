/**
 * Open-order hygiene — flags stale resting orders.
 *
 * An order is "stale" when BOTH hold:
 *   - its limit price is >= stalePct away from the current mark, AND
 *   - it has been resting for >= staleDays.
 *
 * Stale far-from-market orders silently tie up quote balance / margin and
 * are a classic "forgot about it" foot-gun.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function analyzeOrders(
  openOrders,
  prices,
  { stalePct = 0.1, staleDays = 7 } = {},
  nowMs = Date.now()
) {
  const rows = openOrders.map((o) => {
    const baseCcy = o.instId.split('-')[0];
    const mark = prices[baseCcy] ?? 0;
    const distancePct = mark > 0 ? Math.abs(o.px - mark) / mark : 0;
    const ageDays = (nowMs - o.cTime) / DAY_MS;
    return {
      ...o,
      baseCcy,
      mark,
      valueUsd: o.px * o.sz,
      distancePct,
      ageDays,
      stale: distancePct >= stalePct && ageDays >= staleDays,
    };
  });

  const staleOrders = rows.filter((r) => r.stale);
  return {
    orders: rows,
    staleOrders,
    staleValueUsd: staleOrders.reduce((s, r) => s + r.valueUsd, 0),
    count: rows.length,
  };
}
