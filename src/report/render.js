/**
 * Report renderer — one self-contained HTML file: inline CSS, inline SVG
 * gauge, system font stack, zero external requests. Dark theme on screen,
 * automatically flips to a print-friendly light palette via @media print
 * (so "Print to PDF" from any browser produces a clean document).
 */

import { fmtUsd, fmtSignedUsd, fmtPct, fmtNum, fmtAmount } from '../util/format.js';

const C = {
  red: '#f87171',
  orange: '#fb923c',
  yellow: '#facc15',
  green: '#4ade80',
  teal: '#34d399',
  accent: '#2dd4bf',
};

const BAND_COLORS = {
  Excellent: C.teal,
  Healthy: C.green,
  'Needs Work': C.yellow,
  'At Risk': C.orange,
  Critical: C.red,
};

const CONCENTRATION_COLORS = {
  'heavily concentrated': C.red,
  concentrated: C.orange,
  'moderately concentrated': C.yellow,
  'well diversified': C.green,
};

const DRAWDOWN_COLORS = {
  defensive: C.green,
  moderate: C.teal,
  'market-level': C.yellow,
  elevated: C.orange,
  aggressive: C.red,
};

export function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/* ----------------------------- gauge (SVG) ------------------------------ */

function polar(cx, cy, r, deg) {
  const a = ((deg - 90) * Math.PI) / 180; // 0 deg = 12 o'clock, clockwise
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arcPath(cx, cy, r, startDeg, endDeg) {
  const [sx, sy] = polar(cx, cy, r, startDeg);
  const [ex, ey] = polar(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
}

function gaugeSvg(score, band) {
  const color = BAND_COLORS[band] ?? C.yellow;
  const start = -120;
  const sweep = 240;
  const end = start + (sweep * Math.max(0, Math.min(100, score))) / 100;
  const cx = 110;
  const cy = 108;
  const r = 82;
  return `
  <svg viewBox="0 0 220 168" role="img" aria-label="Health score ${score} of 100" style="width:100%;max-width:280px">
    <path d="${arcPath(cx, cy, r, start, start + sweep)}" fill="none" stroke="var(--track)" stroke-width="15" stroke-linecap="round"/>
    <path d="${arcPath(cx, cy, r, start, Math.max(end, start + 1))}" fill="none" stroke="${color}" stroke-width="15" stroke-linecap="round"/>
    <text x="${cx}" y="${cy + 2}" text-anchor="middle" fill="var(--text)" font-size="46" font-weight="750" font-family="inherit">${score}</text>
    <text x="${cx}" y="${cy + 24}" text-anchor="middle" fill="var(--muted)" font-size="11" letter-spacing="2" font-family="inherit">OF 100</text>
    <text x="${cx}" y="${cy + 52}" text-anchor="middle" fill="${color}" font-size="17" font-weight="700" font-family="inherit">${escapeHtml(band).toUpperCase()}</text>
  </svg>`;
}

/* ----------------------------- small parts ------------------------------ */

function chip(text, color) {
  return `<span class="chip" style="color:${color};border-color:${color}55;background:${color}14">${escapeHtml(text)}</span>`;
}

function bar(frac, color) {
  const w = Math.max(0, Math.min(100, frac * 100));
  return `<span class="bar"><span class="bar-fill" style="width:${w.toFixed(1)}%;background:${color}"></span></span>`;
}

function statCell(label, value, sub = '', valueColor = 'var(--text)') {
  return `
    <div class="stat">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value" style="color:${valueColor}">${value}</div>
      ${sub ? `<div class="stat-sub">${escapeHtml(sub)}</div>` : ''}
    </div>`;
}

function sectionHeader(num, title, chipHtml = '') {
  return `
    <div class="sec-head">
      <span class="sec-num">${num}</span>
      <h2>${escapeHtml(title)}</h2>
      ${chipHtml}
    </div>`;
}

/* ------------------------------ sections -------------------------------- */

function holdingsTable(concentration) {
  const maxW = concentration.topAsset?.weight ?? 1;
  const rows = concentration.weights
    .map(
      (r) => `
      <tr>
        <td><strong>${escapeHtml(r.ccy)}</strong></td>
        <td class="num">${fmtAmount(r.amount)}</td>
        <td class="num">${fmtUsd(r.valueUsd, 2)}</td>
        <td class="num">${fmtPct(r.weight, 1)}</td>
        <td class="w-bar">${bar(r.weight / maxW, r.weight >= 0.5 ? C.orange : 'var(--accent)')}</td>
      </tr>`
    )
    .join('');
  return `
    <table>
      <thead><tr><th>Asset</th><th class="num">Amount</th><th class="num">Value</th><th class="num">Weight</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function fundingTable(funding) {
  const rows = funding.positions
    .map((p) => {
      const flow = p.dailyUsd < 0 ? C.red : C.green;
      return `
      <tr>
        <td><strong>${escapeHtml(p.instId)}</strong></td>
        <td>${escapeHtml(p.side)} ${p.lever}x</td>
        <td class="num">${fmtAmount(p.size)} ${escapeHtml(p.sizeCcy)}</td>
        <td class="num">${fmtUsd(p.notionalUsd)}</td>
        <td class="num">${fmtPct(p.rate8h, 4)}</td>
        <td class="num" style="color:${flow}">${fmtSignedUsd(p.dailyUsd, 2)}</td>
        <td class="num" style="color:${flow}">${fmtSignedUsd(p.monthlyUsd)}</td>
        <td class="num" style="color:${flow}">${fmtPct(p.annualPctOfNotional, 1)}</td>
      </tr>`;
    })
    .join('');
  const netColor = funding.netDailyUsd < 0 ? C.red : C.green;
  return `
    <table>
      <thead><tr>
        <th>Instrument</th><th>Side</th><th class="num">Size</th><th class="num">Notional</th>
        <th class="num">Rate / 8h</th><th class="num">$ / day</th><th class="num">$ / month</th><th class="num">APR of notional</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="5"><strong>Net funding flow</strong></td>
        <td class="num" style="color:${netColor}"><strong>${fmtSignedUsd(funding.netDailyUsd, 2)}</strong></td>
        <td class="num" style="color:${netColor}"><strong>${fmtSignedUsd(funding.netMonthlyUsd)}</strong></td>
        <td class="num" style="color:${netColor}"><strong>${fmtSignedUsd(funding.netAnnualUsd)}/yr</strong></td>
      </tr></tfoot>
    </table>`;
}

function idleTable(idle) {
  const rows = idle.opportunities
    .map(
      (o) => `
      <tr>
        <td><strong>${escapeHtml(o.ccy)}</strong>${o.isStable ? ' <span class="tag">stable</span>' : ''}</td>
        <td class="num">${fmtAmount(o.amount)}</td>
        <td class="num">${fmtUsd(o.valueUsd)}</td>
        <td>${escapeHtml(o.product)}</td>
        <td class="num">${fmtPct(o.apy, 1)}</td>
        <td class="num" style="color:${C.green}">+${fmtUsd(o.annualUsd)}</td>
      </tr>`
    )
    .join('');
  return `
    <table>
      <thead><tr>
        <th>Asset</th><th class="num">Idle balance</th><th class="num">Value</th>
        <th>Best available product</th><th class="num">APY</th><th class="num">Missed / yr</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="5"><strong>Total un-earned yield</strong></td>
        <td class="num" style="color:${C.green}"><strong>+${fmtUsd(idle.totalAnnualUsd)}/yr</strong></td>
      </tr></tfoot>
    </table>`;
}

function ordersTable(orders) {
  if (orders.count === 0) return '<p class="muted">No open orders.</p>';
  const rows = orders.orders
    .map(
      (o) => `
      <tr>
        <td><strong>${escapeHtml(o.instId)}</strong></td>
        <td>${escapeHtml(o.side)} ${escapeHtml(o.ordType)}</td>
        <td class="num">${fmtUsd(o.px, o.px < 10 ? 2 : 0)}</td>
        <td class="num">${fmtAmount(o.sz)}</td>
        <td class="num">${fmtUsd(o.valueUsd)}</td>
        <td class="num">${fmtPct(o.distancePct, 1)}</td>
        <td class="num">${fmtNum(o.ageDays, 0)}d</td>
        <td>${o.stale ? chip('STALE', C.orange) : '<span class="muted">ok</span>'}</td>
      </tr>`
    )
    .join('');
  return `
    <table>
      <thead><tr>
        <th>Instrument</th><th>Order</th><th class="num">Limit px</th><th class="num">Size</th>
        <th class="num">Value</th><th class="num">From mark</th><th class="num">Age</th><th>Status</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function scoreBreakdown(health) {
  return health.components
    .map((c) => {
      const frac = c.earned / c.max;
      const color = frac >= 0.7 ? C.green : frac >= 0.45 ? C.yellow : frac >= 0.25 ? C.orange : C.red;
      return `
      <div class="score-row" title="${escapeHtml(c.detail)}">
        <span class="score-label">${escapeHtml(c.label)}</span>
        ${bar(frac, color)}
        <span class="score-pts">${fmtNum(c.earned, 1)}<span class="muted"> / ${c.max}</span></span>
      </div>`;
    })
    .join('');
}

function fixCards(fixes) {
  return fixes
    .map(
      (f) => `
    <div class="fix">
      <div class="fix-rank">${f.rank}</div>
      <div class="fix-body">
        <h3>${escapeHtml(f.title)}</h3>
        <p>${escapeHtml(f.action)}</p>
      </div>
      <div class="fix-impact">
        ${
          f.impactUsd !== null
            ? `<div class="fix-usd">${fmtUsd(f.impactUsd)}</div><div class="fix-per">${escapeHtml(f.impactPeriod)}</div>`
            : '<div class="fix-per">hygiene</div>'
        }
      </div>
    </div>`
    )
    .join('');
}

function methodology(health) {
  const items = health.components
    .map(
      (c) =>
        `<li><strong>${escapeHtml(c.label)} (${c.max} pts):</strong> ${escapeHtml(c.detail)} — earned ${fmtNum(c.earned, 1)}.</li>`
    )
    .join('');
  return `
    <ul class="method">
      ${items}
      <li><strong>Bands:</strong> 85+ Excellent · 70–84 Healthy · 55–69 Needs Work · 40–54 At Risk · &lt;40 Critical.</li>
    </ul>`;
}

/* ------------------------------ page shell ------------------------------ */

export function renderReport({ snapshot, analysis, narrative, generatedAt = new Date() }) {
  const { concentration, funding, idle, drawdown, orders, health, fixes } = analysis;
  const isMock = snapshot.meta.mode === 'mock';
  const bandColor = BAND_COLORS[health.band] ?? C.yellow;
  const concColor = CONCENTRATION_COLORS[concentration.level] ?? C.yellow;
  const ddColor = DRAWDOWN_COLORS[drawdown.level] ?? C.yellow;
  const when = generatedAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Portfolio Doctor — audit ${escapeHtml(when)}</title>
<style>
  :root{
    --bg:#0b0f16; --panel:#10192a; --panel-2:#0d1420; --line:#1d2940; --track:#1c2a44;
    --text:#e8edf6; --muted:#8b98ad; --faint:#5d6a80; --accent:${C.accent};
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html{background:var(--bg)}
  body{
    font-family:-apple-system,'Segoe UI',system-ui,Roboto,'Helvetica Neue',Arial,sans-serif;
    background:
      radial-gradient(1100px 480px at 78% -10%, #12233c 0%, transparent 60%),
      radial-gradient(900px 420px at -10% 4%, #0f2030 0%, transparent 55%),
      var(--bg);
    color:var(--text); line-height:1.55; -webkit-font-smoothing:antialiased;
  }
  .wrap{max-width:940px;margin:0 auto;padding:44px 28px 64px}
  a{color:var(--accent)}

  /* header */
  header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:18px;flex-wrap:wrap}
  .brand{display:flex;align-items:center;gap:13px}
  .brand-mark{width:42px;height:42px;border-radius:11px;background:linear-gradient(135deg,#134e4a,#0f2f44);
    border:1px solid #1f5f57;display:grid;place-items:center;flex:none}
  .brand h1{font-size:21px;font-weight:750;letter-spacing:.2px}
  .brand .sub{font-size:12.5px;color:var(--muted);margin-top:1px}
  .meta{text-align:right;font-size:12.5px;color:var(--muted);line-height:1.7}
  .chip{display:inline-block;border:1px solid;border-radius:999px;padding:2px 11px;font-size:11px;
    font-weight:700;letter-spacing:.8px;text-transform:uppercase;vertical-align:middle}
  .banner{border:1px solid ${C.orange}66;background:${C.orange}12;color:${C.orange};
    border-radius:10px;padding:9px 15px;font-size:13px;margin-bottom:26px}

  /* cards & layout */
  .card{background:linear-gradient(180deg,var(--panel),var(--panel-2));border:1px solid var(--line);
    border-radius:15px;padding:26px 28px;margin-bottom:22px}
  .hero{display:grid;grid-template-columns:300px 1fr;gap:22px;margin-bottom:22px}
  @media(max-width:760px){.hero{grid-template-columns:1fr}}
  .gauge-card{display:flex;flex-direction:column;align-items:center;text-align:center}
  .headline{font-size:17.5px;font-weight:650;line-height:1.5;margin-bottom:12px}
  .muted{color:var(--muted)} .faint{color:var(--faint)}
  p.body{color:var(--muted);font-size:14px;margin-top:8px}

  /* stats strip */
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-top:18px}
  .stat{background:#0c1322;border:1px solid var(--line);border-radius:11px;padding:12px 14px}
  .stat-label{font-size:10.5px;letter-spacing:1.1px;text-transform:uppercase;color:var(--faint);margin-bottom:5px}
  .stat-value{font-size:17px;font-weight:700;font-variant-numeric:tabular-nums}
  .stat-sub{font-size:11.5px;color:var(--muted);margin-top:2px}

  /* score breakdown */
  .score-rows{width:100%;margin-top:14px;display:flex;flex-direction:column;gap:9px}
  .score-row{display:grid;grid-template-columns:118px 1fr 64px;align-items:center;gap:10px;font-size:12.5px}
  .score-label{color:var(--muted);text-align:left}
  .score-pts{text-align:right;font-variant-numeric:tabular-nums;font-weight:650}
  .bar{display:block;height:7px;border-radius:99px;background:var(--track);overflow:hidden}
  .bar-fill{display:block;height:100%;border-radius:99px}

  /* sections */
  .sec-head{display:flex;align-items:center;gap:12px;margin-bottom:10px}
  .sec-num{font-size:11px;font-weight:800;color:var(--accent);border:1px solid var(--accent);
    border-radius:7px;padding:2px 8px;letter-spacing:1px}
  h2{font-size:17px;font-weight:700;letter-spacing:.2px}
  table{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}
  th{color:var(--faint);text-transform:uppercase;font-size:10.5px;letter-spacing:1px;
    text-align:left;padding:0 10px 8px;font-weight:650}
  td{padding:8px 10px;border-top:1px solid var(--line);vertical-align:middle}
  tfoot td{border-top:2px solid var(--line)}
  .num,th.num{text-align:right;font-variant-numeric:tabular-nums;
    font-family:'Cascadia Code',Consolas,ui-monospace,Menlo,monospace;font-size:12.5px}
  th.num{font-family:inherit}
  .w-bar{width:130px}
  .tag{font-size:9.5px;color:var(--accent);border:1px solid var(--accent);border-radius:5px;
    padding:0 5px;letter-spacing:.6px;vertical-align:1px}

  /* fixes */
  .fix{display:grid;grid-template-columns:52px 1fr 128px;gap:16px;align-items:center;
    border:1px solid var(--line);background:#0c1322;border-radius:13px;padding:18px 20px;margin-top:12px}
  .fix-rank{font-size:26px;font-weight:800;color:var(--accent);text-align:center;
    border-right:1px solid var(--line)}
  .fix-body h3{font-size:15px;font-weight:700;margin-bottom:5px}
  .fix-body p{font-size:13px;color:var(--muted)}
  .fix-impact{text-align:right}
  .fix-usd{font-size:19px;font-weight:800;color:${C.green};font-variant-numeric:tabular-nums}
  .fix-per{font-size:11px;color:var(--faint)}
  @media(max-width:640px){.fix{grid-template-columns:40px 1fr}.fix-impact{grid-column:2;text-align:left}}

  .method{list-style:none;margin-top:10px;display:flex;flex-direction:column;gap:7px}
  .method li{font-size:12.5px;color:var(--muted);padding-left:16px;position:relative}
  .method li::before{content:'·';position:absolute;left:2px;color:var(--accent);font-weight:900}

  footer{margin-top:34px;border-top:1px solid var(--line);padding-top:18px;
    font-size:11.5px;color:var(--faint);line-height:1.8}

  /* print: flip to light, keep structure */
  @media print{
    :root{--bg:#ffffff;--panel:#ffffff;--panel-2:#fafbfd;--line:#d8dee9;--track:#e5e9f2;
      --text:#16202e;--muted:#4a5568;--faint:#718096}
    body{background:#fff}
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .card,.fix{break-inside:avoid}
    .wrap{padding:0 4mm}
  }
  @page{margin:13mm}
</style>
</head>
<body>
<div class="wrap">

  <header>
    <div class="brand">
      <div class="brand-mark">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M3 13h4l2.2-6 3.6 11 2.6-8 1.6 3H21" stroke="${C.accent}" stroke-width="2.1"
            stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div>
        <h1>Portfolio Doctor</h1>
        <div class="sub">One-shot portfolio audit · read-only</div>
      </div>
    </div>
    <div class="meta">
      ${escapeHtml(snapshot.meta.accountLabel)}<br>
      Generated ${escapeHtml(when)} &nbsp;·&nbsp; ${chip(isMock ? 'mock data' : 'live data', isMock ? C.orange : C.green)}
    </div>
  </header>

  ${
    isMock
      ? '<div class="banner"><strong>Demo report.</strong> Generated from mock data (OKX_MODE=mock) — numbers are realistic but not a live account.</div>'
      : ''
  }

  <div class="hero">
    <div class="card gauge-card">
      <div class="stat-label" style="margin-bottom:2px">Portfolio health</div>
      ${gaugeSvg(health.total, health.band)}
      <div class="score-rows">${scoreBreakdown(health)}</div>
    </div>
    <div class="card">
      <div class="headline">${escapeHtml(narrative.headline)}</div>
      <p class="body">${escapeHtml(narrative.overview)}</p>
      <div class="stats">
        ${statCell('Total equity', fmtUsd(drawdown.equityUsd))}
        ${statCell('Spot holdings', fmtUsd(drawdown.spotValueUsd), `${concentration.weights.length} assets`)}
        ${statCell('Perp notional', fmtUsd(drawdown.grossPerpNotionalUsd), `${funding.positions.length} positions`)}
        ${statCell('Net funding', `${fmtSignedUsd(funding.netDailyUsd, 2)}/d`, `${fmtSignedUsd(funding.netMonthlyUsd)}/mo`, funding.netDailyUsd < 0 ? C.red : C.green)}
        ${statCell('Idle yield missed', `${fmtUsd(idle.totalAnnualUsd)}/yr`, 'vs current Earn rates', C.yellow)}
        ${statCell('Beta to BTC', fmtNum(drawdown.portfolioBeta, 2), drawdown.level, ddColor)}
      </div>
    </div>
  </div>

  <div class="card">
    ${sectionHeader('01', 'Concentration', chip(concentration.level, concColor))}
    <p class="body">${escapeHtml(narrative.concentration)}</p>
    ${holdingsTable(concentration)}
    <p class="body faint" style="font-size:12px">
      HHI ${concentration.hhi.toFixed(3)} · normalized ${concentration.normalizedHhi.toFixed(2)} ·
      behaves like ${fmtNum(concentration.effectiveAssets, 1)} equal-weight positions ·
      dust threshold ${fmtUsd(concentration.dustThresholdUsd)}
    </p>
  </div>

  <div class="card">
    ${sectionHeader('02', 'Perp funding bleed', chip(funding.netDailyUsd < 0 ? 'paying ' + fmtUsd(-funding.netDailyUsd, 2) + '/day' : 'net collecting', funding.netDailyUsd < 0 ? C.red : C.green))}
    <p class="body">${escapeHtml(narrative.funding)}</p>
    ${fundingTable(funding)}
  </div>

  <div class="card">
    ${sectionHeader('03', 'Idle assets vs Earn', chip(fmtUsd(idle.totalAnnualUsd) + '/yr missed', C.yellow))}
    <p class="body">${escapeHtml(narrative.idle)}</p>
    ${idleTable(idle)}
  </div>

  <div class="card">
    ${sectionHeader('04', 'Drawdown exposure', chip(drawdown.level + ' · beta ' + fmtNum(drawdown.portfolioBeta, 2), ddColor))}
    <p class="body">${escapeHtml(narrative.drawdown)}</p>
    <div class="stats">
      ${statCell('Portfolio beta', fmtNum(drawdown.portfolioBeta, 2), 'weighted vs BTC', ddColor)}
      ${statCell('Gross leverage', fmtNum(drawdown.grossLeverage, 2) + 'x', 'exposure / equity')}
      ${statCell('-20% BTC shock', '-' + fmtUsd(drawdown.shockLossUsd), 'expected equity hit', C.red)}
      ${statCell('Equity after shock', fmtUsd(drawdown.equityAfterShockUsd), 'modelled', C.orange)}
    </div>
  </div>

  <div class="card" style="border-color:${C.accent}44">
    ${sectionHeader('RX', 'Top ' + fixes.length + ' fixes, ranked by impact')}
    ${fixCards(fixes)}
    <p class="body faint" style="font-size:12px;margin-top:12px">
      Impact figures are computed from current balances, rates and prices at audit time — not projections of market moves.
    </p>
  </div>

  <div class="card">
    ${sectionHeader('A1', 'Appendix — open orders', orders.staleOrders.length ? chip(orders.staleOrders.length + ' stale', C.orange) : '')}
    ${ordersTable(orders)}
  </div>

  <div class="card">
    ${sectionHeader('A2', 'Appendix — how the score works')}
    ${methodology(health)}
  </div>

  <p class="body" style="margin-top:6px">${escapeHtml(narrative.closing)}</p>

  <footer>
    Portfolio Doctor v0.1 · report generated ${escapeHtml(when)} · data source:
    ${isMock ? 'mock adapter (OKX_MODE=mock)' : 'OKX read-only API'} · prices/rates as of ${escapeHtml(snapshot.meta.asOf)}<br>
    This report is an automated, informational analysis of account data. It is <strong>not financial advice</strong>,
    not a solicitation, and makes no guarantee of future performance. Crypto assets are volatile; you can lose money.
    Verify all figures against your exchange before acting.
  </footer>

</div>
</body>
</html>`;
}
