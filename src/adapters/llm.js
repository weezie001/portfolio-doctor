/**
 * LLM narrative adapter — the ONE module through which every model call goes.
 *
 * Produces the report's prose sections ("what this means, what to do") from
 * the computed analysis. Numbers in the narrative always come from the
 * analysis engine — the LLM (or template) only wraps them in words.
 *
 * Two modes, selected by env var LLM_MODE (falls back to OKX_MODE, default
 * "mock"):
 *
 *   mock — fully working. Well-written canned templates that interpolate the
 *          real computed numbers and adapt tone to severity.
 *
 *   real — clearly marked stub. Documents the exact Anthropic API call to
 *          wire up (see generateNarrative below). Requires ANTHROPIC_API_KEY
 *          and `npm i @anthropic-ai/sdk`.
 *
 * Narrative shape (both modes):
 * {
 *   headline:      string  // one line for the report hero
 *   overview:      string  // executive summary paragraph
 *   concentration: string
 *   funding:       string
 *   idle:          string
 *   drawdown:      string
 *   closing:       string
 * }
 */

import { fmtUsd, fmtSignedUsd, fmtPct, fmtAmount, fmtNum } from '../util/format.js';

export class LlmRealModeNotWiredError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LlmRealModeNotWiredError';
  }
}

export function getConfiguredMode(env = process.env) {
  return (env.LLM_MODE ?? env.OKX_MODE ?? 'mock').toLowerCase();
}

/* ------------------------------------------------------------------------ *
 *  Shared pieces used by BOTH modes (so real mode is pre-wired)
 * ------------------------------------------------------------------------ */

export const NARRATIVE_SYSTEM_PROMPT = [
  'You are the narrative writer for "Portfolio Doctor", a one-shot crypto',
  'portfolio audit. You receive pre-computed findings as JSON facts. Write',
  'tight, plain-English commentary a retail trader can act on. Rules:',
  '- Use ONLY the numbers provided; never invent or recompute figures.',
  '- No hype, no hedging filler, no emojis. Direct, calm, specific.',
  '- 2-4 sentences per section; the headline is a single line.',
  '- Never give personalized financial advice; describe what the numbers',
  '  show and what a generic fix looks like.',
].join('\n');

/** JSON schema for the structured narrative (used with output_config.format). */
export const NARRATIVE_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    overview: { type: 'string' },
    concentration: { type: 'string' },
    funding: { type: 'string' },
    idle: { type: 'string' },
    drawdown: { type: 'string' },
    closing: { type: 'string' },
  },
  required: ['headline', 'overview', 'concentration', 'funding', 'idle', 'drawdown', 'closing'],
  additionalProperties: false,
};

/** Compact fact payload handed to the model in real mode. */
export function buildFactsPayload({ snapshot, analysis }) {
  const { concentration, funding, idle, drawdown, orders, health, fixes } = analysis;
  return {
    generatedAt: snapshot.meta.asOf,
    health: { score: health.total, band: health.band, components: health.components },
    equityUsd: drawdown.equityUsd,
    concentration: {
      level: concentration.level,
      topAsset: concentration.topAsset,
      hhi: concentration.hhi,
      normalizedHhi: concentration.normalizedHhi,
      effectiveAssets: concentration.effectiveAssets,
      dust: concentration.dust,
    },
    funding: {
      netDailyUsd: funding.netDailyUsd,
      netMonthlyUsd: funding.netMonthlyUsd,
      netAnnualUsd: funding.netAnnualUsd,
      positions: funding.positions,
      worst: funding.worst,
    },
    idle: {
      totalAnnualUsd: idle.totalAnnualUsd,
      stableAnnualUsd: idle.stableAnnualUsd,
      idleStableUsd: idle.idleStableUsd,
      opportunities: idle.opportunities,
    },
    drawdown: {
      portfolioBeta: drawdown.portfolioBeta,
      shockPct: drawdown.shockPct,
      shockLossUsd: drawdown.shockLossUsd,
      grossLeverage: drawdown.grossLeverage,
      level: drawdown.level,
    },
    staleOrders: orders.staleOrders,
    fixes,
  };
}

/* ------------------------------------------------------------------------ *
 *  MOCK MODE — canned templates over the real computed numbers
 * ------------------------------------------------------------------------ */

