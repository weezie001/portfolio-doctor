/**
 * Portfolio Doctor web server — landing page, demo audit API, report hosting.
 *
 * node:http only, zero dependencies, fully offline — the same rules as the
 * rest of the app. The audit engine runs in-process (no queue, no workers):
 * POST /api/audit calls runAudit() exactly like the CLI does.
 *
 *   npm run serve        # http://localhost:4101   (PORT env overrides)
 *
 * Routes:
 *   GET  /                 landing page
 *   GET  /audit            audit form (demo mode — API-key fields disabled)
 *   POST /api/audit        run the audit -> JSON {score, grade, headline, fixes, reportUrl}
 *   GET  /api/health       liveness: {ok:true}
 *   GET  /reports/<file>   generated reports served from out/
 *
 * POST /api/audit is the pay-per-call service endpoint; the contract is
 * documented in STATUS.md ("Web service API"). With X402_MODE=mock|real it
 * is gated by the x402 payment handshake (src/x402/gate.js): 402 challenge
 * -> X-PAYMENT retry -> verify/settle -> audit + PAYMENT-RESPONSE receipt.
 * X402_MODE=off (default) leaves it exactly as the free demo.
 */

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { runAudit, PKG_ROOT } from './audit.js';
import { landingPage, auditPage, notFoundPage } from './web/pages.js';
import { fmtUsd, fmtSignedUsd, fmtPct, fmtNum } from './util/format.js';
import { createX402Gate } from './x402/gate.js';

const DEFAULT_PORT = 4101;
const MAX_BODY_BYTES = 64 * 1024; // /api/audit ignores the body today; cap it anyway
const REPORT_NAME_RE = /^report-[A-Za-z0-9._-]+\.html$/; // no separators -> no traversal

/* ------------------------------ responses -------------------------------- */

