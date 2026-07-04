/**
 * x402 facilitator adapter — the ONE module through which every payment
 * verify/settle call goes (same pattern as src/adapters/okx.js and llm.js).
 *
 * A "facilitator" is the service that checks an x402 PaymentPayload against
 * the PaymentRequirements we advertised (verify) and executes the on-chain
 * transfer (settle). Two modes, selected by env var X402_MODE:
 *
 *   mock — fully working, in-process. verify() checks the payload is a
 *          well-formed exact-scheme payment on the right network for at
 *          least the required amount; settle() returns a deterministic
 *          fake transaction hash derived from the payload (sha256), so
 *          the same payment always settles to the same tx id.
 *
 *   real — OKX x402 facilitator over HTTPS. Endpoints confirmed from the
 *          OKX web3 docs:
 *            POST https://web3.okx.com/api/v6/pay/x402/verify
 *            POST https://web3.okx.com/api/v6/pay/x402/settle
 *          both with body {paymentPayload, paymentRequirements}.
 *          Auth is OKX v5-style HMAC signing (see buildOkxAuthHeaders) —
 *          NOTE: the exact header names for the x402 facilitator are
 *          ASSUMED from the OKX v5 REST convention pending dev-portal
 *          confirmation. Official SDK alternative: @okxweb3/x402-core /
 *          x402-express / x402-evm (not used here — zero-dependency rule).
 *
 * Adapter contract (both modes):
 *   verify(paymentPayload, paymentRequirements)
 *     -> { isValid: boolean, payer?: string, invalidReason?: string }
 *   settle(paymentPayload, paymentRequirements)
 *     -> { success: boolean, transaction?: string, network?: string,
 *          payer?: string, status?: string, errorReason?: string }
 */

import { createHash, createHmac } from 'node:crypto';

/* ------------------------------------------------------------------------ *
 *  MOCK MODE — in-process verify + deterministic settle
 * ------------------------------------------------------------------------ */

/**
 * Pull the declared amount / payer out of an exact-scheme PaymentPayload.
 * Canonical x402 shape: payload.payload.authorization.{from, value}. We also
 * accept flat {from, value} / {payer, amount} so hand-rolled demo payloads work.
 */
function extractAuthorization(paymentPayload) {
  const inner = paymentPayload?.payload?.authorization ?? paymentPayload?.payload ?? paymentPayload;
  const payer = inner?.from ?? inner?.payer ?? null;
  const value = inner?.value ?? inner?.amount ?? null;
  return { payer, value };
}

function mockVerify(paymentPayload, paymentRequirements) {
  const invalid = (invalidReason) => ({ isValid: false, invalidReason });

  if (paymentPayload === null || typeof paymentPayload !== 'object' || Array.isArray(paymentPayload)) {
    return invalid('payment payload must be a JSON object');
  }
  if (paymentPayload.scheme !== paymentRequirements.scheme) {
    return invalid(
      `scheme mismatch: payment says "${paymentPayload.scheme}", required "${paymentRequirements.scheme}"`
    );
  }
  if (paymentPayload.network !== paymentRequirements.network) {
    return invalid(
      `network mismatch: payment says "${paymentPayload.network}", required "${paymentRequirements.network}"`
    );
  }

  const { payer, value } = extractAuthorization(paymentPayload);
  if (typeof payer !== 'string' || payer.length === 0) {
    return invalid('payment payload declares no payer (payload.authorization.from)');
  }

  let declared;
  try {
    declared = BigInt(String(value));
  } catch {
    return invalid('payment payload declares no parseable amount (payload.authorization.value)');
  }
  const required = BigInt(paymentRequirements.maxAmountRequired);
  if (declared < required) {
    return invalid(
      `insufficient amount: declared ${declared} atomic units, required ${required}`
    );
  }

  return { isValid: true, payer };
}

const mockFacilitator = {
  mode: 'mock',

  async verify(paymentPayload, paymentRequirements) {
    return mockVerify(paymentPayload, paymentRequirements);
  },

  async settle(paymentPayload, paymentRequirements) {
    // Settle re-verifies (a real facilitator does too) so a payload that was
    // never verified cannot sneak through settle.
    const check = mockVerify(paymentPayload, paymentRequirements);
    if (!check.isValid) return { success: false, errorReason: check.invalidReason };

    // Deterministic fake tx hash: sha256 of the payload JSON -> 64 hex chars.
    const transaction =
      '0x' + createHash('sha256').update(JSON.stringify(paymentPayload)).digest('hex');

    return {
      success: true,
      transaction,
      network: paymentRequirements.network,
      payer: check.payer,
      status: 'success',
    };
  },
};

