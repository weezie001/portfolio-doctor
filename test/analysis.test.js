import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeConcentration } from '../src/analysis/concentration.js';
import { analyzeFunding } from '../src/analysis/funding.js';
import { analyzeIdle } from '../src/analysis/idle.js';
import { analyzeDrawdown, computeBetaFromCloses } from '../src/analysis/drawdown.js';
import { analyzeOrders } from '../src/analysis/orders.js';
import { healthScore } from '../src/analysis/health.js';

const approx = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= eps, `expected ${actual} ~= ${expected}`);

/* ------------------------------ concentration --------------------------- */

test('concentration: two equal assets -> HHI 0.5, normalized 0', () => {
  const r = analyzeConcentration(
    [
      { ccy: 'A', total: 1 },
      { ccy: 'B', total: 1 },
    ],
    { A: 100, B: 100 }
  );
  approx(r.hhi, 0.5);
  approx(r.normalizedHhi, 0);
  approx(r.effectiveAssets, 2);
  assert.equal(r.level, 'well diversified');
});

test('concentration: single asset -> normalized 1, heavily concentrated', () => {
  const r = analyzeConcentration([{ ccy: 'A', total: 3 }], { A: 10 });
  approx(r.normalizedHhi, 1);
  assert.equal(r.level, 'heavily concentrated');
  assert.equal(r.topAsset.ccy, 'A');
});

test('concentration: 80/20 split -> HHI 0.68', () => {
  const r = analyzeConcentration(
    [
      { ccy: 'A', total: 80 },
      { ccy: 'B', total: 20 },
    ],
    { A: 1, B: 1 }
  );
  approx(r.hhi, 0.64 + 0.04);
  assert.equal(r.topAsset.ccy, 'A');
  approx(r.topAsset.weight, 0.8);
});

test('concentration: dust detection and zero-value exclusion', () => {
  const r = analyzeConcentration(
    [
      { ccy: 'BIG', total: 10 },
      { ccy: 'DUST', total: 1 },
      { ccy: 'NOPRICE', total: 5 },
    ],
    { BIG: 1000, DUST: 40 },
    { dustUsd: 150 }
  );
  assert.equal(r.weights.length, 2); // NOPRICE excluded
  assert.deepEqual(r.dust.map((d) => d.ccy), ['DUST']);
  approx(r.dustTotalUsd, 40);
});

/* --------------------------------- funding ------------------------------ */

test('funding: long pays when rate positive (3 periods/day)', () => {
  const r = analyzeFunding(
    [{ instId: 'X-USDT-SWAP', sizeCcy: 'X', side: 'long', size: 1, notionalUsd: 10000, lever: 2, uplUsd: 0 }],
    { 'X-USDT-SWAP': 0.0004 }
  );
  const p = r.positions[0];
  approx(p.dailyUsd, -10000 * 0.0004 * 3); // -12/day
  approx(p.monthlyUsd, -360);
  approx(p.annualUsd, -4380);
  approx(p.annualPctOfNotional, -0.438);
  assert.equal(p.paying, true);
  assert.equal(r.worst.instId, 'X-USDT-SWAP');
});

test('funding: short collects when rate positive; flips when negative', () => {
  const r = analyzeFunding(
    [
      { instId: 'S-USDT-SWAP', sizeCcy: 'S', side: 'short', size: 1, notionalUsd: 5000, lever: 2, uplUsd: 0 },
      { instId: 'N-USDT-SWAP', sizeCcy: 'N', side: 'short', size: 1, notionalUsd: 5000, lever: 2, uplUsd: 0 },
    ],
    { 'S-USDT-SWAP': 0.0002, 'N-USDT-SWAP': -0.0002 }
  );
  const [s, n] = r.positions;
  approx(s.dailyUsd, 3); // short collects positive funding
  approx(n.dailyUsd, -3); // short pays negative funding
  approx(r.netDailyUsd, 0);
  assert.equal(r.worst.instId, 'N-USDT-SWAP');
  assert.equal(r.earners[0].instId, 'S-USDT-SWAP');
});

