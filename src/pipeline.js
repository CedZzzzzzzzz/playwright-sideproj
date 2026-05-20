import fs from 'fs/promises';
import path from 'path';
import { scrapeAll } from './scraper.js';
import { diffAll } from './differ.js';
import { summarizeAll } from './summarizer.js';
import { report } from './reporter.js';

const TARGETS_FILE = process.env.TARGETS_FILE || '/app/targets.json';

export async function runPipeline({ fresh = false, dryRun = false } = {}) {
  console.log(`Patch Notes Monitor — ${new Date().toISOString()}\n`);

  let targets;
  try {
    const raw = await fs.readFile(TARGETS_FILE, 'utf-8');
    targets = JSON.parse(raw);
    console.log(`[index] Loaded ${targets.length} platform(s) from targets.json`);
  } catch (err) {
    throw new Error(`Failed to load targets.json: ${err.message}`);
  }

  if (fresh) {
    process.env.SNAPSHOT_REFRESH = 'true';
    console.log('[index] --fresh: re-scraping all changelog pages today.');
    const stateDir = path.join(process.env.LOGS_DIR || '/app/logs', 'state');
    try {
      await fs.rm(stateDir, { recursive: true, force: true });
      console.log('[index] Cleared cached summaries (logs/state).');
    } catch {
      /* no cache yet */
    }
  }

  if (dryRun) {
    console.log('[index] DRY RUN — scraping only, no summaries or reports.');
    await scrapeAll(targets);
    console.log('[index] Dry run complete.');
    return { dryRun: true, platformCount: targets.length };
  }

  console.log('\n[index] Step 1/4 — Scraping changelog pages...');
  const scrapeResults = await scrapeAll(targets);
  const scrapeErrors = scrapeResults.filter((r) => r.error).length;

  console.log('\n[index] Step 2/4 — Detecting new patches...');
  const diffResults = await diffAll(scrapeResults);
  const newPatches = diffResults.filter((d) => d.hasNewPatch).length;
  console.log(`[index] ${diffResults.length} platform(s) checked, ${newPatches} new patch(es).`);

  const mode = process.env.SUMMARY_MODE || 'fast';
  console.log(`\n[index] Step 3/4 — Summarizing (mode: ${mode})...`);
  const summaries = await summarizeAll(diffResults);

  console.log('\n[index] Step 4/4 — Writing daily digest...');
  await report(summaries);

  console.log('\n✅ Run complete.\n');

  const date = new Date().toISOString().split('T')[0];
  return {
    date,
    platformCount: summaries.length,
    newPatches,
    scrapeErrors,
    completedAt: new Date().toISOString(),
  };
}