function recurringFixTotal(fixes) {
  return fixes
    .filter((f) => f.impactUsd !== null && f.impactPeriod === '/yr')
    .reduce((s, f) => s + f.impactUsd, 0);
}

function mockNarrative({ snapshot, analysis }) {
  const { concentration, funding, idle, drawdown, orders, health, fixes } = analysis;
  const top = concentration.topAsset;
  const worst = funding.worst;
  const yearlyUpside = recurringFixTotal(fixes);
  const urgent = health.total < 55;

  const headline = `${health.band} — ${health.total}/100. Roughly ${fmtUsd(
    yearlyUpside
  )}/yr is leaking through funding costs and idle balances, and all of it is fixable today.`;

  const overview =
    `This portfolio holds ${fmtUsd(drawdown.equityUsd)} in total equity across ` +
    `${concentration.weights.length} spot assets and ${funding.positions.length} open ` +
    `perpetual positions. It scores ${health.total}/100 (${health.band}). ` +
    (worst
      ? `The single biggest drag is funding: the ${worst.instId} ${worst.side} pays ` +
        `${fmtUsd(-worst.dailyUsd, 2)} every day to stay open — ${fmtUsd(-worst.annualUsd)} ` +
        `a year at the current rate. `
      : '') +
    (top
      ? `Concentration is the structural concern: ${top.ccy} is ${fmtPct(top.weight, 0)} of ` +
        `spot holdings, so one chart effectively decides the whole book. `
      : '') +
    `${urgent ? 'None of this is subtle, and none of it is hard to fix — ' : 'The fixes are straightforward — '}` +
    `the three ranked actions below are worth roughly ${fmtUsd(yearlyUpside)} a year ` +
    `plus a materially smaller drawdown in the next leg down.`;

  const concentrationText =
    `${top.ccy} alone is ${fmtPct(top.weight, 1)} of the spot book (${fmtUsd(top.valueUsd)}); ` +
    `the portfolio's HHI of ${concentration.hhi.toFixed(2)} means it behaves like just ` +
    `${fmtNum(concentration.effectiveAssets, 1)} equally-weighted positions despite listing ` +
    `${concentration.weights.length} assets. That reads as "${concentration.level}". ` +
    (concentration.dust.length > 0
      ? `At the other end, ${concentration.dust.map((d) => d.ccy).join(' and ')} ` +
        `(${fmtUsd(concentration.dustTotalUsd)} combined) are dust — too small to move ` +
        `the needle, still occupying attention. `
      : '') +
    `Trimming the ${top.ccy} weight toward 50% converts single-name risk into optionality ` +
    `without giving up the core position.`;

  const fundingText = worst
    ? `Across ${funding.positions.length} perp positions the net funding flow is ` +
      `${fmtSignedUsd(funding.netDailyUsd, 2)}/day (${fmtSignedUsd(funding.netMonthlyUsd)}/month). ` +
      `The bleeder is the ${worst.instId} ${worst.side}: at ${fmtPct(worst.rate8h, 4)} per 8h ` +
      `it costs ${fmtUsd(-worst.dailyUsd, 2)}/day, which annualizes to ` +
      `${fmtPct(Math.abs(worst.annualPctOfNotional))} of notional — you are paying hedge-fund ` +
      `fees for a directional bet. ` +
      (funding.earners.length > 0
        ? `Credit where due: the ${funding.earners[0].instId} ${funding.earners[0].side} is on ` +
          `the right side of funding and collects ${fmtUsd(funding.earners[0].dailyUsd, 2)}/day. `
        : '') +
      `If the long thesis stands, spot carries it for free.`
    : `No open perpetual positions are paying funding right now — nothing to fix here.`;

  const idleText =
    `${fmtUsd(idle.idleStableUsd)} of stablecoins sits at 0% while flexible Earn pays out ` +
    `daily — that alone is ${fmtUsd(idle.stableAnnualUsd)}/yr left on the table with ` +
    `same-day redemption. Including staking on majors already held ` +
    `(${idle.opportunities
      .filter((o) => !o.isStable)
      .map((o) => o.ccy)
      .join(', ')}), the total un-earned yield is ${fmtUsd(idle.totalAnnualUsd)}/yr. ` +
    `Idle cash is a position too — currently a losing one after inflation.`;

  const drawdownText =
    `Weighted by holdings and open perps, the portfolio's beta to BTC is ` +
    `${drawdown.portfolioBeta.toFixed(2)} (${drawdown.level}) with gross exposure of ` +
    `${fmtNum(drawdown.grossLeverage, 2)}x equity. In a ${fmtPct(drawdown.shockPct, 0)} BTC ` +
    `week — routine for crypto — expect roughly ${fmtUsd(drawdown.shockLossUsd)} of equity ` +
    `to evaporate, leaving ${fmtUsd(drawdown.equityAfterShockUsd)}. The concentration trim ` +
    `and the perp resize in the fix list are also the two fastest ways to pull this number down.`;

  const closing =
    `Work the list top-down: fix 1 stops an active leak, fix 2 removes the tail risk, ` +
    `fix 3 starts compounding in your favor` +
    (orders.staleOrders.length > 0
      ? `, and while you are in there, cancel the ${orders.staleOrders.length} stale ` +
        `order${orders.staleOrders.length > 1 ? 's' : ''} flagged in the appendix`
      : '') +
    `. Re-run the audit after making changes — the score is designed to move.`;

  return {
    headline,
    overview,
    concentration: concentrationText,
    funding: fundingText,
    idle: idleText,
    drawdown: drawdownText,
    closing,
  };
}

