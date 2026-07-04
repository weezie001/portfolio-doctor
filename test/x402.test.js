/**
 * x402 payment layer tests: off-mode passthrough, the 402 challenge shape,
 * atomic-amount math, the mock verify/settle round trip, and rejection of
 * bad payments. The server boots on an ephemeral port with a scratch out/
 * directory and an injected env (never process.env mutation).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';

import { createApp } from '../src/server.js';
import { PKG_ROOT } from '../src/audit.js';
import {
  toAtomicAmount,
  buildPaymentRequirements,
  createX402Gate,
  getX402Mode,
  encodeB64Json,
  decodeB64Json,
} from '../src/x402/gate.js';
import { createFacilitator } from '../src/adapters/facilitator.js';

const TMP_OUT = 'out/.test-x402-tmp';

function start(t, opts) {
  const app = createApp(opts);
  return new Promise((resolve) => {
    app.listen(0, '127.0.0.1', () => {
      t.after(() => new Promise((done) => app.close(done)));
      resolve(`http://127.0.0.1:${app.address().port}`);
    });
  });
}

const PAY_TO = '0x1111111111111111111111111111111111111111';
const MOCK_ENV = { X402_MODE: 'mock', X402_PAY_TO: PAY_TO };

/** A well-formed exact-scheme payload satisfying the default requirements. */
function goodPayload(requirements, overrides = {}) {
  return {
    x402Version: 1,
    scheme: 'exact',
    network: 'eip155:196',
    payload: {
      signature: '0x' + 'cd'.repeat(65),
      authorization: {
        from: '0x2222222222222222222222222222222222222222',
        to: requirements.payTo,
        value: requirements.maxAmountRequired,
        validAfter: '0',
        validBefore: '9999999999',
        nonce: '0x' + '00'.repeat(32),
      },
    },
    ...overrides,
  };
}

/* ----------------------------- unit: amounts ------------------------------ */

test('x402: atomic-amount math is exact at 6 decimals', () => {
  assert.equal(toAtomicAmount('3'), '3000000'); // the listed 3 USDT fee
  assert.equal(toAtomicAmount(3), '3000000');
  assert.equal(toAtomicAmount('0.5'), '500000');
  assert.equal(toAtomicAmount('1.234567'), '1234567');
  assert.equal(toAtomicAmount('0'), '0');
  assert.equal(toAtomicAmount('1000000'), '1000000000000');
  assert.throws(() => toAtomicAmount('1.2345678'), /decimal places/); // > 6 dp
  assert.throws(() => toAtomicAmount('-1'), /invalid amount/);
  assert.throws(() => toAtomicAmount('abc'), /invalid amount/);
});

test('x402: PaymentRequirements match the listed service', () => {
  const req = buildPaymentRequirements({ X402_PAY_TO: PAY_TO });
  assert.equal(req.x402Version, 1);
  assert.equal(req.scheme, 'exact');
  assert.equal(req.network, 'eip155:196');
  assert.equal(req.maxAmountRequired, '3000000'); // 3 USDT × 10^6
  assert.equal(req.resource, '/api/audit');
  assert.equal(req.payTo, PAY_TO);
  assert.equal(req.asset, '0x779ded0c9e1022225f8e0630b35a9b54be713736');
  assert.equal(req.maxTimeoutSeconds, 60);
  assert.deepEqual(req.extra, { name: 'USDT', decimals: 6 });
  // placeholder wallet when unset
  assert.equal(buildPaymentRequirements({}).payTo, '0xREPLACE_OWNER_WALLET');
});

test('x402: mode parsing defaults to off and rejects junk', () => {
  assert.equal(getX402Mode({}), 'off');
  assert.equal(getX402Mode({ X402_MODE: 'MOCK' }), 'mock');
  assert.throws(() => getX402Mode({ X402_MODE: 'on' }), /Unknown X402_MODE/);
});

/* --------------------------- off-mode passthrough -------------------------- */

test('x402: X402_MODE=off leaves POST /api/audit exactly as before', async (t) => {
  t.after(() => rm(path.resolve(PKG_ROOT, TMP_OUT), { recursive: true, force: true }));
  const base = await start(t, { outDir: TMP_OUT, env: {} }); // no X402_MODE at all

  const res = await fetch(`${base}/api/audit`, { method: 'POST' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('payment-required'), null);
  assert.equal(res.headers.get('payment-response'), null);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.mode, 'mock');
});

/* ------------------------------ 402 challenge ------------------------------ */

test('x402: mock mode without X-PAYMENT returns a decodable 402 challenge', async (t) => {
  const base = await start(t, { env: MOCK_ENV });

  const res = await fetch(`${base}/api/audit`, { method: 'POST' });
  assert.equal(res.status, 402);

  const b64 = res.headers.get('payment-required');
  assert.ok(b64, 'PAYMENT-REQUIRED header present');
  // v2 shape: the header carries the FULL challenge {x402Version, resource, accepts}
  // (OKX's x402-check reads accepts[] from the decoded header).
  const headerChallenge = decodeB64Json(b64);
  assert.equal(headerChallenge.x402Version, 1);
  assert.equal(headerChallenge.resource, '/api/audit');
  assert.deepEqual(headerChallenge.accepts, [buildPaymentRequirements(MOCK_ENV)]);

  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.x402Version, 1);
  assert.equal(typeof body.error, 'string');
  assert.deepEqual(body.accepts, headerChallenge.accepts);
});

