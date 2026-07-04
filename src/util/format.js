/**
 * Formatting helpers shared by the CLI summary, report renderer, and
 * mock-narrative templates. Locale is pinned to en-US so output is
 * deterministic regardless of the host machine's locale.
 */

/** "$1,234" / "-$1,234.56" */
export function fmtUsd(n, dp = 0) {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })}`;
}

/** "+$120" / "-$120" — explicit sign, for P&L-style values */
export function fmtSignedUsd(n, dp = 0) {
  return n >= 0 ? `+${fmtUsd(n, dp)}` : fmtUsd(n, dp);
}

/** 0.0623 -> "6.2%" (input is a decimal fraction) */
export function fmtPct(x, dp = 1) {
  return `${(x * 100).toFixed(dp)}%`;
}

/** Plain number with fixed decimals and thousands separators. */
export function fmtNum(n, dp = 2) {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

/** Coin amounts: sensible decimals across magnitudes (12,000,000 PEPE vs 0.85 BTC). */
export function fmtAmount(n) {
  const abs = Math.abs(n);
  let dp;
  if (abs >= 1000) dp = 0;
  else if (abs >= 1) dp = 2;
  else if (abs >= 0.01) dp = 4;
  else dp = 8;
  return n.toLocaleString('en-US', { maximumFractionDigits: dp });
}

/** Round to n decimal places (default 2) without float noise in the common cases. */
export function round(n, dp = 2) {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}
