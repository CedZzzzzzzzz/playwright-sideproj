# Patch Notes Monitor

Daily digest for **BaaS and database changelog pages** (Supabase, MongoDB, Firebase, Appwrite, etc.). The tool scrapes official release pages, detects when something new was published, and writes a short **3-bullet summary** per platform.

Summaries can run in three modes:

| Mode | Uses local AI (Ollama)? | When to use |
|------|-------------------------|-------------|
| `fast` | No | Quick demo, low RAM, no model download |
| `hybrid` | Only on **new** patches | **Recommended** for daily use |
| `ai` | Every run | Best prose, slowest |

**Local AI** runs entirely in Docker via [Ollama](https://ollama.com/) — no cloud API keys required.

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
- **8 GB RAM** minimum if using Ollama (`hybrid` / `ai`); `fast` mode is lighter
- Internet access from Docker (to reach changelog URLs)

---

## Quick start

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

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| `EADDRINUSE` on port 3000 | Another UI instance running; stop it or change `UI_PORT` |
| Scrape timeouts / `ERR_NAME_NOT_RESOLVED` | Docker DNS/network; restart Docker |
| Only 2 platforms in report | Some scrapes failed — check Step 1 logs; re-run with `--fresh` |
| Always says `(fast)` in hybrid | Normal if **no new patch** today; use `--fresh` on first run or wait for a real changelog update |
| Ollama `model not found` | Run `docker compose exec ollama ollama pull (ollama model to be used)` |

---
