#!/usr/bin/env node
/**
 * Portfolio Doctor CLI.
 *
 *   node src/index.js audit [--out <dir>]
 *   npm run audit
 *
 * Env:
 *   OKX_MODE=mock|real   data source (default mock — fully working demo)
 *   LLM_MODE=mock|real   narrative source (defaults to OKX_MODE)
 */

import { runAudit } from './audit.js';
import { fmtUsd, fmtSignedUsd, fmtNum, fmtPct } from './util/format.js';

const USAGE = `Portfolio Doctor — one-shot crypto portfolio audit

Usage:
  node src/index.js audit [--out <dir>]     run the audit, write the HTML report
  npm run audit

Environment:
  OKX_MODE=mock|real   exchange data source   (default: mock)
  LLM_MODE=mock|real   narrative source       (default: OKX_MODE)
`;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--out') opts.outDir = rest[++i];
    else if (rest[i] === '--help' || rest[i] === '-h') opts.help = true;
    else {
      console.error(`Unknown argument: ${rest[i]}\n`);
      return { command: null, opts };
    }
  }
  return { command, opts };
}

function line(char = '-', n = 62) {
  return char.repeat(n);
}

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));

  if (!command || opts.help || command !== 'audit') {
    console.log(USAGE);
    process.exitCode = command && command !== 'audit' ? 1 : 0;
    return;
  }

  const started = Date.now();
  const { reportPath, analysis, mode } = await runAudit(opts);
  const { health, drawdown, funding, idle, concentration, fixes } = analysis;

  console.log(line('='));
  console.log('  PORTFOLIO DOCTOR — audit complete');
  console.log(line('='));
  console.log(`  Data mode        ${mode}${mode === 'mock' ? '  (demo data — set OKX_MODE=real once keys are wired)' : ''}`);
  console.log(`  Health score     ${health.total}/100  [${health.band}]`);
  for (const c of health.components) {
    console.log(`    - ${c.label.padEnd(20)} ${String(fmtNum(c.earned, 1)).padStart(5)} / ${c.max}`);
  }
  console.log(line());
  console.log(`  Total equity     ${fmtUsd(drawdown.equityUsd)}`);
  console.log(`  Top holding      ${concentration.topAsset.ccy} at ${fmtPct(concentration.topAsset.weight, 1)} of spot (${concentration.level})`);
  console.log(`  Net funding      ${fmtSignedUsd(funding.netDailyUsd, 2)}/day (${fmtSignedUsd(funding.netMonthlyUsd)}/month)`);
  console.log(`  Idle yield       ${fmtUsd(idle.totalAnnualUsd)}/yr un-earned (${fmtUsd(idle.idleStableUsd)} idle stables)`);
  console.log(`  Beta to BTC      ${fmtNum(drawdown.portfolioBeta, 2)} (${drawdown.level}); -20% BTC => -${fmtUsd(drawdown.shockLossUsd)}`);
  console.log(line());
  console.log('  Top fixes:');
  for (const f of fixes) {
    const impact = f.impactUsd !== null ? `${fmtUsd(f.impactUsd)}${f.impactPeriod}` : 'hygiene';
    console.log(`    ${f.rank}. ${f.title}  [${impact}]`);
  }
  console.log(line());
  console.log(`  Report           ${reportPath}`);
  console.log(`  Done in ${Date.now() - started} ms. Open the report in a browser; print to PDF from there.`);
  console.log(line('='));
}

main().catch((err) => {
  console.error(`\n${err.name ?? 'Error'}: ${err.message}`);
  process.exitCode = 1;
});