test('x402: only POST /api/audit is gated — pages, health and reports stay free', async (t) => {
  const base = await start(t, { env: MOCK_ENV });

  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/audit`)).status, 200);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  assert.equal((await fetch(`${base}/api/audit`)).status, 405); // GET stays 405, not 402
  assert.equal((await fetch(`${base}/reports/nope.html`)).status, 404);
});

/* ---------------------------- mock round trip ------------------------------ */

test('x402: paying the 402 challenge unlocks the audit with a PAYMENT-RESPONSE receipt', async (t) => {
  t.after(() => rm(path.resolve(PKG_ROOT, TMP_OUT), { recursive: true, force: true }));
  const base = await start(t, { outDir: TMP_OUT, env: MOCK_ENV });

  // 1. challenge
  const challenge = await fetch(`${base}/api/audit`, { method: 'POST' });
  assert.equal(challenge.status, 402);
  const requirements = decodeB64Json(challenge.headers.get('payment-required')).accepts[0];

  // 2. pay — v2 header (what `onchainos payment pay` replays with)
  const payload = goodPayload(requirements);
  const paid = await fetch(`${base}/api/audit`, {
    method: 'POST',
    headers: { 'PAYMENT-SIGNATURE': encodeB64Json(payload) },
  });
  assert.equal(paid.status, 200);

  // receipt header
  const receipt = decodeB64Json(paid.headers.get('payment-response'));
  assert.equal(receipt.success, true);
  assert.equal(receipt.status, 'success');
  assert.equal(receipt.network, 'eip155:196');
  assert.equal(receipt.payer, payload.payload.authorization.from);
  assert.match(receipt.transaction, /^0x[0-9a-f]{64}$/);

  // the audit itself still has the full contract
  const data = await paid.json();
  assert.equal(data.ok, true);
  assert.ok(Number.isInteger(data.score));
  assert.equal(data.fixes.length, 3);
  assert.match(data.reportUrl, /^\/reports\/report-[\w.-]+\.html$/);
});

test('x402: mock settle is deterministic from the payload and overpayment is accepted', async () => {
  const fac = createFacilitator('mock');
  const requirements = buildPaymentRequirements(MOCK_ENV);
  const payload = goodPayload(requirements);

  const [a, b] = [await fac.settle(payload, requirements), await fac.settle(payload, requirements)];
  assert.equal(a.transaction, b.transaction); // deterministic from payload hash
  assert.match(a.transaction, /^0x[0-9a-f]{64}$/);

  // declared amount above the requirement still verifies (>= check)
  const generous = goodPayload(requirements);
  generous.payload.authorization.value = '4000000';
  assert.equal((await fac.verify(generous, requirements)).isValid, true);
});

/* ---------------------------- bad payments --------------------------------- */

test('x402: bad payments are rejected with a fresh 402 and an error field', async (t) => {
  const base = await start(t, { env: MOCK_ENV });
  const requirements = buildPaymentRequirements(MOCK_ENV);

  const attempt = (header) =>
    fetch(`${base}/api/audit`, { method: 'POST', headers: { 'X-PAYMENT': header } });

  const cases = [
    ['not base64 JSON', 'garbage!!!', /base64/i],
    [
      'wrong scheme',
      encodeB64Json(goodPayload(requirements, { scheme: 'upto' })),
      /scheme mismatch/i,
    ],
    [
      'wrong network',
      encodeB64Json(goodPayload(requirements, { network: 'eip155:1' })),
      /network mismatch/i,
    ],
  ];
  const short = goodPayload(requirements);
  short.payload.authorization.value = '2999999'; // one atomic unit short of 3 USDT
  cases.push(['insufficient amount', encodeB64Json(short), /insufficient amount/i]);
  const anonymous = goodPayload(requirements);
  delete anonymous.payload.authorization.from;
  cases.push(['missing payer', encodeB64Json(anonymous), /no payer/i]);

  for (const [label, header, errorRe] of cases) {
    const res = await attempt(header);
    assert.equal(res.status, 402, label);
    assert.ok(res.headers.get('payment-required'), `${label}: challenge re-issued`);
    assert.equal(res.headers.get('payment-response'), null, `${label}: no receipt`);
    const body = await res.json();
    assert.equal(body.ok, false, label);
    assert.match(body.error, errorRe, label);
  }
});

/* ------------------------------ real mode ---------------------------------- */

test('x402: real mode without OKX_X402_* creds fails fast with a clear message', () => {
  assert.throws(
    () => createX402Gate({ env: { X402_MODE: 'real' } }),
    /OKX_X402_API_KEY, OKX_X402_SECRET, OKX_X402_PASSPHRASE/
  );
  // and via the server factory too (construction-time, not first-call)
  assert.throws(() => createApp({ env: { X402_MODE: 'real' } }), /X402_MODE=real but missing env/);
});
