# Patch Notes Monitor

Daily digest for **BaaS and database changelog pages** (Supabase, MongoDB, Firebase, Appwrite, etc.). The tool scrapes official release pages, detects when something new was published, and writes a short **3-sentence summary** per platform.

Summaries can run in three modes:

| Mode | Uses local AI (Ollama)? | When to use |
|------|-------------------------|-------------|
| `fast` | No | Quick demo, low RAM, no model download |
| `hybrid` | Only on **new** patches | **Recommended** for daily use |
| `ai` | Every run | Best prose, slowest |

**Local AI** runs entirely in Docker via [Ollama](https://ollama.com/) — no cloud API keys required. Nothing is sent to an external LLM unless you add that yourself later.

---

## What it does

1. **Scrape** — Playwright loads each URL in `targets.json`.
2. **Diff** — Compares today’s page to the last saved snapshot (by date/version fingerprint).
3. **Summarize** — Builds a readable digest (extractive or Ollama).
4. **Report** — Writes `logs/YYYY-MM-DD/report.md` and `report.json`.
5. **Dashboard** — Optional web UI at http://localhost:3000 to browse reports.

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows/Mac/Linux)
- **~8 GB RAM** minimum if using Ollama (`hybrid` / `ai`); `fast` mode is lighter
- Internet access from Docker (to reach changelog URLs)

---

## Quick start (for reviewers / your lead)

### 1. Clone and configure

```bash
git clone <repo-url>
cd playwright-sideproj
cp env.example .env
```

For a **fast demo without waiting on AI**, set in `.env`:

```env
SUMMARY_MODE=fast
```

For the **intended setup with local AI**:

```env
SUMMARY_MODE=hybrid
```

### 2. Start services

```bash
docker compose up --build -d
```

This starts:

| Service | Purpose |
|---------|---------|
| `ollama` | Local LLM server (port 11434) |
| `monitor` | Scheduler + scraper (runs daily via cron) |
| `dashboard` | Web UI on **http://localhost:3000** |

### 3. Pull the AI model (only if `hybrid` or `ai`)

First run only — downloads ~1.3 GB for `llama3.2:1b`:

```bash
docker compose exec ollama ollama pull llama3.2:1b
```

### 4. Run a full pipeline once

```bash
docker compose exec monitor node src/index.js --now --fresh
```

| Flag | Meaning |
|------|---------|
| `--now` | Run immediately (don’t wait for 8:00 cron) |
| `--fresh` | Re-scrape all pages and clear cached summaries |

Expect **2–10 minutes** depending on network and `SUMMARY_MODE`.

### 5. View results

**Web UI:** open http://localhost:3000  

**Files:**

- `logs/2026-05-20/report.md` — human-readable digest
- `logs/2026-05-20/report.json` — same data for the dashboard
- `logs/state/` — cached summaries between runs

---

## Testing without local AI (fastest path)

If your lead only wants to verify scraping + UI **without** Ollama:

1. Set `SUMMARY_MODE=fast` in `.env`
2. `docker compose up --build -d` (Ollama still starts but is unused)
3. `docker compose exec monitor node src/index.js --now --fresh`
4. Open http://localhost:3000

Summaries will be **short excerpts** from each changelog, not paraphrased AI text.

---

## Testing with local AI

1. Set `SUMMARY_MODE=hybrid` or `ai` in `.env`
2. `docker compose up --build -d`
3. `docker compose exec ollama ollama pull llama3.2:1b`
4. `docker compose exec monitor node src/index.js --now --fresh`

**Logs to confirm AI is running:**

```text
[index] Step 3/4 — Summarizing (mode: hybrid)...
[summarizer] Ollama ready (llama3.2:1b)
[summarizer] Summarizing — Supabase - changelog (ai)
```

On a **second run the same day** with no changelog changes, expect `Cache hit` and `(fast)` — hybrid only calls Ollama when a **new patch** is detected.

---

## Common commands

```bash
# Start everything
docker compose up -d

# Rebuild after code changes
docker compose up --build -d

# Run pipeline now
docker compose exec monitor node src/index.js --now

# Force full re-scrape + new summaries
docker compose exec monitor node src/index.js --now --fresh

# Scrape only (no summaries, quick smoke test)
docker compose exec monitor node src/index.js --now --dry-run

# Check Ollama models
docker compose exec ollama ollama list

# View monitor logs
docker compose logs -f monitor

# Stop everything
docker compose down
```

---

## Configuration

Edit `.env` (see `env.example`):

| Variable | Description |
|----------|-------------|
| `SUMMARY_MODE` | `fast` \| `hybrid` \| `ai` |
| `OLLAMA_MODEL` | Model name (default `llama3.2:1b`) |
| `CRON_SCHEDULE` | When the monitor runs daily (default 08:00) |
| `SCRAPE_CONCURRENCY` | Parallel browser tabs (default 2–3; lower = more stable) |

Edit **`targets.json`** to add/remove platforms or fix changelog URLs.

---

## Project layout

```text
src/
  index.js           # Entry: cron + --now / --fresh / --dry-run
  scraper.js         # Playwright changelog scraping
  differ.js          # Detect new patches vs previous day
  summarizer.js      # fast / hybrid / ai routing + cache
  ollama-summarize.js# Local LLM calls
  extractive.js      # No-AI summaries
  reporter.js        # report.md + report.json
  server.js          # Dashboard API
ui/                  # Web dashboard (HTML/CSS/JS)
logs/                # Reports + snapshots (gitignored)
targets.json         # Platforms to monitor
docker-compose.yml   # ollama + monitor + dashboard
```

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| `EADDRINUSE` on port 3000 | Another UI instance running; stop it or change `UI_PORT` |
| Scrape timeouts / `ERR_NAME_NOT_RESOLVED` | Docker DNS/network; restart Docker; set `SCRAPE_CONCURRENCY=1` |
| Only 2 platforms in report | Some scrapes failed — check Step 1 logs; re-run with `--fresh` |
| Always says `(fast)` in hybrid | Normal if **no new patch** today; use `--fresh` on first run or wait for a real changelog update |
| Ollama `model not found` | Run `docker compose exec ollama ollama pull llama3.2:1b` |
| Slow on 8 GB RAM | Use `SUMMARY_MODE=fast` or `hybrid`; avoid `ai` |

---

## Security note

- Changelog pages are fetched **from inside the monitor container** (outbound HTTPS only).
- **Ollama runs locally** in Docker; scraped text is sent to `http://ollama:11434` on the Docker network, not to the public internet.
- Do not commit `.env` or `logs/` (both are gitignored).

---

## License

Internal / side project — adjust as needed for your organization.
