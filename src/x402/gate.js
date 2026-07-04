/**
 * x402 payment gate — HTTP 402 pay-per-call handshake for gated routes.
 *
 * Implements the x402 standard flow for POST /api/audit (the listed A2MCP
 * service: one call = one audit = 3 USDT, settled via the OKX facilitator):
 *
 *   1. Client calls the gated route with no payment header.
 *   2. Server replies 402 with header
 *        PAYMENT-REQUIRED: <base64(JSON {x402Version, resource, accepts})>
 *      (the FULL challenge object — OKX's validator and `onchainos payment pay`
 *      both expect `accepts[]` inside the decoded header) plus a JSON body
 *      echoing the same challenge.
 *   3. Client signs the chosen accepts[] entry and retries with
 *        PAYMENT-SIGNATURE: <authorization header from `onchainos payment pay`>  (v2)
 *      or the legacy v1 form
 *        X-PAYMENT: <base64(JSON PaymentPayload)>
 *   4. Server verify()s then settle()s via the facilitator adapter
 *      (src/adapters/facilitator.js); on success the normal handler runs and
 *      the response carries
 *        PAYMENT-RESPONSE: <base64(JSON settle receipt)>
 *      On any failure the server replies 402 again with an `error` field.
 *
 * Modes (env X402_MODE, default "off"):
 *   off  — gate disabled; routes behave exactly as before this layer existed.
 *   mock — in-process facilitator (demo / tests, no network).
 *   real — OKX x402 facilitator over HTTPS (needs OKX_X402_* creds).
 */

import { createFacilitator } from '../adapters/facilitator.js';

export const X402_VERSION = 1;
export const USDT_DECIMALS = 6;

/** X Layer mainnet (chain id 196) — where the listed service settles USDT. */
export const X402_NETWORK = 'eip155:196';
/** USDT contract on X Layer. */
export const X402_USDT_ASSET = '0x779ded0c9e1022225f8e0630b35a9b54be713736';
/** LISTING.md fee: 3 USDT per audit call. */
export const DEFAULT_PRICE_USDT = '3';

/* ------------------------------- helpers --------------------------------- */

export function getX402Mode(env = process.env) {
  const mode = (env.X402_MODE ?? 'off').toLowerCase();
  if (!['off', 'mock', 'real'].includes(mode)) {
    throw new Error(`Unknown X402_MODE "${env.X402_MODE}" — expected "off", "mock" or "real".`);
  }
  return mode;
}

/**
 * Human USDT amount -> atomic units as a decimal string (6 dp, exact integer
 * math — no floats). "3" -> "3000000", "0.5" -> "500000".
 */
export function toAtomicAmount(amount, decimals = USDT_DECIMALS) {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(amount).trim());
  if (!m) throw new Error(`x402: invalid amount "${amount}" — expected a non-negative decimal.`);
  const [, whole, frac = ''] = m;
  if (frac.length > decimals) {
    throw new Error(`x402: amount "${amount}" exceeds ${decimals} decimal places (USDT precision).`);
  }
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0')).toString();
}

export function encodeB64Json(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
}

export function decodeB64Json(b64) {
  return JSON.parse(Buffer.from(String(b64), 'base64').toString('utf8'));
}

/* --------------------------- PaymentRequirements -------------------------- */

/** The PaymentRequirements challenge advertised for POST /api/audit. */
export function buildPaymentRequirements(env = process.env) {
  return {
    x402Version: X402_VERSION,
    scheme: 'exact',
    network: X402_NETWORK,
    maxAmountRequired: toAtomicAmount(env.X402_PRICE_USDT ?? DEFAULT_PRICE_USDT), // 3 USDT × 10^6
    resource: '/api/audit',
    description: 'Scored 0-100 crypto portfolio audit with ranked fixes',
    mimeType: 'application/json',
    payTo: env.X402_PAY_TO || '0xREPLACE_OWNER_WALLET',
    maxTimeoutSeconds: 60,
    asset: X402_USDT_ASSET,
    extra: { name: 'USDT', decimals: USDT_DECIMALS },
  };
}

/* --------------------------------- gate ----------------------------------- */

/**
 * Build the gate for one route. Returns:
 *   { mode, enabled, requirements?, check(req) }
 *
 * check(req) resolves to either
 *   { ok: true, receipt?, responseHeaders? }   -> run the normal handler,
 *       merging responseHeaders (PAYMENT-RESPONSE) into the 2xx response; or
 *   { ok: false, status: 402, headers, body }  -> send the 402 challenge.
 *
 * X402_MODE=off yields a no-op gate so untouched deployments behave exactly
 * as before. In real mode, missing OKX_X402_* creds throw here (fail fast at
 * server construction, not on the first paid call).
 */
export function createX402Gate({ env = process.env, facilitator } = {}) {
  const mode = getX402Mode(env);
  if (mode === 'off') {
    return { mode, enabled: false, check: async () => ({ ok: true }) };
  }

  const fac = facilitator ?? createFacilitator(mode, env);
  const requirements = buildPaymentRequirements(env);
  // Full v2 challenge: OKX's x402-check and `onchainos payment pay` decode the
  // PAYMENT-REQUIRED header and read `accepts[]` from it — a bare
  // PaymentRequirements object is reported as "accepts is empty".
  const challengePayload = {
    x402Version: X402_VERSION,
    resource: requirements.resource,
    accepts: [requirements],
  };

  const challenge = (error) => ({
    ok: false,
    status: 402,
    headers: { 'PAYMENT-REQUIRED': encodeB64Json(challengePayload) },
    body: {
      ok: false,
      x402Version: X402_VERSION,
      resource: requirements.resource,
      error,
      accepts: [requirements],
    },
  });

  return {
    mode,
    enabled: true,
    requirements,
    challengePayload,

    async check(req) {
      // v2 (OKX `payment pay` replay header) first, legacy v1 X-PAYMENT second.
      const header = req.headers['payment-signature'] ?? req.headers['x-payment'];
      if (!header) {
        return challenge(
          'Payment required: sign an accepts[] entry from the PAYMENT-REQUIRED challenge and ' +
            'retry with a PAYMENT-SIGNATURE header (v2, from `onchainos payment pay`) or a ' +
            'legacy X-PAYMENT header (base64 PaymentPayload).'
        );
      }

      let paymentPayload;
      try {
        paymentPayload = decodeB64Json(header);
      } catch {
        return challenge('Payment header is not valid base64-encoded JSON.');
      }

      let verdict;
      try {
        verdict = await fac.verify(paymentPayload, requirements);
      } catch (err) {
        return challenge(`Payment verification failed: ${err.message}`);
      }
      if (!verdict?.isValid) {
        return challenge(verdict?.invalidReason ?? 'Payment verification failed.');
      }

      let receipt;
      try {
        receipt = await fac.settle(paymentPayload, requirements);
      } catch (err) {
        return challenge(`Payment settlement failed: ${err.message}`);
      }
      if (!receipt?.success) {
        return challenge(receipt?.errorReason ?? 'Payment settlement failed.');
      }

      return {
        ok: true,
        receipt,
        responseHeaders: { 'PAYMENT-RESPONSE': encodeB64Json(receipt) },
      };
    },
  };
}
