/**
 * x402 pay-per-call demo client — walks the full 402 handshake against the
 * Portfolio Doctor server and prints every step.
 *
 *   npm run x402-demo                       # spawns a local server (X402_MODE=mock) and runs the flow
 *   X402_DEMO_URL=http://host:port npm run x402-demo   # runs against an already-running server
 *
 * Flow demonstrated:
 *   1. POST /api/audit with no payment      -> HTTP 402 + PAYMENT-REQUIRED header
 *   2. decode base64 PaymentRequirements    -> price, network, asset, payTo
 *   3. build a mock exact-scheme PaymentPayload for those requirements
 *   4. retry with X-PAYMENT: base64(payload) -> HTTP 200 + PAYMENT-RESPONSE receipt
 *
 * Zero dependencies: node:child_process to (optionally) spawn the server,
 * global fetch for HTTP. The payload built here is a demo stand-in — a real
 * x402 client wallet signs an EIP-3009 authorization; in mock mode the
 * facilitator only checks shape, scheme/network match, and amount.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const decodeB64Json = (b64) => JSON.parse(Buffer.from(String(b64), 'base64').toString('utf8'));
const encodeB64Json = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');

function atomicToUsdt(atomic, decimals = 6) {
  const s = String(atomic).padStart(decimals + 1, '0');
  return `${s.slice(0, -decimals)}.${s.slice(-decimals)}`.replace(/\.?0+$/, '') || '0';
}

/* ----------------------- optional: spawn the server ----------------------- */

async function waitForHealth(base, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server at ${base} did not become healthy in time`);
}

async function ensureServer() {
  const external = process.env.X402_DEMO_URL;
  if (external) {
    const base = external.replace(/\/+$/, '');
    console.log(`Using already-running server at ${base} (X402_DEMO_URL)`);
    return { base, stop: () => {} };
  }

  const port = 20000 + Math.floor(Math.random() * 10000);
  const base = `http://127.0.0.1:${port}`;
  console.log(`Spawning local server on ${base} with X402_MODE=mock ...`);
  const child = spawn(process.execPath, [path.join(PKG_ROOT, 'src', 'server.js')], {
    cwd: PKG_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      X402_MODE: process.env.X402_MODE ?? 'mock',
      X402_PAY_TO: process.env.X402_PAY_TO ?? '0xDEMO000000000000000000000000000000000196',
    },
    stdio: 'ignore',
  });
  child.on('error', (err) => {
    console.error(`failed to spawn server: ${err.message}`);
    process.exit(1);
  });
  await waitForHealth(base);
  return { base, stop: () => child.kill() };
}

/* --------------------------------- demo ----------------------------------- */

async function main() {
  const { base, stop } = await ensureServer();
  try {
    // -- Step 1: call the gated route with no payment ------------------------
    console.log('\n[1] POST /api/audit (no X-PAYMENT header)');
    const first = await fetch(`${base}/api/audit`, { method: 'POST' });
    console.log(`    -> HTTP ${first.status}`);
    if (first.status !== 402) {
      const body = await first.text();
      throw new Error(
        `expected 402, got ${first.status}. Is the server running with X402_MODE=mock? Body: ${body.slice(0, 200)}`
      );
    }
    const challengeBody = await first.json();
    const b64Req = first.headers.get('payment-required');
    if (!b64Req) throw new Error('402 response is missing the PAYMENT-REQUIRED header');

    // -- Step 2: decode the challenge and pick accepts[0] --------------------
    const headerChallenge = decodeB64Json(b64Req);
    if (!Array.isArray(headerChallenge.accepts) || headerChallenge.accepts.length === 0) {
      throw new Error('PAYMENT-REQUIRED header challenge has no accepts[] — not a valid x402 v2 challenge');
    }
    const requirements = headerChallenge.accepts[0];
    console.log('\n[2] Decoded PAYMENT-REQUIRED challenge (accepts[0]):');
    console.log(
      `    price:    ${requirements.maxAmountRequired} atomic units = ${atomicToUsdt(
        requirements.maxAmountRequired,
        requirements.extra?.decimals ?? 6
      )} ${requirements.extra?.name ?? 'USDT'}`
    );
    console.log(`    scheme:   ${requirements.scheme}   network: ${requirements.network}`);
    console.log(`    asset:    ${requirements.asset}`);
    console.log(`    payTo:    ${requirements.payTo}`);
    console.log(`    resource: ${requirements.resource} — ${requirements.description}`);
    console.log(`    body.error: ${challengeBody.error}`);

    // -- Step 3: build a mock PaymentPayload for those requirements ----------
    const now = Math.floor(Date.now() / 1000);
    const paymentPayload = {
      x402Version: headerChallenge.x402Version,
      scheme: requirements.scheme,
      network: requirements.network,
      payload: {
        // A real client wallet produces an EIP-3009 signature here.
        signature: '0x' + 'ab'.repeat(65),
        authorization: {
          from: '0xc11e470000000000000000000000000000000196', // demo client wallet
          to: requirements.payTo,
          value: requirements.maxAmountRequired,
          validAfter: String(now - 60),
          validBefore: String(now + requirements.maxTimeoutSeconds),
          nonce: '0x' + now.toString(16).padStart(64, '0'),
        },
      },
    };
    console.log('\n[3] Built mock PaymentPayload (exact scheme, full amount), retrying with PAYMENT-SIGNATURE...');

    // -- Step 4: retry with the v2 payment header -----------------------------
    const paid = await fetch(`${base}/api/audit`, {
      method: 'POST',
      headers: { 'PAYMENT-SIGNATURE': encodeB64Json(paymentPayload) },
    });
    console.log(`    -> HTTP ${paid.status}`);
    if (paid.status !== 200) {
      throw new Error(`expected 200 after payment, got ${paid.status}: ${await paid.text()}`);
    }

    const b64Receipt = paid.headers.get('payment-response');
    if (!b64Receipt) throw new Error('paid response is missing the PAYMENT-RESPONSE header');
    const receipt = decodeB64Json(b64Receipt);
    const audit = await paid.json();

    console.log('\n[4] Decoded PAYMENT-RESPONSE settle receipt:');
    console.log(`    success:     ${receipt.success}   status: ${receipt.status}`);
    console.log(`    transaction: ${receipt.transaction}`);
    console.log(`    network:     ${receipt.network}   payer: ${receipt.payer}`);

    console.log('\n[5] Paid audit result:');
    console.log(`    score:   ${audit.score}/100 (${audit.grade})`);
    console.log(`    equity:  ${audit.formatted.equity}   top holding: ${audit.formatted.topHolding}`);
    console.log(`    fixes:   ${audit.fixes.map((f) => `#${f.rank} ${f.title} (${f.impact})`).join(' | ')}`);
    console.log(`    report:  ${base}${audit.reportUrl}`);

    console.log('\nx402 demo complete: 402 challenge -> mock payment -> verified + settled -> audit delivered.');
  } finally {
    stop();
  }
}

main().catch((err) => {
  console.error(`\nx402 demo FAILED: ${err.message}`);
  process.exitCode = 1;
});
