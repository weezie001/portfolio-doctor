/**
 * Idle-assets-vs-Earn analysis.
 *
 * For every held asset that is NOT already allocated to Earn (balance.total -
 * balance.inEarn), if OKX currently offers an Earn product for it at or above
 * `minApy`, the un-earned yield is an opportunity:
 *   annualUsd = idle value x APY
 *
 * Stablecoin opportunities are broken out separately — parking idle USDT/USDC
 * in flexible Earn carries no market risk, so it is the headline number.
 */

export function analyzeIdle(
  balances,
  prices,
  earnRates,
  { minValueUsd = 50, minApy = 0.01 } = {}
) {
  const opportunities = [];

  for (const b of balances) {
    const idleAmount = b.total - (b.inEarn ?? 0);
    if (idleAmount <= 0) continue;
    const price = prices[b.ccy] ?? 0;
    const valueUsd = idleAmount * price;
    const earn = earnRates[b.ccy];
    if (!earn || valueUsd < minValueUsd || earn.apy < minApy) continue;
    opportunities.push({
      ccy: b.ccy,
      amount: idleAmount,
      valueUsd,
      apy: earn.apy,
      product: earn.product,
      isStable: Boolean(earn.isStable),
      annualUsd: valueUsd * earn.apy,
    });
  }

  opportunities.sort((a, b) => b.annualUsd - a.annualUsd);

  const totalAnnualUsd = opportunities.reduce((s, o) => s + o.annualUsd, 0);
  const stables = opportunities.filter((o) => o.isStable);
  const stableAnnualUsd = stables.reduce((s, o) => s + o.annualUsd, 0);
  const idleStableUsd = stables.reduce((s, o) => s + o.valueUsd, 0);

  return {
    opportunities,
    totalAnnualUsd,
    totalMonthlyUsd: totalAnnualUsd / 12,
    stableAnnualUsd,
    idleStableUsd,
    minValueUsd,
    minApy,
  };
}
