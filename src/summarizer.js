import fs from 'fs/promises';
import path from 'path';
import { platformSlug } from './differ.js';
import { extractiveSummary } from './extractive.js';
import { isValidSummary } from './summary-utils.js';
import { ensureOllamaReady, summarizeWithOllama } from './ollama-summarize.js';

const SUMMARY_MODE = (process.env.SUMMARY_MODE || 'fast').toLowerCase();
const STATE_DIR = '/app/logs/state';

const useAi = (item) =>
  SUMMARY_MODE === 'ai' || (SUMMARY_MODE === 'hybrid' && item.hasNewPatch);

const statePath = (platform, label) => path.join(STATE_DIR, `${platformSlug(platform, label)}.json`);

export async function summarizeAll(diffResults) {
  await purgeInvalidCaches();

  let cached = 0;
  let needsOllama = 0;
  for (const item of diffResults) {
    const prev = await loadLastSummary(item.platform, item.label);
    if (!item.hasNewPatch && !item.isFirstSnapshot && prev?.summary && isValidSummary(prev.summary)) {
      cached++;
    } else if (useAi(item)) {
      needsOllama++;
    }
  }

  const needsWork = diffResults.length - cached;
  if (cached) console.log(`[summarizer] Cached: ${cached} platform(s).`);
  if (needsWork) {
    const fastCount = needsWork - needsOllama;
    if (fastCount) console.log(`[summarizer] Fast extractive: ${fastCount} platform(s).`);
    if (needsOllama) {
      await ensureOllamaReady();
      console.log(`[summarizer] Ollama: ${needsOllama} platform(s), serial.`);
    }
  }

  const results = [];
  for (const item of diffResults) results.push(await processItem(item));
  return results;
}

async function processItem(item) {
  const name = `${item.platform} - ${item.label}`;
  try {
    const lastKnown = await loadLastSummary(item.platform, item.label);
    const cacheOk =
      lastKnown?.summary && isValidSummary(lastKnown.summary) && lastKnown.summary.quality === 'good';

    if (item.hasNewPatch) {
      console.log(`[summarizer] New patch — ${name}`);
      const summary = await buildSummary(item, 'patch');
      await saveLastSummary(item.platform, item.label, summary, summary.release_date || item.date, item.patchFingerprint);
      return { ...item, noUpdate: false, summary, lastKnown: null };
    }

    if (cacheOk && !item.isFirstSnapshot) {
      console.log(`[summarizer] Cache hit — ${name}`);
      return { ...item, noUpdate: true, summary: lastKnown.summary, lastKnown };
    }

    if (!hasEnoughSourceText(item)) {
      throw new Error(
        `Scraped text too short (${(item.changelogExcerpt || '').length} chars) — re-run with --fresh`
      );
    }

    console.log(`[summarizer] Summarizing — ${name} (${useAi(item) ? 'ai' : 'fast'})`);
    const summary = await buildSummary(item, 'latest');
    await saveLastSummary(item.platform, item.label, summary, summary.release_date || item.date, item.patchFingerprint);
    return { ...item, noUpdate: !item.isFirstSnapshot, summary, lastKnown: null };
  } catch (err) {
    console.error(`[summarizer] Failed for ${name}: ${err.message}`);
    const lastKnown = await loadLastSummary(item.platform, item.label);
    const fallback = lastKnown?.summary && isValidSummary(lastKnown.summary) ? lastKnown.summary : null;
    return { ...item, summaryError: err.message, lastKnown, summary: fallback, noUpdate: !item.hasNewPatch };
  }
}

async function buildSummary(item, mode) {
  if (useAi(item)) return summarizeWithOllama(item, mode);

  const summary = extractiveSummary(item);
  if (summary.quality === 'failed') throw new Error(summary.sentences?.[0] || 'Could not read changelog content');
  if (!isValidSummary(summary)) throw new Error('Could not extract enough text from changelog — try --fresh');
  return summary;
}

function hasEnoughSourceText(item) {
  if (item.latestRelease?.title?.length > 15) return true;
  const text = (item.changelogExcerpt || item.addedText || '').trim();
  return text.length >= 350 && !/404|couldn't find that page|page not found/i.test(text);
}

async function loadLastSummary(platform, label) {
  try {
    return JSON.parse(await fs.readFile(statePath(platform, label), 'utf-8'));
  } catch {
    return null;
  }
}

async function saveLastSummary(platform, label, summary, patchDate, patchFingerprint) {
  if (!isValidSummary(summary)) throw new Error('Refusing to cache invalid summary');
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(
    statePath(platform, label),
    JSON.stringify(
      { platform, label, patchDate, patchFingerprint: patchFingerprint || null, savedAt: new Date().toISOString(), summary },
      null,
      2
    )
  );
}

async function purgeInvalidCaches() {
  let files;
  try {
    files = await fs.readdir(STATE_DIR);
  } catch {
    return;
  }
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const data = JSON.parse(await fs.readFile(path.join(STATE_DIR, file), 'utf-8'));
      if (!isValidSummary(data.summary)) {
        await fs.unlink(path.join(STATE_DIR, file));
        console.log(`[summarizer] Removed invalid cache: ${file}`);
      }
    } catch {
      /* ignore */
    }
  }
}

// Re-export for tests or future callers
export { isValidSummary } from './summary-utils.js';
export { loadLastSummary };
