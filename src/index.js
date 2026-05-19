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

async function loadTargets() {
  const raw = await fs.readFile(TARGETS_FILE, 'utf-8');
  return JSON.parse(raw);
}

async function run() {
  console.log(`Competitive Monitor — ${new Date().toISOString()}\n`);

  let targets;
  try {
    targets = await loadTargets();
    console.log(`[index] Loaded ${targets.length} competitor(s) from targets.json`);
  } catch (err) {
    console.error(`[index] Failed to load targets.json: ${err.message}`);
    return;
  }

  if (DRY_RUN) {
    console.log('[index] DRY RUN — scraping only, no AI calls, no reports written.');
    await scrapeAll(targets);
    console.log('[index] Dry run complete.');
    return;
  }

  // Step 1: Scrape
  console.log('\n[index] Step 1/4 — Scraping...');
  const scrapeResults = await scrapeAll(targets);

  // Step 2: Diff
  console.log('\n[index] Step 2/4 — Diffing snapshots...');
  const diffs = await diffAll(scrapeResults);
  console.log(`[index] ${diffs.length} page(s) with changes.`);

  if (diffs.length === 0) {
    console.log('[index] Nothing changed. Exiting early.');
    return;
  }

  // Step 3: Summarize with Ollama
  console.log('\n[index] Step 3/4 — Summarizing with Ollama...');
  const summaries = await summarizeAll(diffs);

  // Step 4: Report
  console.log('\n[index] Step 4/4 — Generating report...');
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