/**
 * Web layer tests: routes, the demo audit API, and report hosting — the
 * server boots on an ephemeral port with a scratch out/ directory.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';

import { createApp } from '../src/server.js';
import { PKG_ROOT } from '../src/audit.js';

const TMP_OUT = 'out/.test-web-tmp';

function start(t, opts) {
  const app = createApp(opts);
  return new Promise((resolve) => {
    app.listen(0, '127.0.0.1', () => {
      t.after(() => new Promise((done) => app.close(done)));
      resolve(`http://127.0.0.1:${app.address().port}`);
    });
  });
}

test('web: health, landing, and audit pages respond and are self-contained', async (t) => {
  const base = await start(t);

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);

  for (const [route, marker] of [
    ['/', 'Run demo audit'],
    ['/audit', 'Demo mode'],
  ]) {
    const res = await fetch(`${base}${route}`);
    assert.equal(res.status, 200, route);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    assert.match(html, /Portfolio\s|Portfolio&nbsp;Doctor/);
    assert.ok(html.includes(marker), `${route} shows "${marker}"`);
    // same self-containment rule as the report: no external requests
    assert.doesNotMatch(html, /src="http/);
    assert.doesNotMatch(html, /href="http/);
    assert.doesNotMatch(html, /@import/);
  }
});

test('web: POST /api/audit runs the engine and the report is fetchable at reportUrl', async (t) => {
  t.after(async () => {
    await rm(path.resolve(PKG_ROOT, TMP_OUT), { recursive: true, force: true });
  });
  const base = await start(t, { outDir: TMP_OUT });

  const res = await fetch(`${base}/api/audit`, { method: 'POST' });
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.ok, true);
  assert.equal(data.mode, 'mock');
  assert.ok(Number.isInteger(data.score) && data.score >= 0 && data.score <= 100, 'score 0-100');
  assert.equal(typeof data.grade, 'string');
  assert.ok(data.headline.equityUsd > 0);
  assert.equal(typeof data.formatted.equity, 'string');
  assert.equal(data.fixes.length, 3);
  assert.match(data.reportUrl, /^\/reports\/report-[\w.-]+\.html$/);

  // the linked report must actually exist and be the real rendered report
  const report = await fetch(`${base}${data.reportUrl}`);
  assert.equal(report.status, 200);
  assert.match(report.headers.get('content-type'), /text\/html/);
  const html = await report.text();
  assert.match(html, /Portfolio Doctor/);
  assert.match(html, /Demo report/);
});

test('web: report route rejects traversal and unknown paths; wrong method is 405', async (t) => {
  const base = await start(t);

  assert.equal((await fetch(`${base}/reports/nope.html`)).status, 404);
  assert.equal((await fetch(`${base}/reports/%2e%2e%2fpackage.json`)).status, 404);
  assert.equal((await fetch(`${base}/reports/report-x%5C..%5C..%5Cpackage.json.html`)).status, 404);
  assert.equal((await fetch(`${base}/no-such-page`)).status, 404);
  assert.equal((await fetch(`${base}/api/audit`)).status, 405); // GET not allowed
});
