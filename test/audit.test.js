/**
 * End-to-end smoke test: run the full audit in mock mode and verify the
 * self-contained HTML report lands on disk with the key content in it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, access } from 'node:fs/promises';
import path from 'node:path';

import { runAudit, PKG_ROOT } from '../src/audit.js';

const TMP_OUT = 'out/.test-tmp';

test('runAudit (mock): writes a self-contained report with the computed findings', async (t) => {
  t.after(async () => {
    await rm(path.resolve(PKG_ROOT, TMP_OUT), { recursive: true, force: true });
  });

  const now = new Date(Date.UTC(2026, 6, 2, 12, 0, 0));
  const { reportPath, analysis, mode } = await runAudit({ outDir: TMP_OUT, now });

  assert.equal(mode, 'mock');
  assert.match(reportPath, /report-2026-07-02T12-00-00\.html$/);
  await access(reportPath); // exists

  const html = await readFile(reportPath, 'utf8');

  // shell + honesty markers
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Portfolio Doctor/);
  assert.match(html, /Demo report/); // mock banner
  assert.match(html, /not financial advice/i);

  // score + all four findings sections with real numbers
  assert.match(html, new RegExp(`>${analysis.health.total}<`)); // gauge number
  assert.match(html, /Concentration/);
  assert.match(html, /Perp funding bleed/);
  assert.match(html, /Idle assets vs Earn/);
  assert.match(html, /Drawdown exposure/);
  assert.match(html, /Top 3 fixes/);
  assert.match(html, /SOL-USDT-SWAP/);

  // self-contained: no external fetches
  assert.doesNotMatch(html, /src="http/);
  assert.doesNotMatch(html, /href="http/);
  assert.doesNotMatch(html, /@import/);

  // deterministic given a fixed clock: same inputs, same numbers
  const again = await runAudit({ outDir: TMP_OUT, now });
  assert.equal(again.analysis.health.total, analysis.health.total);
});
