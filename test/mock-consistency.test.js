/**
 * Guards the "internally consistent mock data" requirement: derived fields
 * obey their formulas, every lookup resolves, and the deliberate findings
 * (concentration, funding bleed, idle stables, stale order) are present so
 * the demo report always has something real to show.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildMockSnapshot, createOkxAdapter, OkxRealModeNotWiredError } from '../src/adapters/okx.js';
import { createLlmAdapter, LlmRealModeNotWiredError } from '../src/adapters/llm.js';
import { analyzePortfolio } from '../src/analysis/index.js';

const NOW = Date.UTC(2026, 6, 2, 12, 0, 0);
const approx = (actual, expected, eps) =>
  assert.ok(Math.abs(actual - expected) <= eps, `expected ${actual} ~= ${expected} (eps ${eps})`);

test('mock snapshot: derived position fields obey their formulas', () => {
  const s = buildMockSnapshot(NOW);
  assert.ok(s.positions.length >= 2 && s.positions.length <= 3, '2-3 perp positions');
  for (const p of s.positions) {
    const dir = p.side === 'long' ? 1 : -1;
    assert.equal(p.markPx, s.prices[p.sizeCcy], `${p.instId} mark = spot price`);
    approx(p.notionalUsd, p.size * p.markPx, 0.01);
    approx(p.uplUsd, (p.markPx - p.entryPx) * p.size * dir, 0.01);
    approx(p.marginUsd, (p.size * p.entryPx) / p.lever, 0.01);
    assert.ok(p.lever >= 1);
  }
});

test('mock snapshot: every lookup resolves (prices, funding, betas, vol)', () => {
  const s = buildMockSnapshot(NOW);
  for (const b of s.balances) {
    assert.ok(s.prices[b.ccy] > 0, `price for ${b.ccy}`);
    assert.ok(b.ccy in s.marketStats.betas, `beta for ${b.ccy}`);
    assert.ok(b.ccy in s.marketStats.vol30d, `vol for ${b.ccy}`);
    assert.ok(b.total >= b.inEarn, `${b.ccy} inEarn <= total`);
  }
  for (const p of s.positions) {
    assert.ok(p.instId in s.fundingRates, `funding rate for ${p.instId}`);
    assert.ok(p.sizeCcy in s.marketStats.betas, `beta for ${p.sizeCcy}`);
  }
  for (const o of s.openOrders) {
    assert.ok(s.prices[o.instId.split('-')[0]] > 0, `price for order ${o.instId}`);
    assert.ok(o.cTime < NOW, 'orders created in the past');
  }
});

test('mock snapshot: deliberate findings are present', () => {
  const s = buildMockSnapshot(NOW);
  const a = analyzePortfolio(s, { nowMs: NOW });

  // ~8+ assets incl. dust
  assert.ok(s.balances.length >= 8, 'at least 8 spot assets');
  assert.ok(a.concentration.dust.length >= 2, 'includes dust positions');

  // heavy concentration in one asset (BTC > 60%)
  assert.equal(a.concentration.topAsset.ccy, 'BTC');
  assert.ok(a.concentration.topAsset.weight > 0.6, 'BTC above 60% of spot');
  assert.equal(a.concentration.level, 'heavily concentrated');

  // a perp paying meaningfully negative funding (> $15/day)
  assert.ok(a.funding.worst, 'has a worst bleeder');
  assert.ok(a.funding.worst.dailyUsd < -15, `bleeder pays >$15/day (got ${a.funding.worst.dailyUsd})`);
  assert.ok(a.funding.netDailyUsd < 0, 'net funding is negative');
  assert.ok(a.funding.earners.length >= 1, 'at least one position collects funding');

  // idle stables that could earn
  assert.ok(a.idle.idleStableUsd > 10000, 'over $10k idle stablecoins');
  assert.ok(a.idle.stableAnnualUsd > 500, 'stable earn opportunity > $500/yr');

  // one stale open order
  assert.equal(a.orders.staleOrders.length, 1);
  assert.equal(a.orders.staleOrders[0].instId, 'BTC-USDT');

  // health lands mid-band: real findings, not a broken portfolio
  assert.ok(a.health.total >= 30 && a.health.total <= 70, `score mid-range (got ${a.health.total})`);

  // top 3 fixes: funding bleed must rank #1 by impact, all with impact text
  assert.equal(a.fixes.length, 3);
  assert.equal(a.fixes[0].id, 'funding');
  assert.ok(a.fixes[0].impactUsd > 5000, 'funding fix worth > $5k/yr');
  const recurring = a.fixes.filter((f) => f.impactPeriod === '/yr');
  assert.ok(recurring.length >= 2, 'at least two recurring-impact fixes');
});

test('mock snapshot: total equity = spot + margin + upl', () => {
  const s = buildMockSnapshot(NOW);
  const a = analyzePortfolio(s, { nowMs: NOW });
  const spot = s.balances.reduce((sum, b) => sum + b.total * s.prices[b.ccy], 0);
  const margin = s.positions.reduce((sum, p) => sum + p.marginUsd, 0);
  const upl = s.positions.reduce((sum, p) => sum + p.uplUsd, 0);
  approx(a.drawdown.equityUsd, spot + margin + upl, 0.01);
  assert.ok(a.drawdown.equityUsd > 100000, 'demo account is meaningfully sized');
});

test('adapters: default mode is mock; real OKX mode needs a read-only key', async () => {
  assert.equal(createOkxAdapter().mode, 'mock');
  assert.equal(createLlmAdapter().mode, 'mock');

  // Real OKX mode requires a customer-supplied read-only key; without one it
  // fails fast with a clear message (never silently returns mock data).
  assert.throws(() => createOkxAdapter('real'), OkxRealModeNotWiredError);
  assert.throws(() => createOkxAdapter('real', { creds: { key: 'k' } }), OkxRealModeNotWiredError);
  // With full creds it constructs a working real adapter (no network here).
  const realOkx = createOkxAdapter('real', {
    creds: { key: 'k', secret: 's', passphrase: 'p' },
  });
  assert.equal(realOkx.mode, 'real');
  assert.equal(typeof realOkx.getSnapshot, 'function');

  const realLlm = createLlmAdapter('real');
  const s = buildMockSnapshot(NOW);
  const analysis = analyzePortfolio(s, { nowMs: NOW });
  await assert.rejects(
    realLlm.generateNarrative({ snapshot: s, analysis }),
    LlmRealModeNotWiredError
  );

  assert.throws(() => createOkxAdapter('banana'), /Unknown OKX_MODE/);
});

test('mock narrative: every section present and carries computed numbers', async () => {
  const s = buildMockSnapshot(NOW);
  const analysis = analyzePortfolio(s, { nowMs: NOW });
  const n = await createLlmAdapter('mock').generateNarrative({ snapshot: s, analysis });

  for (const key of ['headline', 'overview', 'concentration', 'funding', 'idle', 'drawdown', 'closing']) {
    assert.ok(typeof n[key] === 'string' && n[key].length > 40, `narrative.${key} is substantial`);
  }
  assert.match(n.overview, new RegExp(`${analysis.health.total}/100`));
  assert.match(n.funding, /SOL-USDT-SWAP/);
  assert.match(n.concentration, /BTC/);
});