function send(req, res, status, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body ?? '', 'utf8');
  res.writeHead(status, {
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(req.method === 'HEAD' ? undefined : buf);
  return status;
}

const sendHtml = (req, res, status, html) =>
  send(req, res, status, html, { 'Content-Type': 'text/html; charset=utf-8' });

const sendJson = (req, res, status, obj, headers = {}) =>
  send(req, res, status, JSON.stringify(obj), {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  });

const sendNotFound = (req, res) =>
  req.url?.startsWith('/api/') || req.url?.startsWith('/reports/')
    ? sendJson(req, res, 404, { ok: false, error: 'Not found' })
    : sendHtml(req, res, 404, notFoundPage());

/** Drain and discard the request body (with a size cap) so sockets stay clean. */
async function drainBody(req) {
  let received = 0;
  for await (const chunk of req) {
    received += chunk.length;
    if (received > MAX_BODY_BYTES) {
      const err = new Error('Request body too large');
      err.statusCode = 413;
      throw err;
    }
  }
}

/** Read the request body as text, capped at MAX_BODY_BYTES. */
async function readBodyText(req) {
  const chunks = [];
  let received = 0;
  for await (const chunk of req) {
    received += chunk.length;
    if (received > MAX_BODY_BYTES) {
      const err = new Error('Request body too large');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/* ------------------------------ audit JSON ------------------------------- */

/** Shape the runAudit() result into the /api/audit response payload. */
export function auditResponseJson({ reportPath, analysis, mode }, generatedAt, elapsedMs) {
  const { health, concentration, funding, idle, drawdown, fixes } = analysis;
  const top = concentration.topAsset ?? null;

  return {
    ok: true,
    service: 'portfolio-doctor',
    mode,
    demo: mode === 'mock',
    score: health.total,
    grade: health.band,
    scoreComponents: health.components.map(({ key, label, earned, max }) => ({
      key,
      label,
      earned,
      max,
    })),
    headline: {
      equityUsd: drawdown.equityUsd,
      topHolding: top ? { ccy: top.ccy, weight: top.weight, level: concentration.level } : null,
      netFundingUsdPerDay: funding.netDailyUsd,
      netFundingUsdPerMonth: funding.netMonthlyUsd,
      idleYieldUsdPerYear: idle.totalAnnualUsd,
      idleStablesUsd: idle.idleStableUsd,
      betaToBtc: drawdown.portfolioBeta,
      betaLevel: drawdown.level,
      btcShock20LossUsd: drawdown.shockLossUsd,
    },
    formatted: {
      equity: fmtUsd(drawdown.equityUsd),
      topHolding: top ? `${top.ccy} at ${fmtPct(top.weight, 1)} of spot` : 'n/a',
      netFundingPerDay: `${fmtSignedUsd(funding.netDailyUsd, 2)}/day`,
      idleYieldPerYear: `${fmtUsd(idle.totalAnnualUsd)}/yr`,
      betaToBtc: fmtNum(drawdown.portfolioBeta, 2),
      btcShock20Loss: `-${fmtUsd(drawdown.shockLossUsd)}`,
    },
    fixes: fixes.map((f) => ({
      rank: f.rank,
      title: f.title,
      impactUsd: f.impactUsd,
      impactPeriod: f.impactPeriod,
      impact: f.impactUsd !== null ? `${fmtUsd(f.impactUsd)}${f.impactPeriod}` : 'hygiene',
    })),
    reportUrl: `/reports/${path.basename(reportPath)}`,
    generatedAt: generatedAt.toISOString(),
    elapsedMs,
    disclaimer: 'Educational tooling, not financial advice.',
  };
}

/* -------------------------------- server --------------------------------- */

/**
 * Build the HTTP server (not yet listening). `outDir` is where audits are
 * written and reports are served from, relative to the package root —
 * injectable so tests can use a scratch directory.
 */
export function createApp({ outDir = 'out', env = process.env } = {}) {
  const reportsDir = path.resolve(PKG_ROOT, outDir);
  // x402 pay-per-call gate for POST /api/audit (X402_MODE=off|mock|real,
  // default off = exactly the pre-x402 behaviour). UI pages, /reports and
  // /api/health are never gated. Fails fast here in real mode without creds.
  const x402 = createX402Gate({ env });

  async function handle(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');
    const method = req.method === 'HEAD' ? 'GET' : req.method;

    // ---- pages ----
    if (pathname === '/' && method === 'GET') return sendHtml(req, res, 200, landingPage());
    if (pathname === '/audit' && method === 'GET') return sendHtml(req, res, 200, auditPage());
    if (pathname === '/favicon.ico' && method === 'GET') return send(req, res, 204, '');

    // ---- API ----
    if (pathname === '/api/health' && method === 'GET') {
      return sendJson(req, res, 200, { ok: true, service: 'portfolio-doctor' });
    }
    if (pathname === '/api/audit') {
      if (method !== 'POST') {
        return sendJson(req, res, 405, {
          ok: false,
          error: 'Use POST /api/audit',
        });
      }
      // Read the JSON body. A customer may supply their OWN read-only OKX key
      // ({okxKey, okxSecret, okxPassphrase}) to audit their real account; with
      // none, the audit runs on the mock sample portfolio (the no-key demo).
      let body = {};
      try {
        const raw = await readBodyText(req);
        if (raw.trim()) body = JSON.parse(raw);
      } catch {
        return sendJson(req, res, 400, { ok: false, error: 'Body must be JSON (or empty).' });
      }
      const okxCreds =
        body.okxKey && body.okxSecret && body.okxPassphrase
          ? { key: String(body.okxKey), secret: String(body.okxSecret), passphrase: String(body.okxPassphrase) }
          : null;

      // x402 handshake (no-op when X402_MODE=off): no/invalid X-PAYMENT ->
      // 402 challenge with PAYMENT-REQUIRED; verified+settled -> run the
      // audit and attach PAYMENT-RESPONSE (the settle receipt).
      const payment = await x402.check(req);
      if (!payment.ok) {
        return sendJson(req, res, payment.status, payment.body, payment.headers);
      }

      const started = Date.now();
      const now = new Date();
      let result;
      try {
        result = await runAudit({ outDir, now, okxCreds });
      } catch (err) {
        // A bad/edge key or OKX error must not 500 the endpoint opaquely.
        return sendJson(req, res, 502, {
          ok: false,
          error: `Audit failed: ${err.message}`,
          hint: okxCreds ? 'Check the read-only OKX API key (key/secret/passphrase).' : undefined,
        }, payment.responseHeaders);
      }
      if (result.empty) {
        return sendJson(req, res, 200, {
          ok: true,
          empty: true,
          mode: 'real',
          message:
            'No open holdings or positions found for this OKX account — nothing to audit yet. ' +
            'Connect a key for an account that holds assets, or omit the key to see a sample audit.',
        }, payment.responseHeaders);
      }
      return sendJson(
        req,
        res,
        200,
        auditResponseJson(result, now, Date.now() - started),
        payment.responseHeaders
      );
    }

    // ---- generated reports (static, whitelisted filenames only) ----
    if (pathname.startsWith('/reports/') && method === 'GET') {
      let name;
      try {
        name = decodeURIComponent(pathname.slice('/reports/'.length));
      } catch {
        return sendNotFound(req, res);
      }
      if (!REPORT_NAME_RE.test(name)) return sendNotFound(req, res);
      const file = path.resolve(reportsDir, name);
      if (!file.startsWith(reportsDir + path.sep)) return sendNotFound(req, res);
      try {
        const html = await readFile(file);
        return sendHtml(req, res, 200, html);
      } catch (err) {
        if (err.code === 'ENOENT') return sendNotFound(req, res);
        throw err;
      }
    }

    return sendNotFound(req, res);
  }

  return http.createServer(async (req, res) => {
    const started = Date.now();
    let status;
    try {
      status = await handle(req, res);
    } catch (err) {
      const notWired = err.name?.endsWith('NotWiredError');
      status = err.statusCode ?? (notWired ? 501 : 500);
      const payload = {
        ok: false,
        error: err.message ?? 'Internal error',
        ...(notWired && { hint: 'Run with OKX_MODE=mock (the default) for the working demo.' }),
      };
      if (!res.headersSent) sendJson(req, res, status, payload);
      else res.destroy();
    }
    console.log(
      `[web] ${new Date().toISOString()} ${req.method} ${req.url} -> ${status} (${Date.now() - started}ms)`
    );
  });
}

/* --------------------------------- main ---------------------------------- */

const entryHref = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
const isMain =
  entryHref === import.meta.url ||
  (process.platform === 'win32' && entryHref.toLowerCase() === import.meta.url.toLowerCase());

if (isMain) {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const x402Mode = (process.env.X402_MODE ?? 'off').toLowerCase();
  createApp().listen(port, () => {
    console.log(`Portfolio Doctor web — http://localhost:${port}`);
    console.log('  GET  /             landing page');
    console.log('  GET  /audit        demo audit form');
    console.log(
      `  POST /api/audit    run the audit (JSON)${
        x402Mode !== 'off' ? ` — x402 gated (${x402Mode}): 3 USDT per call` : ''
      }`
    );
    console.log('  GET  /api/health   liveness');
    console.log('  GET  /reports/...  generated reports');
  });
}
