/**
 * Web pages — server-rendered HTML for the Portfolio Doctor web UI.
 *
 * Design language: clinical lab-report. Light paper background, teal/green
 * accent, serif display headings over a clean sans body, dotted "lab value"
 * leaders, ruled letterhead. Deliberately distinct from the dark report theme
 * (the report is the specimen; these pages are the clinic).
 *
 * Same self-containment rules as the report renderer: inline CSS, inline SVG
 * (wordmark + favicon data URI), system font stacks only, zero external
 * requests. Works fully offline.
 */

/* ------------------------------- identity -------------------------------- */

/** Favicon: teal rounded square with a white pulse trace (SVG data URI). */
export const FAVICON_DATA_URI =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%3E%3Crect%20width='32'%20height='32'%20rx='7'%20fill='%230e7c6b'/%3E%3Cpolyline%20points='5%2017%2011%2017%2013.5%2010%2017%2023%2019.5%2017%2027%2017'%20fill='none'%20stroke='%23fff'%20stroke-width='2.4'%20stroke-linecap='round'%20stroke-linejoin='round'/%3E%3C/svg%3E";

/** Wordmark: pulse trace inside a ring, drawn in currentColor. */
function markSvg(cls = 'mark') {
  return `<svg class="${cls}" viewBox="0 0 34 34" aria-hidden="true" focusable="false">
    <circle cx="17" cy="17" r="15" fill="none" stroke="currentColor" stroke-width="2"/>
    <polyline points="6 17 12 17 14.5 10 18 24 20.5 17 28 17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/* --------------------------------- CSS ----------------------------------- */

const BASE_CSS = `
  :root{
    --paper:#f5f4ef; --sheet:#fffefb; --ink:#1d2f2a; --body:#3c4a46;
    --muted:#6f7d78; --rule:#dcd9cf; --rule-strong:#b3af9f;
    --teal:#0e7c6b; --teal-dark:#0a5c50; --teal-wash:#e9f3f0;
    --amber:#a16207; --orange:#c05621; --red:#b0322a; --green:#177245;
    --shadow:0 1px 2px rgba(29,47,42,.06),0 10px 28px rgba(29,47,42,.08);
    --serif:Georgia,'Iowan Old Style','Times New Roman',Times,serif;
    --sans:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;
    --mono:ui-monospace,'Cascadia Mono',Consolas,'SF Mono',Menlo,monospace;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html{-webkit-text-size-adjust:100%}
  body{font-family:var(--sans);color:var(--body);background:var(--paper);
       border-top:4px solid var(--teal);line-height:1.55;font-size:16px}
  [hidden]{display:none!important}
  .wrap{max-width:1060px;margin:0 auto;padding:0 22px}
  a{color:var(--teal-dark)}
  ::selection{background:var(--teal-wash)}

  /* letterhead */
  .masthead{display:flex;align-items:center;justify-content:space-between;gap:14px;
            padding:20px 0 14px;flex-wrap:wrap}
  .brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--teal-dark)}
  .brand .mark{width:30px;height:30px;flex:none}
  .brand b{font-family:var(--serif);font-weight:600;font-size:21px;color:var(--ink);
           letter-spacing:.2px;white-space:nowrap}
  .brand .tag{font-family:var(--mono);font-size:10px;letter-spacing:.18em;text-transform:uppercase;
              color:var(--muted);border-left:1px solid var(--rule-strong);margin-left:4px;padding-left:12px}
  .masthead nav{display:flex;align-items:center;gap:20px;flex-wrap:wrap}
  .masthead nav a{font-size:14px;color:var(--body);text-decoration:none}
  .masthead nav a:hover{color:var(--teal-dark);text-decoration:underline}
  .rule-double{border-top:2px solid var(--ink);border-bottom:1px solid var(--ink);height:5px}

  /* type */
  .kicker{font-family:var(--mono);font-size:11px;letter-spacing:.22em;text-transform:uppercase;
          color:var(--teal-dark)}
  h1{font-family:var(--serif);font-weight:600;color:var(--ink);font-size:44px;line-height:1.12;
     letter-spacing:-.3px;margin:12px 0 16px}
  h2{font-family:var(--serif);font-weight:600;color:var(--ink);font-size:27px;line-height:1.2}
  h3{font-family:var(--serif);font-weight:600;color:var(--ink);font-size:18px}
  .lede{font-size:17.5px;max-width:58ch}
  .muted{color:var(--muted)}
  .mono{font-family:var(--mono)}
  .small{font-size:13px}

  /* buttons */
  .btn{display:inline-block;background:var(--teal);color:#fff;border:1px solid var(--teal-dark);
       padding:11px 22px;border-radius:7px;font-weight:600;font-size:15px;font-family:var(--sans);
       cursor:pointer;text-decoration:none;transition:background .15s ease}
  .btn:hover{background:var(--teal-dark)}
  .btn:disabled{opacity:.55;cursor:wait}
  .btn-ghost{background:transparent;color:var(--teal-dark);border:1px solid var(--rule-strong)}
  .btn-ghost:hover{background:var(--teal-wash)}
  .btn:focus-visible,a:focus-visible{outline:2px solid var(--teal);outline-offset:2px}

  /* demo stamp */
  .stamp{display:inline-block;font-family:var(--mono);font-size:11px;letter-spacing:.16em;
         text-transform:uppercase;color:var(--orange);border:1.5px dashed var(--orange);
         padding:6px 11px;border-radius:3px;transform:rotate(-1.4deg);
         background:rgba(192,86,33,.05)}

  /* lab sheet */
  .sheet{background:var(--sheet);border:1px solid var(--rule);border-radius:10px;
         box-shadow:var(--shadow);overflow:hidden}
  .sheet-head{display:flex;justify-content:space-between;gap:10px;padding:12px 18px;
              border-bottom:1px solid var(--rule);font-family:var(--mono);font-size:10.5px;
              letter-spacing:.12em;text-transform:uppercase;color:var(--muted);
              background:rgba(14,124,107,.04)}
  .lab-row{display:flex;justify-content:space-between;align-items:baseline;gap:14px;
           padding:11px 18px;border-bottom:1px dotted var(--rule)}
  .lab-row:last-child{border-bottom:0}
  .lab-name{font-size:13.5px}
  .lab-ref{display:block;font-family:var(--mono);font-size:10.5px;color:var(--muted);margin-top:2px}
  .lab-val{font-family:var(--mono);font-size:14px;color:var(--ink);white-space:nowrap;text-align:right}
  .flag{display:inline-block;min-width:26px;text-align:center;font-family:var(--mono);
        font-size:10.5px;font-weight:700;border-radius:4px;padding:2px 6px;margin-left:8px;
        vertical-align:1px}
  .flag.hi{color:#8a2f22;background:#f7e3df}
  .flag.warn{color:#7c4a03;background:#f6ead6}
  .flag.ok{color:#14532d;background:#e0efe4}

  /* score strip */
  .band-excellent{--band:#0e7c6b} .band-healthy{--band:#177245}
  .band-needs-work{--band:#a16207} .band-at-risk{--band:#c05621} .band-critical{--band:#b0322a}
  .score-line{display:flex;align-items:center;gap:16px;padding:16px 18px;
              border-bottom:1px solid var(--rule)}
  .score-num{font-family:var(--serif);font-size:46px;color:var(--ink);line-height:1;white-space:nowrap}
  .score-num small{font-size:16px;color:var(--muted);font-family:var(--mono);letter-spacing:.05em}
  .band-pill{font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.14em;
             text-transform:uppercase;color:var(--band);border:1.5px solid var(--band);
             border-radius:4px;padding:4px 9px;white-space:nowrap}
  .score-track{flex:1;min-width:60px;height:8px;border-radius:99px;background:var(--rule);
               position:relative;overflow:hidden}
  .score-fill{position:absolute;top:0;bottom:0;left:0;border-radius:99px;background:var(--band)}

  /* sections */
  .section{padding:60px 0 6px}
  .sec-head{display:flex;gap:14px;align-items:baseline;border-bottom:1px solid var(--rule-strong);
            padding-bottom:10px;margin-bottom:28px}
  .sec-head .no{font-family:var(--mono);font-size:12px;color:var(--teal-dark);letter-spacing:.15em}

  /* footer */
  footer{margin-top:76px;padding:26px 0 44px;border-top:2px solid var(--ink)}
  footer .cols{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap}
  footer p{font-size:12.5px;color:var(--muted);max-width:64ch}
  footer .brand b{font-size:16px}
  footer .brand .mark{width:22px;height:22px}

  @media (max-width:900px){
    h1{font-size:34px}
    .section{padding:44px 0 4px}
  }
  @media (max-width:560px){
    .brand .tag{display:none}
    h1{font-size:29px}
    .score-num{font-size:36px}
  }
`;

/* ------------------------------- page shell ------------------------------ */

function shell({ title, description, body, extraCss = '', script = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="icon" href="${FAVICON_DATA_URI}">
<style>${BASE_CSS}${extraCss}</style>
</head>
<body>
${body}
${script}
</body>
</html>`;
}

function masthead(active = '') {
  return `
<header class="wrap">
  <div class="masthead">
    <a class="brand" href="/">${markSvg()}<b>Portfolio&nbsp;Doctor</b><span class="tag">Crypto portfolio audit</span></a>
    <nav aria-label="Main">
      <a href="/#screens">What it checks</a>
      <a href="/#how">How it works</a>
      <a href="/#pricing">Pricing</a>
      <a class="btn" href="/audit"${active === 'audit' ? ' aria-current="page"' : ''}>Run demo audit</a>
    </nav>
  </div>
  <div class="rule-double" role="presentation"></div>
</header>`;
}

function pageFooter() {
  return `
<footer>
  <div class="wrap cols">
    <div>
      <a class="brand" href="/">${markSvg()}<b>Portfolio&nbsp;Doctor</b></a>
      <p style="margin-top:10px">A lab report for your crypto account. One audit, one score, three fixes.</p>
    </div>
    <div>
      <p><strong>Demo build.</strong> Every figure on this site is generated from a built-in sample
      portfolio — no live account is read. Real read-only API-key support is on the roadmap.</p>
      <p style="margin-top:8px">Educational tooling, <strong>not financial advice</strong>. Nothing here
      is a recommendation to buy, sell, or hold anything.</p>
      <p style="margin-top:8px" class="mono">Service API: <code>POST /api/audit</code> · liveness: <code>GET /api/health</code></p>
    </div>
  </div>
</footer>`;
}

/* ----------------------------- landing page ------------------------------ */

const LANDING_CSS = `
  .hero{display:grid;grid-template-columns:1.04fr .96fr;gap:46px;align-items:center;padding:54px 0 10px}
  .hero .actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:24px 0 14px}
  .hero .actions .small{flex-basis:100%}

  .sample-card{position:relative}
  .sample-card::after{content:'DEMO';position:absolute;top:46%;left:50%;
    transform:translate(-50%,-50%) rotate(-16deg);font-family:var(--mono);font-size:72px;
    font-weight:700;letter-spacing:.32em;color:rgba(192,86,33,.07);pointer-events:none}
  .sample-foot{padding:10px 18px;border-top:1px solid var(--rule);font-family:var(--mono);
    font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
  .rx-row{display:flex;justify-content:space-between;gap:12px;padding:11px 18px;
    background:var(--teal-wash);border-top:1px solid var(--rule);font-size:13.5px}
  .rx-row .mono{color:var(--teal-dark);white-space:nowrap}

  .panel-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
  .panel{background:var(--sheet);border:1px solid var(--rule);border-radius:10px;padding:18px}
  .panel svg{width:22px;height:22px;color:var(--teal);margin-bottom:10px}
  .panel h3{margin-bottom:6px}
  .panel p{font-size:13.5px}
  .panel .unit{display:block;font-family:var(--mono);font-size:10.5px;color:var(--muted);
    margin-top:10px;padding-top:8px;border-top:1px dotted var(--rule);letter-spacing:.04em}

  .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:30px;counter-reset:step}
  .step .no{font-family:var(--serif);font-size:44px;color:var(--teal);line-height:1}
  .step h3{margin:8px 0 6px;font-size:19px}
  .step p{font-size:14.5px}
  .how-note{margin-top:26px}

  .price-card{display:grid;grid-template-columns:.9fr 1.1fr;max-width:820px}
  .price-side{padding:30px 28px;border-right:1px solid var(--rule);display:flex;flex-direction:column;
    justify-content:center;align-items:flex-start;gap:6px}
  .price-num{font-family:var(--serif);font-size:64px;color:var(--ink);line-height:1}
  .price-num small{font-size:18px;color:var(--muted);font-family:var(--sans)}
  .price-list{padding:26px 28px;list-style:none}
  .price-list li{padding:8px 0;border-bottom:1px dotted var(--rule);font-size:14.5px;
    display:flex;gap:10px;align-items:baseline}
  .price-list li:last-child{border-bottom:0}
  .price-list .tick{color:var(--teal);font-weight:700}

  @media (max-width:900px){
    .hero{grid-template-columns:1fr;gap:30px;padding-top:36px}
    .panel-grid{grid-template-columns:1fr 1fr}
    .steps{grid-template-columns:1fr;gap:20px}
    .price-card{grid-template-columns:1fr}
    .price-side{border-right:0;border-bottom:1px solid var(--rule)}
  }
  @media (max-width:560px){ .panel-grid{grid-template-columns:1fr} }
`;

/** Small inline line-icons for the diagnostic panels (stroke = currentColor). */
const ICONS = {
  concentration: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3v9l6.4 6.3"/></svg>`,
  funding: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c3.5 4.2 5.6 7.1 5.6 10a5.6 5.6 0 1 1-11.2 0C6.4 10.1 8.5 7.2 12 3Z"/><path d="M9.5 14.5c.4 1.2 1.3 2 2.5 2"/></svg>`,
  idle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 12.5A7 7 0 1 1 11 4a5.5 5.5 0 0 0 6.5 8.5Z"/><path d="M17 3h4l-4 4h4"/></svg>`,
  drawdown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6l6 6 3.5-3.5L21 17"/><path d="M21 11.5V17h-5.5"/></svg>`,
};

export function landingPage() {
  const body = `
${masthead()}
<main class="wrap">

  <section class="hero">
    <div>
      <span class="kicker">Clinical report · read-only · 60 seconds</span>
      <h1>A doctor&rsquo;s report for your crypto portfolio.</h1>
      <p class="lede">Portfolio Doctor reads your balances, perp positions, funding rates and idle
      cash, scores the account <strong>0&ndash;100</strong>, and hands you the three
      highest-dollar fixes. Read-only. One page. Yours to keep.</p>
      <div class="actions">
        <a class="btn" href="/audit">Run demo audit</a>
        <a class="btn btn-ghost" href="#screens">See what it checks</a>
        <span class="small muted">No signup, no keys — the demo audits a built-in sample book.</span>
      </div>
      <span class="stamp">Demo mode &mdash; sample portfolio</span>
    </div>

    <div class="sheet sample-card" aria-label="Sample audit result">
      <div class="sheet-head"><span>Specimen: sample book &middot; 9 assets &middot; 3 perps</span><span>Report PD-DEMO-001</span></div>
      <div class="score-line band-at-risk">
        <span class="score-num">52<small>/100</small></span>
        <span class="score-track"><span class="score-fill" style="width:52%"></span></span>
        <span class="band-pill">At Risk</span>
      </div>
      <div class="lab-row"><span class="lab-name">Top holding weight (BTC)<span class="lab-ref">ref &lt; 50% of spot</span></span><span class="lab-val">69.4%<span class="flag hi">H</span></span></div>
      <div class="lab-row"><span class="lab-name">Net perp funding<span class="lab-ref">ref &ge; $0 / day</span></span><span class="lab-val">&minus;$24.36/day<span class="flag hi">H</span></span></div>
      <div class="lab-row"><span class="lab-name">Idle stablecoins<span class="lab-ref">ref &asymp; $0 sitting at 0%</span></span><span class="lab-val">$14,250<span class="flag hi">H</span></span></div>
      <div class="lab-row"><span class="lab-name">Beta to BTC<span class="lab-ref">ref 0.60 &ndash; 1.20</span></span><span class="lab-val">0.98<span class="flag ok">OK</span></span></div>
      <div class="lab-row"><span class="lab-name">&minus;20% BTC shock<span class="lab-ref">estimated equity impact</span></span><span class="lab-val">&minus;$27,959</span></div>
      <div class="rx-row"><span><strong>&#8478; No.1</strong> &mdash; Stop the funding bleed on SOL-USDT-SWAP</span><span class="mono">+$8,722/yr</span></div>
      <div class="sample-foot">Sample &middot; generated by the built-in demo &middot; not financial advice</div>
    </div>
  </section>

  <section class="section" id="screens">
    <div class="sec-head"><span class="no">PANEL 01</span><h2>What the audit screens for</h2></div>
    <div class="panel-grid">
      <div class="panel">${ICONS.concentration}<h3>Concentration</h3>
        <p>How much of the book rides on one chart, measured properly (HHI), not eyeballed.</p>
        <span class="unit">unit: normalized HHI &middot; top-holding %</span></div>
      <div class="panel">${ICONS.funding}<h3>Funding bleed</h3>
        <p>What your perps quietly pay every 8 hours, annualized into a number you can feel.</p>
        <span class="unit">unit: $/day &middot; APR on notional</span></div>
      <div class="panel">${ICONS.idle}<h3>Idle capital</h3>
        <p>Stables and majors parked at 0% while flexible Earn and staking rates sit next door.</p>
        <span class="unit">unit: $/yr un-earned</span></div>
      <div class="panel">${ICONS.drawdown}<h3>Drawdown exposure</h3>
        <p>Portfolio beta to BTC and the dollar cost of the next &minus;20% day, before it happens.</p>
        <span class="unit">unit: &beta; &middot; $ at &minus;20% BTC</span></div>
    </div>
    <p class="small muted" style="margin-top:14px">Plus hygiene checks: stale limit orders and dust positions.
    Every score component has a published threshold &mdash; the math is in the report, not behind it.</p>
  </section>

  <section class="section" id="how">
    <div class="sec-head"><span class="no">METHOD 02</span><h2>How it works</h2></div>
    <div class="steps">
      <div class="step"><span class="no">1</span>
        <h3>Connect</h3>
        <p>Paste a <strong>read-only</strong> exchange API key &mdash; it can view balances, never trade
        or withdraw. In this demo build, a realistic sample account stands in and no key is needed.</p></div>
      <div class="step"><span class="no">2</span>
        <h3>Examine</h3>
        <p>The engine pulls balances, positions, orders, prices, funding and Earn rates, then runs five
        diagnostics and scores the account 0&ndash;100 with a transparent 4&times;25 breakdown.</p></div>
      <div class="step"><span class="no">3</span>
        <h3>Treat</h3>
        <p>You get a single-file HTML report &mdash; score, findings with the computed numbers, and the
        top&nbsp;3 fixes ranked by dollar impact. Print to PDF from the browser, keep it forever.</p></div>
    </div>
    <p class="how-note small muted">Typical run: about a minute end-to-end; the demo completes in under a second.</p>
  </section>

  <section class="section" id="pricing">
    <div class="sec-head"><span class="no">FEE 03</span><h2>Pricing</h2></div>
    <div class="sheet price-card">
      <div class="price-side">
        <span class="kicker">Per audit</span>
        <span class="price-num">$3<small>&nbsp;flat</small></span>
        <span class="small muted">Launch placeholder &mdash; final price set at listing.</span>
      </div>
      <ul class="price-list">
        <li><span class="tick">&#10003;</span>One flat fee per audit &mdash; no subscription, no account</li>
        <li><span class="tick">&#10003;</span>Read-only key only: the service can never trade or withdraw</li>
        <li><span class="tick">&#10003;</span>Report is a single HTML file you keep &mdash; print to PDF anytime</li>
        <li><span class="tick">&#10003;</span>Re-run whenever the market &mdash; or your book &mdash; changes</li>
        <li><span class="tick">&#10003;</span>Demo audit is free, right now, on a sample portfolio</li>
      </ul>
    </div>
    <p style="margin-top:18px"><a class="btn" href="/audit">Run the free demo audit</a></p>
  </section>

</main>
${pageFooter()}`;

  return shell({
    title: 'Portfolio Doctor — a lab report for your crypto portfolio',
    description:
      'One-shot crypto portfolio audit: concentration, perp funding bleed, idle assets and drawdown exposure, scored 0-100 with the top 3 dollar-ranked fixes.',
    body,
    extraCss: LANDING_CSS,
  });
}

/* ------------------------------ audit page ------------------------------- */

const AUDIT_CSS = `
  .narrow{max-width:780px;margin:0 auto}
  .page-head{padding:44px 0 8px}
  .req-form{margin-top:26px}
  .req-form .sheet-head span:last-child{color:var(--orange)}
  .form-body{padding:20px 18px}
  .field{margin-bottom:14px}
  .field label{display:block;font-family:var(--mono);font-size:11px;letter-spacing:.12em;
    text-transform:uppercase;color:var(--muted);margin-bottom:5px}
  .field input{width:100%;padding:10px 12px;border:1px solid var(--rule);border-radius:7px;
    background:#f2f1ea;color:var(--muted);font-family:var(--mono);font-size:14px}
  fieldset{border:0}
  fieldset:disabled input{cursor:not-allowed}
  .notice{background:var(--teal-wash);border-left:3px solid var(--teal);padding:13px 16px;
    border-radius:0 8px 8px 0;font-size:14px;margin:6px 0 18px}
  .run-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap}

  .pulse-note{display:flex;align-items:center;gap:10px;font-size:14px;color:var(--teal-dark)}
  .pulse-note svg{width:26px;height:26px;color:var(--teal)}
  .pulse-note .trace{stroke-dasharray:60;stroke-dashoffset:60;animation:trace 1.1s linear infinite}
  @keyframes trace{to{stroke-dashoffset:-60}}

  .result-wrap{margin:30px 0 10px}
  .rx-list{list-style:none;counter-reset:rx}
  .rx-list li{display:flex;justify-content:space-between;gap:14px;align-items:baseline;
    padding:11px 18px;border-bottom:1px dotted var(--rule);font-size:14.5px}
  .rx-list li::before{counter-increment:rx;content:"\\211E " counter(rx);font-family:var(--serif);
    color:var(--teal-dark);font-weight:600;white-space:nowrap}
  .rx-list .fix-title{flex:1}
  .rx-list .fix-impact{font-family:var(--mono);font-size:13px;color:var(--teal-dark);white-space:nowrap}
  .result-actions{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:16px 18px;
    border-top:1px solid var(--rule);background:rgba(14,124,107,.04)}
  .error-box{background:#f9e9e7;border-left:3px solid var(--red);color:#7c2a24;
    padding:13px 16px;border-radius:0 8px 8px 0;font-size:14px;margin-top:22px}
  .meta-line{font-family:var(--mono);font-size:11px;color:var(--muted)}
`;

export function auditPage() {
  const body = `
${masthead('audit')}
<main class="wrap narrow">

  <div class="page-head">
    <span class="kicker">Requisition form</span>
    <h1>Run an audit</h1>
    <p class="lede">The audit runs the full engine &mdash; ingest, five diagnostics, health score,
    ranked fixes &mdash; and writes a self-contained HTML report you can open and keep.</p>
  </div>

  <form id="audit-form" class="sheet req-form" method="post" action="/api/audit">
    <div class="sheet-head"><span>Patient intake &middot; exchange credentials</span><span>Demo mode</span></div>
    <div class="form-body">
      <p class="notice"><strong>Demo mode &mdash; sample portfolio.</strong> API-key fields are disabled in
      this build; the audit below runs on a realistic built-in demo account (9 assets, 3 perp positions,
      resting orders). When live-key support lands, the same form will accept a <strong>read-only</strong>
      key &mdash; one that can view balances but never trade or withdraw.</p>
      <fieldset disabled aria-describedby="demo-note">
        <div class="field"><label for="f-key">API key (read-only)</label>
          <input id="f-key" name="apiKey" type="text" placeholder="disabled in demo" autocomplete="off"></div>
        <div class="field"><label for="f-secret">API secret</label>
          <input id="f-secret" name="apiSecret" type="password" placeholder="disabled in demo" autocomplete="off"></div>
        <div class="field"><label for="f-pass">Passphrase</label>
          <input id="f-pass" name="passphrase" type="password" placeholder="disabled in demo" autocomplete="off"></div>
      </fieldset>
      <div class="run-row">
        <button class="btn" id="run-btn" type="submit">Run demo audit</button>
        <span class="pulse-note" id="run-status" role="status" hidden>
          <svg viewBox="0 0 34 34" aria-hidden="true"><polyline class="trace" points="2 17 10 17 13.5 8 18.5 26 22 17 32 17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Examining sample portfolio&hellip;
        </span>
        <span class="small muted" id="demo-note">Free in demo mode &middot; ~1 second &middot; nothing leaves this machine.</span>
      </div>
      <noscript><p class="notice" style="margin-top:16px">JavaScript is off &mdash; submitting will return
      the raw JSON from <code>POST /api/audit</code>. The report link is in the <code>reportUrl</code> field.</p></noscript>
    </div>
  </form>

  <div class="result-wrap" id="result" hidden aria-live="polite">
    <div class="sec-head"><span class="no">RESULT</span><h2>Audit summary</h2></div>
    <div class="sheet" id="result-card">
      <div class="sheet-head"><span>Specimen: sample book &middot; demo data</span><span id="r-repno">Portfolio Doctor</span></div>
      <div class="score-line">
        <span class="score-num"><span id="r-score">&ndash;</span><small>/100</small></span>
        <span class="score-track"><span class="score-fill" id="r-fill" style="width:0%"></span></span>
        <span class="band-pill" id="r-band">&mdash;</span>
      </div>
      <div class="lab-row"><span class="lab-name">Total equity<span class="lab-ref">spot + perp margin + uPnL</span></span><span class="lab-val" id="r-equity"></span></div>
      <div class="lab-row"><span class="lab-name">Top holding<span class="lab-ref">ref &lt; 50% of spot</span></span><span class="lab-val"><span id="r-tophold"></span><span class="flag" id="f-tophold" hidden></span></span></div>
      <div class="lab-row"><span class="lab-name">Net perp funding<span class="lab-ref">ref &ge; $0 / day</span></span><span class="lab-val"><span id="r-funding"></span><span class="flag" id="f-funding" hidden></span></span></div>
      <div class="lab-row"><span class="lab-name">Un-earned yield<span class="lab-ref">idle balances vs Earn rates</span></span><span class="lab-val"><span id="r-idle"></span><span class="flag" id="f-idle" hidden></span></span></div>
      <div class="lab-row"><span class="lab-name">Beta to BTC<span class="lab-ref">ref 0.60 &ndash; 1.20</span></span><span class="lab-val"><span id="r-beta"></span><span class="flag" id="f-beta" hidden></span></span></div>
      <div class="lab-row"><span class="lab-name">&minus;20% BTC shock<span class="lab-ref">estimated equity impact</span></span><span class="lab-val" id="r-shock"></span></div>
      <ol class="rx-list" id="r-fixes"></ol>
      <div class="result-actions">
        <a class="btn" id="r-link" href="#" target="_blank" rel="noopener">Open full report &rarr;</a>
        <span class="meta-line" id="r-meta"></span>
      </div>
    </div>
    <p class="small muted" style="margin-top:12px">Demo data &middot; educational tooling, not financial advice.</p>
  </div>

  <div class="error-box" id="error" hidden><strong>Audit failed.</strong> <span id="error-msg"></span></div>

</main>
${pageFooter()}`;

  const script = `
<script>
(function () {
  var form = document.getElementById('audit-form');
  var runBtn = document.getElementById('run-btn');
  var statusEl = document.getElementById('run-status');
  var resultEl = document.getElementById('result');
  var errorEl = document.getElementById('error');
  if (!form) return;

  var BAND_CLASS = {
    'Excellent': 'band-excellent', 'Healthy': 'band-healthy',
    'Needs Work': 'band-needs-work', 'At Risk': 'band-at-risk', 'Critical': 'band-critical'
  };

  function put(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }
  function flag(id, cls, label) {
    var el = document.getElementById(id);
    if (!el) return;
    el.className = 'flag ' + cls;
    el.textContent = label;
    el.hidden = false;
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    runBtn.disabled = true;
    statusEl.hidden = false;
    errorEl.hidden = true;
    fetch('/api/audit', { method: 'POST', headers: { 'Accept': 'application/json' } })
      .then(function (res) {
        return res.json().then(function (data) { return { res: res, data: data }; });
      })
      .then(function (x) {
        if (!x.res.ok || !x.data.ok) {
          throw new Error((x.data && x.data.error) || ('HTTP ' + x.res.status));
        }
        render(x.data);
      })
      .catch(function (err) {
        resultEl.hidden = true;
        errorEl.hidden = false;
        put('error-msg', (err && err.message) || 'Unknown error.');
      })
      .then(function () {
        runBtn.disabled = false;
        statusEl.hidden = true;
      });
  });

  function render(d) {
    var card = document.getElementById('result-card');
    card.className = 'sheet ' + (BAND_CLASS[d.grade] || 'band-needs-work');
    put('r-score', String(d.score));
    put('r-band', d.grade);
    document.getElementById('r-fill').style.width = Math.max(2, Math.min(100, d.score)) + '%';
    put('r-repno', 'Report ' + (d.reportUrl.split('/').pop() || ''));

    put('r-equity', d.formatted.equity);
    put('r-tophold', d.formatted.topHolding);
    put('r-funding', d.formatted.netFundingPerDay);
    put('r-idle', d.formatted.idleYieldPerYear);
    put('r-beta', d.formatted.betaToBtc);
    put('r-shock', d.formatted.btcShock20Loss);

    var h = d.headline;
    var lvl = h.topHolding ? h.topHolding.level : '';
    flag('f-tophold',
      lvl === 'heavily concentrated' || lvl === 'concentrated' ? 'hi'
        : lvl === 'moderately concentrated' ? 'warn' : 'ok',
      lvl === 'heavily concentrated' || lvl === 'concentrated' ? 'H'
        : lvl === 'moderately concentrated' ? '!' : 'OK');
    flag('f-funding', h.netFundingUsdPerDay < -0.5 ? 'hi' : h.netFundingUsdPerDay < 0 ? 'warn' : 'ok',
      h.netFundingUsdPerDay < -0.5 ? 'H' : h.netFundingUsdPerDay < 0 ? '!' : 'OK');
    flag('f-idle', h.idleYieldUsdPerYear > 500 ? 'hi' : h.idleYieldUsdPerYear > 100 ? 'warn' : 'ok',
      h.idleYieldUsdPerYear > 500 ? 'H' : h.idleYieldUsdPerYear > 100 ? '!' : 'OK');
    flag('f-beta', h.betaLevel === 'aggressive' || h.betaLevel === 'elevated' ? 'hi' : 'ok',
      h.betaLevel === 'aggressive' || h.betaLevel === 'elevated' ? 'H' : 'OK');

    var list = document.getElementById('r-fixes');
    list.innerHTML = '';
    (d.fixes || []).forEach(function (f) {
      var li = document.createElement('li');
      var t = document.createElement('span');
      t.className = 'fix-title';
      t.textContent = f.title;
      var i = document.createElement('span');
      i.className = 'fix-impact';
      i.textContent = f.impact;
      li.appendChild(t);
      li.appendChild(i);
      list.appendChild(li);
    });

    document.getElementById('r-link').href = d.reportUrl;
    put('r-meta', 'mode: ' + d.mode + ' (demo data) · ' + d.generatedAt + ' · ' + d.elapsedMs + ' ms');
    resultEl.hidden = false;
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
})();
</script>`;

  return shell({
    title: 'Run a demo audit — Portfolio Doctor',
    description:
      'Run the Portfolio Doctor demo audit on a realistic sample portfolio and get a scored, self-contained HTML report.',
    body,
    extraCss: AUDIT_CSS,
    script,
  });
}

/* ------------------------------- 404 page -------------------------------- */

export function notFoundPage() {
  const body = `
${masthead()}
<main class="wrap" style="padding:70px 0">
  <span class="kicker">Chart not found</span>
  <h1>404 &mdash; no record on file.</h1>
  <p class="lede">That page isn&rsquo;t in this clinic. Try the <a href="/">front desk</a> or
  <a href="/audit">run the demo audit</a>.</p>
</main>
${pageFooter()}`;

  return shell({
    title: '404 — Portfolio Doctor',
    description: 'Page not found.',
    body,
  });
}