/* ------------------------------------------------------------------------ *
 *  REAL MODE — OKX x402 facilitator (web3.okx.com)
 * ------------------------------------------------------------------------ */

export const OKX_FACILITATOR_BASE = 'https://web3.okx.com';
const VERIFY_PATH = '/api/v6/pay/x402/verify';
const SETTLE_PATH = '/api/v6/pay/x402/settle';

/**
 * OKX v5-style request signing:
 *   OK-ACCESS-SIGN = base64( HMAC-SHA256( timestamp + method + requestPath + body, secret ) )
 *
 * !! ASSUMPTION !! The x402 facilitator endpoints are confirmed from the OKX
 * docs, but the auth header NAMES below (OK-ACCESS-KEY / OK-ACCESS-SIGN /
 * OK-ACCESS-TIMESTAMP / OK-ACCESS-PASSPHRASE) are carried over from the OKX
 * v5 REST convention and are PENDING confirmation on the OKX dev portal.
 * Verify against the portal (or switch to @okxweb3/x402-core) before go-live.
 */
export function buildOkxAuthHeaders({ apiKey, secret, passphrase }, method, requestPath, body) {
  const timestamp = new Date().toISOString();
  const sign = createHmac('sha256', secret)
    .update(timestamp + method.toUpperCase() + requestPath + body)
    .digest('base64');
  return {
    'OK-ACCESS-KEY': apiKey,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': passphrase,
    'Content-Type': 'application/json',
  };
}

function readRealCreds(env) {
  const apiKey = env.OKX_X402_API_KEY;
  const secret = env.OKX_X402_SECRET;
  const passphrase = env.OKX_X402_PASSPHRASE;
  const missing = [
    !apiKey && 'OKX_X402_API_KEY',
    !secret && 'OKX_X402_SECRET',
    !passphrase && 'OKX_X402_PASSPHRASE',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `x402 facilitator: X402_MODE=real but missing env ${missing.join(', ')}. ` +
        'Create facilitator API credentials on the OKX dev portal, or run with ' +
        'X402_MODE=mock (in-process facilitator) / X402_MODE=off (no payment gate).'
    );
  }
  return { apiKey, secret, passphrase };
}

function createRealFacilitator(env) {
  const creds = readRealCreds(env); // fail fast at construction, not first call
  const base = env.OKX_X402_FACILITATOR_URL ?? OKX_FACILITATOR_BASE;

  async function post(requestPath, paymentPayload, paymentRequirements) {
    const body = JSON.stringify({ paymentPayload, paymentRequirements });
    const res = await fetch(base + requestPath, {
      method: 'POST',
      headers: buildOkxAuthHeaders(creds, 'POST', requestPath, body),
      body,
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(
        `x402 facilitator: ${requestPath} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`
      );
    }
    if (!res.ok) {
      throw new Error(
        `x402 facilitator: ${requestPath} failed (HTTP ${res.status}): ${json.msg ?? text.slice(0, 200)}`
      );
    }
    // OKX v5-style envelope {code, msg, data} — unwrap if present.
    if (typeof json.code === 'string' && json.code !== '0') {
      throw new Error(`x402 facilitator: ${requestPath} error code ${json.code}: ${json.msg ?? ''}`);
    }
    return json.data ?? json;
  }

  return {
    mode: 'real',
    async verify(paymentPayload, paymentRequirements) {
      return post(VERIFY_PATH, paymentPayload, paymentRequirements);
    },
    async settle(paymentPayload, paymentRequirements) {
      return post(SETTLE_PATH, paymentPayload, paymentRequirements);
    },
  };
}

/* ------------------------------------------------------------------------ */

export function createFacilitator(mode, env = process.env) {
  if (mode === 'mock') return mockFacilitator;
  if (mode === 'real') return createRealFacilitator(env);
  throw new Error(`Unknown facilitator mode "${mode}" — expected "mock" or "real".`);
}