test('funding: missing rate throws', () => {
  assert.throws(
    () =>
      analyzeFunding(
        [{ instId: 'GHOST-SWAP', sizeCcy: 'G', side: 'long', size: 1, notionalUsd: 1, lever: 1, uplUsd: 0 }],
        {}
      ),
    /no funding rate/
  );
});

/* ---------------------------------- idle -------------------------------- */

test('idle: value x APY, sorted, stables broken out', () => {
  const r = analyzeIdle(
    [
      { ccy: 'USDT', total: 10000, inEarn: 0 },
      { ccy: 'ETH', total: 2, inEarn: 0 },
    ],
    { USDT: 1, ETH: 3000 },
    {
      USDT: { apy: 0.08, product: 'Flexible', isStable: true },
      ETH: { apy: 0.03, product: 'Staking', isStable: false },
    }
  );
  assert.equal(r.opportunities.length, 2);
  assert.equal(r.opportunities[0].ccy, 'USDT'); // 800 > 180
  approx(r.opportunities[0].annualUsd, 800);
  approx(r.opportunities[1].annualUsd, 180);
  approx(r.totalAnnualUsd, 980);
  approx(r.stableAnnualUsd, 800);
  approx(r.idleStableUsd, 10000);
});

test('idle: respects inEarn, minValueUsd and minApy filters', () => {
  const r = analyzeIdle(
    [
      { ccy: 'USDT', total: 1000, inEarn: 900 }, // only 100 idle
      { ccy: 'TINY', total: 10, inEarn: 0 }, // $10 < minValueUsd
      { ccy: 'LOWAPY', total: 1000, inEarn: 0 }, // 0.5% < minApy
      { ccy: 'NOEARN', total: 1000, inEarn: 0 }, // no product
    ],
    { USDT: 1, TINY: 1, LOWAPY: 1, NOEARN: 1 },
    {
      USDT: { apy: 0.1, product: 'Flexible', isStable: true },
      TINY: { apy: 0.1, product: 'Flexible', isStable: false },
      LOWAPY: { apy: 0.005, product: 'Flexible', isStable: false },
    },
    { minValueUsd: 50, minApy: 0.01 }
  );
  assert.equal(r.opportunities.length, 1);
  assert.equal(r.opportunities[0].ccy, 'USDT');
  approx(r.opportunities[0].valueUsd, 100);
  approx(r.totalAnnualUsd, 10);
});

/* -------------------------------- drawdown ------------------------------ */

test('drawdown: all-stable portfolio has beta 0 and no shock loss', () => {
  const r = analyzeDrawdown({
    balances: [{ ccy: 'USDT', total: 10000 }],
    positions: [],
    prices: { USDT: 1 },
    betas: { USDT: 0 },
  });
  approx(r.portfolioBeta, 0);
  approx(r.shockLossUsd, 0);
  approx(r.equityUsd, 10000);
  assert.equal(r.level, 'defensive');
});

test('drawdown: pure BTC spot -> beta 1, -20% shock = 20% of equity', () => {
  const r = analyzeDrawdown({
    balances: [{ ccy: 'BTC', total: 1 }],
    positions: [],
    prices: { BTC: 100000 },
    betas: { BTC: 1 },
  });
  approx(r.portfolioBeta, 1);
  approx(r.shockLossUsd, 20000);
  approx(r.equityAfterShockUsd, 80000);
});

test('drawdown: short perp offsets spot beta; margin/upl count in equity', () => {
  const r = analyzeDrawdown({
    balances: [{ ccy: 'BTC', total: 1 }],
    positions: [
      {
        instId: 'BTC-USDT-SWAP',
        sizeCcy: 'BTC',
        side: 'short',
        size: 1,
        notionalUsd: 100000,
        marginUsd: 20000,
        uplUsd: -1000,
      },
    ],
    prices: { BTC: 100000 },
    betas: { BTC: 1 },
  });
  // beta dollars: +100000 (spot) - 100000 (short) = 0
  approx(r.portfolioBeta, 0);
  approx(r.equityUsd, 100000 + 20000 - 1000);
  approx(r.grossPerpNotionalUsd, 100000);
  // gross exposure = 100k spot + 100k perp = 200k over 119k equity
  approx(r.grossLeverage, 200000 / 119000);
});

