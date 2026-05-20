import 'dotenv/config';
import cron from 'node-cron';
import fs from 'fs/promises';
import { scrapeAll } from './scraper.js';
import { diffAll } from './differ.js';
import { summarizeAll } from './summarizer.js';
import { report } from './reporter.js';

const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 8 * * *';
const TARGETS_FILE = '/app/targets.json';
const args = process.argv.slice(2);
const RUN_NOW = args.includes('--now');
const DRY_RUN = args.includes('--dry-run');
const FRESH = args.includes('--fresh');

async function loadTargets() {
  const raw = await fs.readFile(TARGETS_FILE, 'utf-8');
  return JSON.parse(raw);
}

async function run() {
  console.log(`Patch Notes Monitor — ${new Date().toISOString()}\n`);

  let targets;
  try {
    targets = await loadTargets();
    console.log(`[index] Loaded ${targets.length} platform(s) from targets.json`);
  } catch (err) {
    console.error(`[index] Failed to load targets.json: ${err.message}`);
    return;
  }

  if (FRESH) {
    process.env.SNAPSHOT_REFRESH = 'true';
    console.log('[index] --fresh: re-scraping all changelog pages today.');
    try {
      await fs.rm('/app/logs/state', { recursive: true, force: true });
      console.log('[index] Cleared cached summaries (logs/state).');
    } catch {
      /* no cache yet */
    }
  }

  if (DRY_RUN) {
    console.log('[index] DRY RUN — scraping only, no AI calls, no reports written.');
    await scrapeAll(targets);
    console.log('[index] Dry run complete.');
    return;
  }

  console.log('\n[index] Step 1/4 — Scraping changelog pages...');
  const scrapeResults = await scrapeAll(targets);

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
}

if (RUN_NOW) {
  console.log('[index] --now flag detected, running immediately...');
  run();
} else {
  console.log(`[index] Scheduler started. Cron: "${CRON_SCHEDULE}"`);
  cron.schedule(CRON_SCHEDULE, () => {
    run().catch((err) => console.error('[index] Unhandled error:', err));
  });
}