const mockLlmAdapter = {
  mode: 'mock',
  async generateNarrative(input) {
    return mockNarrative(input);
  },
};

/* ------------------------------------------------------------------------ *
 *  REAL MODE — STUB (no ANTHROPIC_API_KEY exists yet)
 *
 *  Wiring plan:
 *    1. npm i @anthropic-ai/sdk
 *    2. Set ANTHROPIC_API_KEY in the environment.
 *    3. Replace the throw below with:
 *
 *       import Anthropic from '@anthropic-ai/sdk';
 *       const client = new Anthropic(); // reads ANTHROPIC_API_KEY
 *       const response = await client.messages.create({
 *         model: process.env.LLM_MODEL ?? 'claude-opus-4-8',
 *         max_tokens: 2048,
 *         system: NARRATIVE_SYSTEM_PROMPT,
 *         output_config: {
 *           format: { type: 'json_schema', schema: NARRATIVE_SCHEMA },
 *         },
 *         messages: [{
 *           role: 'user',
 *           content:
 *             'Write the audit narrative for these computed findings:\n' +
 *             JSON.stringify(buildFactsPayload(input)),
 *         }],
 *       });
 *       const text = response.content.find((b) => b.type === 'text')?.text;
 *       return JSON.parse(text); // schema-constrained -> safe to parse
 *
 *  Notes (current Claude API):
 *    - claude-opus-4-8 takes no temperature/top_p/top_k (400 if sent).
 *    - output_config.format guarantees the response matches NARRATIVE_SCHEMA.
 *    - Raw REST equivalent: POST https://api.anthropic.com/v1/messages with
 *      headers x-api-key, anthropic-version: 2023-06-01.
 * ------------------------------------------------------------------------ */

const realLlmAdapter = {
  mode: 'real',
  // REAL MODE STUB — see wiring plan in the block comment above.
  async generateNarrative(input) {
    // Payload is already buildable today; only the API call is missing:
    void buildFactsPayload(input);
    throw new LlmRealModeNotWiredError(
      [
        'llm adapter: LLM_MODE=real but real mode is not wired yet.',
        'When wiring, this method will POST /v1/messages (Anthropic) with:',
        `  model:  ${process.env.LLM_MODEL ?? 'claude-opus-4-8'}`,
        '  system: NARRATIVE_SYSTEM_PROMPT (exported from src/adapters/llm.js)',
        '  output_config.format: json_schema NARRATIVE_SCHEMA (exported)',
        '  user:   JSON.stringify(buildFactsPayload({ snapshot, analysis }))',
        'Requires: npm i @anthropic-ai/sdk and ANTHROPIC_API_KEY.',
        'Run with LLM_MODE=mock (the default) for well-written canned narrative,',
        'or follow the "Real mode wiring" checklist in STATUS.md.',
      ].join('\n')
    );
  },
};

/* ------------------------------------------------------------------------ */

export function createLlmAdapter(mode = getConfiguredMode()) {
  if (mode === 'mock') return mockLlmAdapter;
  if (mode === 'real') return realLlmAdapter;
  throw new Error(`Unknown LLM_MODE "${mode}" — expected "mock" or "real".`);
}
