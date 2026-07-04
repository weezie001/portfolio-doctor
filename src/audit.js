/**
 * Audit orchestrator: ingest (okx adapter) -> analysis engine -> narrative
 * (llm adapter) -> HTML report on disk.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createOkxAdapter } from './adapters/okx.js';
import { createLlmAdapter } from './adapters/llm.js';
import { analyzePortfolio } from './analysis/index.js';
import { renderReport } from './report/render.js';

/** Package root (…/portfolio-doctor), independent of process.cwd(). */
export const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url));

export async function runAudit({ outDir = 'out', now = new Date() } = {}) {
  const okx = createOkxAdapter();
  const llm = createLlmAdapter();

  // 1. Ingest — one snapshot through the adapter boundary.
  const snapshot = await okx.getSnapshot(now.getTime());

  // 2. Analyze — pure functions over the snapshot.
  const analysis = analyzePortfolio(snapshot, { nowMs: now.getTime() });

  // 3. Narrate — prose sections wrapping the computed numbers.
  const narrative = await llm.generateNarrative({ snapshot, analysis });

  // 4. Render + write the self-contained HTML report.
  const html = renderReport({ snapshot, analysis, narrative, generatedAt: now });
  const dir = path.resolve(PKG_ROOT, outDir);
  await mkdir(dir, { recursive: true });
  const stamp = now.toISOString().slice(0, 19).replace(/:/g, '-'); // Windows-safe
  const reportPath = path.join(dir, `report-${stamp}.html`);
  await writeFile(reportPath, html, 'utf8');

  return { reportPath, snapshot, analysis, narrative, mode: okx.mode };
}
