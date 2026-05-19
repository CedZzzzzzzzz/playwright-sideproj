import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';

const LOGS_DIR = '/app/logs';

export async function scrapeAll(targets) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const results = [];

  for (const competitor of targets) {
    for (const { label, url } of competitor.urls) {
      console.log(`[scraper] Scraping ${competitor.name} - ${label}: ${url}`);
      try {
        const text = await scrapePage(browser, url);
        const snapshot = await saveSnapshot(competitor.name, label, url, text);
        results.push({ competitor: competitor.name, label, url, snapshot });
      } catch (err) {
        console.error(`[scraper] Failed to scrape ${url}: ${err.message}`);
        results.push({ competitor: competitor.name, label, url, error: err.message });
      }
    }
  }

  await browser.close();
  return results;
}

async function scrapePage(browser, url) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  let page;
  try {
    page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);

    const text = await page.evaluate(() => {
      const remove = document.querySelectorAll(
        'nav, footer, script, style, noscript, svg, iframe, [aria-hidden="true"]'
      );
      remove.forEach((el) => el.remove());
      return document.body.innerText.replace(/\s+/g, ' ').trim();
    });

    return text;
  } finally {
    await context.close();
  }
}

async function saveSnapshot(competitor, label, url, text) {
  const today = new Date().toISOString().split('T')[0];
  const dir = path.join(LOGS_DIR, today);
  await fs.mkdir(dir, { recursive: true });

  const slug = `${competitor}-${label}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const filepath = path.join(dir, `${slug}.json`);

  try {
    await fs.access(filepath);
    console.log(`[scraper] Snapshot already exists for today, skipping -> ${filepath}`);
    const raw = await fs.readFile(filepath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    // doesn't exist yet, proceed to save
  }

  const snapshot = { competitor, label, url, date: today, scrapedAt: new Date().toISOString(), text };
  await fs.writeFile(filepath, JSON.stringify(snapshot, null, 2));
  console.log(`[scraper] Saved snapshot -> ${filepath}`);
  return snapshot;
}