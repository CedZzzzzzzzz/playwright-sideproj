import { isValidSummary, normalizeSummary, parseOllamaText } from './summary-utils.js';

const HOST = process.env.OLLAMA_HOST || 'http://ollama:11434';
const MODEL = process.env.OLLAMA_MODEL || 'llama3.2:1b';
const SMALL = /tinyllama|1b|1\.b|phi|qwen2\.5:0\.5/i.test(MODEL);
const NUM_PREDICT = intEnv('OLLAMA_NUM_PREDICT', SMALL ? 280 : 450);
const TIMEOUT_MS = intEnv('OLLAMA_TIMEOUT_MS', 300000);
const RETRIES = Math.max(1, intEnv('OLLAMA_RETRIES', 3));
const COOLDOWN_MS = intEnv('OLLAMA_COOLDOWN_MS', 3000);
const EXCERPT_CHARS = intEnv('SUMMARY_EXCERPT_CHARS', SMALL ? 1800 : 3200);

function intEnv(key, fallback) {
  return parseInt(process.env[key] || String(fallback), 10);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtErr = (e) => [e?.message, e?.cause?.message].filter(Boolean).join(' — ') || String(e);

export async function ensureOllamaReady() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${HOST}/api/tags`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`tags ${res.status}`);
      const names = (await res.json()).models?.flatMap((m) => [m.name, m.model].filter(Boolean)) || [];
      if (!names.some((n) => n === MODEL || n.startsWith(`${MODEL}:`))) {
        throw new Error(`Model "${MODEL}" not found — run: docker compose exec ollama ollama pull ${MODEL}`);
      }
      console.log(`[summarizer] Ollama ready (${MODEL})`);
      return;
    } catch (err) {
      console.warn(`[summarizer] Waiting for Ollama… (${fmtErr(err)})`);
      await sleep(3000);
    }
  }
  throw new Error(`Ollama not reachable at ${HOST}`);
}

export async function summarizeWithOllama(item, mode) {
  const excerpt = (n) => (item.changelogExcerpt || item.addedText || '').slice(0, n);
  const scope = mode === 'patch' ? 'NEWEST update only' : 'TOP release only';
  const hint = item.patchFingerprint ? ` (${String(item.patchFingerprint).split('|')[0]})` : '';

  const passes = SMALL
    ? [EXCERPT_CHARS, Math.floor(EXCERPT_CHARS * 0.75)].map((n) => ({
        prompt: [`Platform: ${item.platform}${hint}`, `Summarize the ${scope}.`, '', excerpt(n), '', 'Reply with facts:', '1. ', '2. ', '3. ', 'RELEASE:', 'SIGNIFICANCE: low', 'UPGRADE: no'].join('\n'),
        json: false,
      }))
    : [
        {
          json: true,
          prompt: [`Summarize ${item.platform} changelog.`, scope + '.', '', excerpt(EXCERPT_CHARS), '', 'JSON: release_title, release_date, sentences[5], key_details[2], significance, upgrade_recommended'].join('\n'),
        },
        {
          json: false,
          prompt: [`Summarize ${item.platform} ${mode === 'patch' ? 'update' : 'latest release'}.`, excerpt(EXCERPT_CHARS), '', '5 numbered sentences. RELEASE:, SIGNIFICANCE:, UPGRADE:, two bullets.'].join('\n'),
        },
      ];

  let lastErr;
  for (let i = 0; i < passes.length; i++) {
    try {
      const raw = await callOllama(passes[i].prompt, passes[i].json);
      const summary = normalizeSummary(typeof raw === 'string' ? parseOllamaText(raw) : raw);
      if (isValidSummary(summary)) return summary;
      console.warn(`[summarizer] Low-quality output for ${item.platform} — retry ${i + 1}/${passes.length}`);
    } catch (err) {
      lastErr = err;
      console.warn(`[summarizer] Pass ${i + 1} failed: ${fmtErr(err)}`);
    }
    await sleep(2000);
  }
  throw lastErr || new Error('Model returned invalid summary');
}

async function callOllama(prompt, useJson) {
  let lastErr;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const body = {
        model: MODEL,
        prompt,
        stream: false,
        options: { num_predict: NUM_PREDICT, temperature: 0.1, top_p: 0.9, ...(SMALL ? { num_ctx: 2048, num_batch: 128 } : {}) },
      };
      if (useJson && !SMALL) body.format = 'json';

      const res = await fetch(`${HOST}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`Ollama ${res.status}${t ? `: ${t.slice(0, 80)}` : ''}`);
      }
      const data = await res.json();
      await sleep(COOLDOWN_MS);
      if (useJson && !SMALL) {
        try {
          return JSON.parse(data.response);
        } catch {
          return parseOllamaText(data.response);
        }
      }
      return parseOllamaText(data.response);
    } catch (err) {
      lastErr = err;
      if (attempt < RETRIES) {
        await sleep(4000 * attempt);
        console.warn(`[summarizer] Retry ${attempt}/${RETRIES}: ${fmtErr(err)}`);
      }
    }
  }
  throw lastErr;
}
