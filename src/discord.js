/**
 * Discord incoming webhook (optional).
 * Set WEBHOOK_URL or DISCORD_WEBHOOK_URL in .env — see env.example.
 */

function webhookUrl() {
  return (process.env.DISCORD_WEBHOOK_URL || process.env.WEBHOOK_URL || '').trim();
}

function onlyNewPatches() {
  if (
    process.env.DISCORD_WEBHOOK_ONLY_NEW_PATCHES === 'true' ||
    process.env.DISCORD_WEBHOOK_ONLY_NEW_PATCHES === '1'
  ) {
    return true;
  }
  return (process.env.WEBHOOK_NOTIFY_ON || 'always').toLowerCase() === 'new';
}

const FILLER = /see the (full |linked )?changelog|further details were not available/i;

export function isDiscordConfigured() {
  return Boolean(webhookUrl());
}

export async function sendDiscordDigest(summaries, date) {
  const url = webhookUrl();
  if (!url) return;

  const newCount = summaries.filter((s) => s.hasNewPatch && s.summary).length;
  if (onlyNewPatches() && newCount === 0) {
    console.log('[discord] Skipping webhook — no new patches (WEBHOOK_NOTIFY_ON=new).');
    return;
  }

  const embeds = buildEmbeds(summaries, date, newCount);
  const chunks = chunkEmbeds(embeds, 10);

  try {
    for (let i = 0; i < chunks.length; i++) {
      const body = {
        username: 'Patch Notes Monitor',
        embeds: chunks[i],
      };
      if (i === 0) {
        body.content =
          newCount > 0
            ? `🆕 **${newCount} new patch(es)** on ${date}`
            : `📋 Patch notes digest — ${date} (no new patches)`;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Discord ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
      }
    }
    console.log(`[discord] Webhook sent (${chunks.length} message(s)).`);
  } catch (err) {
    console.error(`[discord] Webhook failed: ${err.message}`);
  }
}

function buildEmbeds(summaries, date, newCount) {
  const embeds = [
    {
      title: `Patch Notes — ${date}`,
      description: `**${newCount}** new · **${summaries.length}** platforms monitored`,
      color: newCount > 0 ? 0xf5a623 : 0x3dd6c3,
      timestamp: new Date().toISOString(),
    },
  ];

  const items = onlyNewPatches()
    ? summaries.filter((s) => s.hasNewPatch)
    : summaries;

  for (const item of items) {
    const platform = item.platform || item.competitor;
    const s = item.summary || item.lastKnown?.summary;
    const sentences = pickSentences(s);

    if (item.summaryError && !s) {
      embeds.push({
        title: `⚠️ ${platform}`,
        description: truncate(item.summaryError, 500),
        url: item.url || undefined,
        color: 0xed4245,
      });
      continue;
    }

    const status = item.hasNewPatch ? '🆕 New patch' : '✅ No update';
    const title = cleanTitle(s?.release_title);
    const bullets = sentences.map((line) => `• ${line}`).join('\n') || '_No summary text._';
    const impact = s?.significance ? `\n**Impact:** ${String(s.significance).toUpperCase()}` : '';

    embeds.push({
      title: `${platform} — ${status}`,
      description: truncate(`**Latest:** ${title}\n\n${bullets}${impact}`, 3900),
      url: item.url || undefined,
      color: item.hasNewPatch ? 0xf5a623 : 0x5865f2,
    });
  }

  return embeds;
}

function chunkEmbeds(embeds, size) {
  const chunks = [];
  for (let i = 0; i < embeds.length; i += size) {
    chunks.push(embeds.slice(i, i + size));
  }
  return chunks;
}

function pickSentences(s) {
  if (!s?.sentences) return [];
  return s.sentences.filter((d) => d && !FILLER.test(d) && d.length > 25).slice(0, 3);
}

function cleanTitle(title) {
  if (!title || /^latest release$/i.test(title)) return 'See changelog';
  if (title.length > 120) return `${title.slice(0, 117)}...`;
  return title;
}

function truncate(text, max) {
  const t = String(text || '');
  return t.length <= max ? t : `${t.slice(0, max - 3)}...`;
}
