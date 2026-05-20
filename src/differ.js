import { diffWords } from 'diff';
import fs from 'fs/promises';
import path from 'path';

const LOGS_DIR = '/app/logs';

/** Changelog pages usually put version + date in the first ~1.5k chars. */
const HEAD_SLICE = 1500;
const MIN_ADDED_CHARS_FOR_PATCH = 80;

export async function diffAll(scrapeResults) {
  const results = [];

  for (const result of scrapeResults) {
    if (result.error) continue;

    const previous = await loadPreviousSnapshot(result.competitor, result.label);

    if (!previous) {
      console.log(`[differ] No previous snapshot for ${result.competitor} - ${result.label}, baseline only.`);
      results.push({
        platform: result.competitor,
        label: result.label,
        url: result.url,
        date: result.snapshot.date,
        previousDate: null,
        hasNewPatch: false,
        isFirstSnapshot: true,
        patchFingerprint: extractPatchFingerprint(result.snapshot.text),
        previousFingerprint: null,
        changelogExcerpt: excerptChangelog(result.snapshot.text),
        latestRelease: result.snapshot.latestRelease || null,
        addedText: '',
        removedText: '',
      });
      continue;
    }

    const patchFingerprint = extractPatchFingerprint(result.snapshot.text);
    const previousFingerprint = extractPatchFingerprint(previous.text);
    const changes = computeDiff(previous.text, result.snapshot.text);
    const fingerprintChanged = patchFingerprint !== previousFingerprint;
    const hasSubstantialAdditions = changes.addedText.length >= MIN_ADDED_CHARS_FOR_PATCH;
    const hasNewPatch = fingerprintChanged || (changes.hasChanges && hasSubstantialAdditions);

    if (hasNewPatch) {
      console.log(
        `[differ] New patch detected for ${result.competitor} - ${result.label}` +
          (fingerprintChanged ? ' (version/date changed)' : ' (content changed)')
      );
    } else {
      console.log(`[differ] No new patch for ${result.competitor} - ${result.label}.`);
    }

    results.push({
      platform: result.competitor,
      label: result.label,
      url: result.url,
      date: result.snapshot.date,
      previousDate: previous.date,
      hasNewPatch,
      isFirstSnapshot: false,
      patchFingerprint,
      previousFingerprint,
      changelogExcerpt: excerptChangelog(result.snapshot.text),
      latestRelease: result.snapshot.latestRelease || null,
      ...changes,
    });
  }

  return results;
}

export function platformSlug(platform, label) {
  return `${platform}-${label}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/** Top of changelog pages — usually the latest release entry. */
export function excerptChangelog(text, maxLen = 6000) {
  return (text || '').slice(0, maxLen);
}

export function extractPatchFingerprint(text) {
  const head = (text || '').slice(0, HEAD_SLICE);
  const tokens = [];

  const patterns = [
    /\bv?\d+\.\d+\.\d+(?:[-.][\w.]+)?\b/gi,
    /\b\d{4}[-/]\d{2}[-/]\d{2}\b/g,
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/gi,
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\b/gi,
    /Release\s+[\w.]+/gi,
    /v\d+(?:\.\d+){1,3}/gi,
  ];

  for (const re of patterns) {
    const matches = head.match(re);
    if (matches) {
      tokens.push(...matches.slice(0, 4));
    }
  }

  if (tokens.length > 0) {
    return [...new Set(tokens.map((t) => t.trim()))].slice(0, 6).join('|');
  }

  return head.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function computeDiff(oldText, newText) {
  const parts = diffWords(oldText, newText);

  const added = [];
  const removed = [];

  for (const part of parts) {
    if (part.added) added.push(part.value.trim());
    if (part.removed) removed.push(part.value.trim());
  }

  const addedText = added.filter((s) => s.length > 10).join('\n');
  const removedText = removed.filter((s) => s.length > 10).join('\n');

  return {
    hasChanges: added.length > 0 || removed.length > 0,
    addedText,
    removedText,
    addedWords: added.length,
    removedWords: removed.length,
  };
}

async function loadPreviousSnapshot(platform, label) {
  const slug = platformSlug(platform, label);

  let dates;
  try {
    const entries = await fs.readdir(LOGS_DIR);
    dates = entries
      .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e))
      .sort()
      .reverse();
  } catch {
    return null;
  }

  const today = new Date().toISOString().split('T')[0];

  for (const date of dates) {
    if (date === today) continue;

    const filepath = path.join(LOGS_DIR, date, `${slug}.json`);

    try {
      const raw = await fs.readFile(filepath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      continue;
    }
  }

  return null;
}