test('computeBetaFromCloses: scaled series recovers the multiplier', () => {
  const bench = [100, 102, 99, 105, 103, 108];
  // asset moves exactly 1.5x the bench's returns each day
  const asset = [50];
  for (let i = 1; i < bench.length; i++) {
    asset.push(asset[i - 1] * (1 + 1.5 * (bench[i] / bench[i - 1] - 1)));
  }
  approx(computeBetaFromCloses(asset, bench), 1.5, 1e-6);
  assert.throws(() => computeBetaFromCloses([1, 2], [1, 2, 3]), /same length/);
});

/* --------------------------------- orders ------------------------------- */

test('orders: stale requires BOTH far-from-mark AND old', () => {
  const now = Date.UTC(2026, 6, 2);
  const DAY = 24 * 60 * 60 * 1000;
  const r = analyzeOrders(
    [
      { instId: 'BTC-USDT', side: 'buy', ordType: 'limit', px: 80, sz: 1, cTime: now - 30 * DAY }, // far + old -> stale
      { instId: 'BTC-USDT', side: 'buy', ordType: 'limit', px: 80, sz: 1, cTime: now - 1 * DAY }, // far + young
      { instId: 'BTC-USDT', side: 'buy', ordType: 'limit', px: 99, sz: 1, cTime: now - 30 * DAY }, // near + old
    ],
    { BTC: 100 },
    { stalePct: 0.1, staleDays: 7 },
    now
  );
  assert.deepEqual(r.orders.map((o) => o.stale), [true, false, false]);
  assert.equal(r.staleOrders.length, 1);
  approx(r.staleValueUsd, 80);
});

/* --------------------------------- health ------------------------------- */

function healthInputs({ hhiN = 0, bleedAnnual = 0, idleAnnual = 0, beta = 0.5, equity = 100000 }) {
  return {
    concentration: { normalizedHhi: hhiN },
    funding: { netAnnualUsd: -bleedAnnual },
    idle: { totalAnnualUsd: idleAnnual },
    drawdown: { portfolioBeta: beta, equityUsd: equity },
  };
}

test('health: ideal portfolio scores 100, Excellent', () => {
  const h = healthScore(healthInputs({ hhiN: 0.1, bleedAnnual: 0, idleAnnual: 0, beta: 0.5 }));
  assert.equal(h.total, 100);
  assert.equal(h.band, 'Excellent');
});

test('health: worst-case portfolio scores 0, Critical', () => {
  const h = healthScore(
    healthInputs({ hhiN: 1, bleedAnnual: 20000, idleAnnual: 10000, beta: 2.5 })
  );
  assert.equal(h.total, 0);
  assert.equal(h.band, 'Critical');
});

test('health: components sum to total and worsening inputs lower the score', () => {
  const mid = healthScore(
    healthInputs({ hhiN: 0.45, bleedAnnual: 6000, idleAnnual: 1500, beta: 1.0 })
  );
  const sum = mid.components.reduce((s, c) => s + c.earned, 0);
  assert.equal(mid.total, Math.round(sum));
  assert.ok(mid.total > 0 && mid.total < 100);

  const worse = healthScore(
    healthInputs({ hhiN: 0.6, bleedAnnual: 8000, idleAnnual: 2500, beta: 1.3 })
  );
  assert.ok(worse.total < mid.total);
});

test('health: net-collecting funding gets full funding credit', () => {
  const h = healthScore(healthInputs({ bleedAnnual: -5000 })); // negative bleed = earning
  const funding = h.components.find((c) => c.key === 'funding');
  assert.equal(funding.earned, funding.max);
});
