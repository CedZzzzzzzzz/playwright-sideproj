import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import { platformSlug } from './differ.js';

const LOGS_DIR = '/app/logs';
const SCRAPE_CONCURRENCY = Math.max(1, parseInt(process.env.SCRAPE_CONCURRENCY || '3', 10));
const MIN_SNAPSHOT_CHARS = parseInt(process.env.MIN_SNAPSHOT_CHARS || '800', 10);

function isForceFresh() {
  return process.env.SNAPSHOT_REFRESH === 'true' || process.argv.includes('--fresh');
}

function isErrorPage(text, url) {
  if (text.length > 2500) return false;
  const head = text.slice(0, 400).toLowerCase();
  if (/^404\b|page not found|couldn't find that page/.test(head)) return true;
  if (text.length < 400 && /\b404\b/.test(head)) return true;
  if (url.includes('github.com') && /releases|fixed |added |updated /i.test(text)) return false;
  return false;
}

export async function scrapeAll(targets) {
  const forceFresh = isForceFresh();
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const jobs = [];
  for (const competitor of targets) {
    for (const entry of competitor.urls) {
      jobs.push({
        name: competitor.name,
        label: entry.label,
        url: entry.url,
        waitMs: entry.waitMs,
        waitUntil: entry.waitUntil,
        selector: entry.selector,
      });
    }
  }

  console.log(`[scraper] Scraping ${jobs.length} page(s), concurrency ${SCRAPE_CONCURRENCY}${forceFresh ? ', --fresh' : ''}`);

  const results = await runPool(jobs, SCRAPE_CONCURRENCY, async (job) => {
    console.log(`[scraper] ${job.name} - ${job.label}: ${job.url}`);
    try {
      let payload = await scrapePage(browser, job);
      if (isErrorPage(payload.text, job.url)) {
        throw new Error('Page looks like a 404 or error — check URL in targets.json');
      }
      if (/firebase support|get help quickly|stack overflow example/i.test(payload.text.slice(0, 800))) {
        throw new Error('Scraped support page, not release notes');
      }
      if (!payload.latestRelease?.lines?.length && payload.text.length < MIN_SNAPSHOT_CHARS) {
        console.warn(`[scraper] Short scrape (${payload.text.length} chars), retrying ${job.url}`);
        payload = await scrapePage(browser, {
          ...job,
          waitMs: Math.max(job.waitMs || 2000, 8000),
          waitUntil: 'networkidle',
        });
      }
      const snapshot = await saveSnapshot(job.name, job.label, job.url, payload, forceFresh);
      return { competitor: job.name, label: job.label, url: job.url, snapshot };
    } catch (err) {
      console.error(`[scraper] Failed ${job.url}: ${err.message}`);
      return { competitor: job.name, label: job.label, url: job.url, error: err.message };
    }
  });

  await browser.close();
  return results;
}

async function scrapePage(browser, job) {
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const waitUntil = job.waitUntil || 'domcontentloaded';
  const waitMs = job.waitMs ?? 3000;
  const selector = job.selector || 'main, article, [role="main"]';

  let page;
  try {
    page = await context.newPage();
    await page.goto(job.url, { waitUntil, timeout: 90000 });
    await page.waitForTimeout(waitMs);

    try {
      await page.waitForSelector(selector, { timeout: 12000 });
    } catch {
    }

    return await page.evaluate((sel) => {
      const DATE_RE =
        /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},?\s+\d{4}\b/i;
      const VERSION_RE = /\bv?\d+\.\d+(?:\.\d+)?(?:[-.][\w]+)?\b/i;

      const root =
        document.querySelector(sel) ||
        document.querySelector('main') ||
        document.querySelector('article') ||
        document.body;

      root
        .querySelectorAll(
          'nav, footer, script, style, noscript, svg, iframe, [aria-hidden="true"], header'
        )
        .forEach((el) => el.remove());

      function clean(s) {
        return (s || '').replace(/\s+/g, ' ').trim();
      }

      function isNoise(line) {
        return /^(assets|compare|choose a tag|immutable|👍|🚀|❤️|people reacted|read the announcement)$/i.test(
          line
        );
      }

      let latestRelease = null;

      if (location.hostname.includes('github.com')) {
        const section =
          document.querySelector('[data-test-selector="release-list"] section') ||
          document.querySelector('div[data-testid="release-card"]') ||
          [...document.querySelectorAll('section')].find((s) => VERSION_RE.test(s.innerText));

        const md = section?.querySelector('.markdown-body');
        if (section && md) {
          const version = clean(section.querySelector('h2, h3')?.innerText || '');
          const lines = md.innerText
            .split('\n')
            .map(clean)
            .filter((l) => l.length > 35 && !isNoise(l))
            .slice(0, 6);
          const title = lines[0] || version;
          latestRelease = {
            date: version.match(VERSION_RE)?.[0] || version,
            title,
            lines: lines.slice(1, 4),
          };
        }
      }

      const plain = clean(root.innerText);

      if (!latestRelease) {
        const anchor = plain.includes('2026 Releases') ? plain.indexOf('2026 Releases') : 0;
        const slice = plain.slice(anchor);
        const monthAction =
          /\b(January|February|March|April|May|June|July|August|September|October|November|December|Feb)\s+(20\d{2})\s+((?:Adds|Added|Introduces|Implemented|Fixed|Enables|Redis)\b[\s\S]+?)(?=\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Feb)\s+20\d{2}\b|Month Major|2025 Releases|\d{4} Releases|Was this page helpful)/i;
        const mm = slice.match(monthAction) || plain.match(monthAction);
        if (mm) {
          const body = clean(mm[3]);
          const sentences = body.split(/(?<=[.!?])\s+/).filter((s) => s.length > 35);
          if (sentences.length) {
            latestRelease = {
              date: `${mm[1]} ${mm[2]}`,
              title: sentences[0],
              lines: sentences.slice(1, 3),
            };
          }
        }
      }

      if (!latestRelease && /\bFeature\b/.test(plain)) {
        const firstDate = plain.match(DATE_RE)?.[0] || '';
        const start = plain.indexOf(firstDate);
        const rest = start >= 0 ? plain.slice(start) : plain;
        const nextDate = rest.slice(firstDate.length + 5).search(DATE_RE);
        const section = nextDate > 0 ? rest.slice(0, firstDate.length + 5 + nextDate) : rest.slice(0, 2800);
        const features = [...section.matchAll(/\bFeature\s+(.+?)(?=\s+Feature\s+|\s+Change\s+|\s+Announcement\s+|$)/gi)]
          .map((m) => clean(m[1]))
          .filter((t) => t.length > 30)
          .slice(0, 4);
        if (features.length >= 2) {
          latestRelease = { date: firstDate, title: features[0], lines: features.slice(1, 3) };
        }
      }

      if (!latestRelease) {
        const candidates = [...root.querySelectorAll('h1, h2, h3, h4, h5, time, p, span, a')];
        for (const el of candidates) {
          const ht = clean(el.innerText);
          const dateMatch = ht.match(DATE_RE);
          if (!dateMatch) continue;

          const container = el.closest('article, section, li') || el.parentElement;
          const block = clean(container?.innerText || '');
          const date = dateMatch[0];
          let after = block.replace(date, '').replace(/^changelog\s*/i, '').trim();

          const stop = after.search(
            /\b(?:Why\??|What(?:'s| is) changing|Am I affected|Rollout|Read the announcement)\b/i
          );
          if (stop > 0) after = after.slice(0, stop);

          const titleMatch = after.match(
            /^(.{25,140}?)(?:\s+(?:Switch |The change |You can |Read |Announcing |— ))/i
          );
          const title = titleMatch ? clean(titleMatch[1]) : clean(after.slice(0, 120));

          if (/documents production updates|docs home|copy page/i.test(title)) continue;

          const detailParts = after
            .replace(title, '')
            .split(/(?<=[.!?])\s+/)
            .map(clean)
            .filter((l) => l.length > 40 && !DATE_RE.test(l))
            .slice(0, 3);

          if (title.length > 20) {
            latestRelease = { date, title, lines: detailParts };
            break;
          }
        }
      }

      if (!latestRelease && /Month Major changes/.test(plain)) {
        const row = plain.match(
          /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\s+([^]+?)(?=\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2}\b|Month Major|RATE THIS)/i
        );
        if (row) {
          latestRelease = {
            date: `${row[1]} ${row[2]}`,
            title: clean(row[3]).slice(0, 160),
            lines: [],
          };
        }
      }

      if (latestRelease?.title) {
        latestRelease.title = clean(
          latestRelease.title
            .replace(/^changelog\s*/i, '')
            .replace(/^(?:rss\s+)?copy as markdown\s*/i, '')
            .replace(/\s+Read the announcement.*$/i, '')
            .replace(/^Log\s+New updates.*?(?=Self-hosted|Announcing|[A-Z])/i, '')
        );
      }

      return { text: plain, latestRelease };
    }, selector);
  } finally {
    await context.close();
  }
}

async function saveSnapshot(competitor, label, url, payload, forceFresh) {
  const today = new Date().toISOString().split('T')[0];
  const dir = path.join(LOGS_DIR, today);
  await fs.mkdir(dir, { recursive: true });

  const slug = platformSlug(competitor, label);
  const filepath = path.join(dir, `${slug}.json`);

  if (!forceFresh) {
    try {
      await fs.access(filepath);
      const existing = JSON.parse(await fs.readFile(filepath, 'utf-8'));
      if ((existing.text || '').length >= MIN_SNAPSHOT_CHARS || existing.latestRelease?.lines?.length) {
        console.log(`[scraper] Snapshot exists -> ${filepath}`);
        return existing;
      }
    } catch {
      /* new */
    }
  }

  const snapshot = {
    competitor,
    label,
    url,
    date: today,
    scrapedAt: new Date().toISOString(),
    text: payload.text,
    latestRelease: payload.latestRelease,
  };
  await fs.writeFile(filepath, JSON.stringify(snapshot, null, 2));
  const lr = payload.latestRelease?.lines?.length || 0;
  console.log(`[scraper] Saved snapshot (${payload.text.length} chars, ${lr} release lines) -> ${filepath}`);
  return snapshot;
}

async function runPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}
