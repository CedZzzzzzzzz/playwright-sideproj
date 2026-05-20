
const SENTENCE_COUNT = 3;
const DATE_RE =
  /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},?\s+\d{4}\b/gi;

const MONTH_SECTION =
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2}\b/i;

const JUNK =
  /docs home|release notes copy|changelog lists new|when new versions of redis|documentation home page|select a month|you are affected if|the week of \d|stack overflow|reddit example|mailing list/i;

export function extractiveSummary(item) {
  const release = item.latestRelease;
  const raw = (item.changelogExcerpt || item.addedText || '').trim();

  if (release?.title && release.title.length > 15) {
    const s = summaryFromStructured(release);
    if (s.quality !== 'failed') return s;
  }

  if (raw.length >= 400 && !JUNK.test(raw.slice(0, 500))) {
    return summaryFromPlainText(raw);
  }

  return failed('Could not read a clear latest release — run with --fresh or fix the URL in targets.json.');
}

function summaryFromStructured(release) {
  const date = clean(release.date) || '';
  let title = clean(release.title) || '';
  title = title.replace(DATE_RE, '').trim();

  const lines = (release.lines || [])
    .map(clean)
    .filter((l) => l.length > 25 && !JUNK.test(l) && l.toLowerCase() !== title.toLowerCase());

  const sentences = [];
  if (title.length > 20) sentences.push(toSentence(title));

  for (const line of lines) {
    if (sentences.length >= SENTENCE_COUNT) break;
    const s = toSentence(line);
    if (s && !isDuplicate(s, sentences)) sentences.push(s);
  }

  return finalize(date || detectDate(title), sentences);
}

function summaryFromPlainText(text) {
  const block = pickLatestBlock(text);
  const date = block.match(DATE_RE)?.[0] || '';

  let body = block.replace(DATE_RE, '').trim();
  const stop = body.search(/\b(?:Why\??|What(?:'s| is) changing|Am I affected|Rollout#)\b/i);
  if (stop > 80) body = body.slice(0, stop);

  const titleMatch = body.match(/^(.{25,150}?)(?:\s+(?:Switch |The change |\.(?:\s|$)))/i);
  const title = titleMatch ? clean(titleMatch[1]) : '';

  const sentences = [];
  if (title.length > 20) sentences.push(toSentence(title));

  for (const part of body.split(/(?<=[.!?])\s+/)) {
    if (sentences.length >= SENTENCE_COUNT) break;
    const s = toSentence(part);
    if (s && isUseful(s) && !isDuplicate(s, sentences)) sentences.push(s);
  }

  if (sentences.length < 2) {
    for (const chunk of chunkWords(body, 90, 160)) {
      if (sentences.length >= SENTENCE_COUNT) break;
      const s = toSentence(chunk);
      if (s && isUseful(s) && !isDuplicate(s, sentences)) sentences.push(s);
    }
  }

  return finalize(date, sentences);
}

function pickLatestBlock(text) {
  const mongoMonth = text.match(/20\d{2}\s+Releases\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2})/i);
  if (mongoMonth) {
    const start = text.indexOf(mongoMonth[1]);
    const next = text.slice(start + mongoMonth[1].length).search(MONTH_SECTION);
    return text.slice(start, next > 0 ? start + mongoMonth[1].length + next : start + 2200);
  }

  const monthMatch = text.match(MONTH_SECTION);
  if (monthMatch && /Added |New commands|Redis Search|Adds support/i.test(text)) {
    const start = text.indexOf(monthMatch[0]);
    const next = text.slice(start + monthMatch[0].length).search(MONTH_SECTION);
    return text.slice(start, next > 0 ? start + monthMatch[0].length + next : start + 2200);
  }

  const dates = [...text.matchAll(DATE_RE)];
  if (dates.length === 0) return text.slice(0, 2500);

  let best = dates[0];
  for (const m of dates) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 120);
    if (/self-hosted|breaking|added|fixed|new:|announcing|now supports/i.test(after)) {
      best = m;
      break;
    }
    if (!/the week of|rollout|june 1/i.test(after) && !/the week of/i.test(m[0])) {
      best = m;
      break;
    }
  }

  const start = best.index;
  const next = dates.find((d) => d.index > start + 100);
  const end = next ? next.index : Math.min(text.length, start + 2200);
  return text.slice(start, end);
}

function finalize(date, sentences) {
  const out = [];
  for (const s of sentences) {
    if (out.length >= SENTENCE_COUNT) break;
    if (s && !isDuplicate(s, out)) out.push(s);
  }

  if (out.length === 0) {
    out.push('See the linked changelog for the latest release details.');
  } else if (out.length < SENTENCE_COUNT) {
    out.push('See the linked changelog for migration steps and full details.');
  }

  const block = [date, ...out].join(' ');
  return {
    release_title: date || out[0]?.slice(0, 50) || 'Latest release',
    release_date: date,
    sentences: out.slice(0, SENTENCE_COUNT),
    key_details: [],
    significance: guessSignificance(block),
    upgrade_recommended: /\bbreaking[\s-]?change\b|\bcve-|critical security/i.test(block),
    quality: out.filter(isUseful).length >= 2 ? 'good' : 'partial',
  };
}

function toSentence(text) {
  let t = clean(text);
  t = t.replace(/^(changelog|log|feature|change|fix|added|updated|removed|deprecated):?\s*/i, '');
  t = t.replace(/^new updates and product improvements\s*/i, '');
  t = t.replace(DATE_RE, '').trim();
  if (/^[a-z]/.test(t)) t = t.charAt(0).toUpperCase() + t.slice(1);
  if (t.length > 165) {
    const cut = t.slice(0, 165);
    t = cut.slice(0, cut.lastIndexOf(' ')).trim();
  }
  if (t && !/[.!?]$/.test(t)) t += '.';
  return t;
}

function isUseful(s) {
  return s.length > 35 && !JUNK.test(s) && !/^open the changelog/i.test(s);
}

function isDuplicate(sentence, list) {
  const key = sentence.toLowerCase().slice(0, 48);
  return list.some((s) => s.toLowerCase().slice(0, 48) === key);
}

function chunkWords(text, min, max) {
  const words = text.split(/\s+/);
  const chunks = [];
  let buf = [];
  for (const w of words) {
    buf.push(w);
    const s = buf.join(' ');
    if (s.length >= max) {
      chunks.push(s.slice(0, max).replace(/\s+\S*$/, '').trim());
      buf = [];
    }
  }
  const tail = buf.join(' ').trim();
  if (tail.length >= min) chunks.push(tail);
  return chunks;
}

function clean(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function detectDate(text) {
  return text.match(DATE_RE)?.[0] || '';
}

function failed(message) {
  return {
    release_title: 'Unavailable',
    release_date: '',
    sentences: [message],
    key_details: [],
    significance: 'low',
    upgrade_recommended: false,
    quality: 'failed',
  };
}

function guessSignificance(text) {
  const t = text.toLowerCase();
  if (/\bbreaking[\s-]?change\b|\bcve-\d|\bcritical security\b/.test(t)) return 'high';
  if (/\bdeprecated\b|\bmust upgrade\b/.test(t)) return 'medium';
  return 'low';
}
