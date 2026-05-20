
export function buildReportPayload(summaries, date) {
  const newCount = summaries.filter((s) => s.hasNewPatch && s.summary).length;

  return {
    date,
    generatedAt: new Date().toISOString(),
    newCount,
    platformCount: summaries.length,
    platforms: summaries.map((item) => toPlatformEntry(item)),
  };
}

function toPlatformEntry(item) {
  const platform = item.platform || item.competitor;
  const s = item.summary || item.lastKnown?.summary;

  return {
    platform,
    label: item.label || '',
    url: item.url || '',
    hasNewPatch: Boolean(item.hasNewPatch),
    status: item.hasNewPatch ? 'new' : 'no_update',
    latestTitle: cleanTitle(s?.release_title),
    releaseDate: s?.release_date || '',
    significance: (s?.significance || 'low').toLowerCase(),
    upgradeRecommended: Boolean(s?.upgrade_recommended),
    quality: s?.quality || (item.summaryError ? 'failed' : 'good'),
    sentences: pickSentences(s),
    error: item.summaryError || null,
  };
}

function pickSentences(s) {
  if (!s?.sentences) return [];
  const filler = /see the (full |linked )?changelog|further details were not available/i;
  return s.sentences.filter((line) => line && line.length > 20 && !filler.test(line)).slice(0, 3);
}

function cleanTitle(title) {
  if (!title || /^latest release$/i.test(title)) return 'See changelog';
  if (title.length > 80) return `${title.slice(0, 77)}...`;
  if (/firebase support|release notescopy|skip to main/i.test(title)) return 'See changelog';
  return title;
}
