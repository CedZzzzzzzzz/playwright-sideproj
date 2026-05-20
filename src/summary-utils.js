const PLACEHOLDER = /^(?:s[1-5]|fact|version or date|factual sentences|short bullet|longer bullet|high-level bullet|key_details)$/i;

export function isValidSummary(s) {
  if (!s?.sentences?.length || s.sentences.length < 2 || s.quality === 'failed') return false;
  if (PLACEHOLDER.test((s.release_title || '').trim())) return false;
  const useful = s.sentences.filter(
    (t) => t.length > 30 && !PLACEHOLDER.test(t) && !/see the (full )?changelog/i.test(t)
  );
  return useful.length >= 2 && useful.length <= 3;
}

export function normalizeSummary(raw) {
  const s = { ...raw };
  if (!Array.isArray(s.sentences) || s.sentences.length < 5) {
    const text = typeof s.summary === 'string' ? s.summary : '';
    const parts = text.split(/(?<=[.!?])\s+/).map((p) => p.trim()).filter((p) => p.length > 25);
    s.sentences =
      parts.length >= 5
        ? parts.slice(0, 5)
        : pad(parts, text, 'See the full changelog for more details.');
  } else {
    s.sentences = s.sentences.map((x) => x.replace(/^\d+\.\s*/, '').trim()).slice(0, 5);
  }
  if (!s.release_title && s.patchFingerprint) {
    s.release_title = String(s.patchFingerprint).split('|')[0];
  }
  return s;
}

export function parseOllamaText(text) {
  const out = { release_title: '', release_date: '', sentences: [], key_details: [], significance: 'medium', upgrade_recommended: false };
  for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m =
      line.match(/^RELEASE:\s*(.+)/i) ||
      line.match(/^SIGNIFICANCE:\s*(\w+)/i) ||
      line.match(/^UPGRADE:\s*(yes|no)/i) ||
      line.match(/^[-*]\s+(.+)/) ||
      line.match(/^\d+\.\s+(.+)/);
    if (!m) continue;
    if (/^RELEASE:/i.test(line)) out.release_title = m[1].trim();
    else if (/^SIGNIFICANCE:/i.test(line)) out.significance = m[1].toLowerCase();
    else if (/^UPGRADE:/i.test(line)) out.upgrade_recommended = m[1].toLowerCase() === 'yes';
    else if (/^[-*]/.test(line) && out.key_details.length < 5 && m[1].length > 3) out.key_details.push(m[1].trim());
    else if (/^\d+\./.test(line) && m[1].length > 10 && out.sentences.length < 5) out.sentences.push(m[1].trim());
  }
  return out;
}

function pad(parts, fallback, filler) {
  const out = [...parts];
  while (out.length < 5) out.push(out.length === 0 && fallback ? fallback.slice(0, 280) : filler);
  return out.slice(0, 5);
}
