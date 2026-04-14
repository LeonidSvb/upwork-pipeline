# Upwork Pipeline - Project Plan

## Architecture

```
Apify Scraper (jupri/upwork)
        |
        v
   PostgreSQL DB
   (raw jobs table)
        |
        v
  LLM Enrichment
 (Claude Haiku)
        |
        v
  Filter & Score
  (>= 7/10 relevant)
        |
        v
 Telegram Notification
        +
   Frontend UI
```

## Folder Structure

```
upwork-pipeline/
├── .env                          # API keys (never commit)
├── package.json
├── scraper/
│   ├── apify.js                  # Apify API client
│   └── inputs/
│       ├── all-inputs.json       # Full input schema docs + limits
│       └── my-searches.json      # Your personal search configs
├── db/
│   ├── schema.sql                # Postgres tables + view
│   ├── client.js                 # DB operations
│   └── migrate.js                # Run migrations
├── pipeline/
│   ├── scrape.js                 # Fetch from Apify -> DB
│   ├── enrich.js                 # LLM enrichment (Claude Haiku)
│   └── run.js                    # Full pipeline + cron scheduler
├── notifications/
│   └── telegram.js               # Telegram bot notifications
└── frontend/                     # TBD (see Frontend section)
```

## Scraper Findings

### Confirmed Working Inputs
| Field | Type | Notes |
|-------|------|-------|
| `search` | string | Main search query |
| `limit` | int | Max 100 on trial, unlimited paid |
| `sort` | enum | `relevance`, `newest`, `spend`, `rating` |
| `tier` | string[] | `"1"` entry, `"2"` intermediate, `"3"` expert |
| `hourly_min/max` | int | Hourly rate range (USD) |
| `fixed` | bool | Fixed-price jobs only |
| `price_min/max` | int | Fixed budget range |
| `age` + `age_unit` | int+enum | Max posting age filter |
| `contract_to_hire` | bool | C2H positions |
| `includes` | object | `{history: bool, attachments: bool}` |
| `operation` | enum | `job-search`, `job-counts`, `talents` |

### Requires Auth (`master_access_token`)
- `payment_verified`
- `previous_clients`

### Limits
- **Trial: 100 items max per run** (hard cap)
- **Paid ($30/mo): unlimited**
- ~280ms per item, timeout default 600s
- Compute: ~$0.006 per 100 items

## Pipeline Stages

### 1. Scrape (every hour, at :05)
- Run 5 search groups in sequence (each ~8-30s)
- Filter: `sort: newest`, `age: 1`, `age_unit: "hour"` → only fresh jobs
- Boolean search: `search.any` (OR) + `search.none` (exclusions)
- Insert new jobs to DB (skip duplicates via ON CONFLICT)
- Trial: 100 items max per run (paid: unlimited)

### 2. LLM Enrichment (Claude Haiku)
- Process unenriched jobs in batches of 20
- Scores: 0-10 for relevance, budget, client quality
- Boolean flags: is_relevant, is_long_term, is_good_client
- Category: ai_llm | automation | backend | scraping | other

### 3. Notify (Telegram)
- Send jobs with `overall_score >= 7` and `is_relevant = true`
- Format: title, budget, client info, LLM reasoning, link

## Frontend Options

### Option A: Next.js + shadcn/ui (Recommended)
**Pros:** Rich UI, filtering, search, real-time updates
**Cons:** More setup time

Stack: Next.js 14, shadcn/ui, postgres direct queries

### Option B: Streamlit (Quick)
**Pros:** 1 Python file, fast to build
**Cons:** Python only, less polished

### Verdict
**Use Streamlit for MVP** (2h to build), **migrate to Next.js** if you want to show it to clients.

## Setup Checklist

- [x] Project structure created
- [x] Apify scraper tested and documented
- [x] Input schema reverse-engineered
- [x] DB schema designed
- [x] Scrape pipeline code
- [x] LLM enrichment code (Claude Haiku)
- [x] Telegram notifications code
- [ ] Postgres setup (local or Supabase)
- [ ] `npm install`
- [ ] Add Telegram bot token to .env
- [ ] Add Anthropic API key to .env
- [ ] Choose and build frontend
- [ ] Test full pipeline end-to-end
- [ ] Deploy (Railway/Render + Supabase)

## Cost Estimate (Monthly)

| Service | Cost |
|---------|------|
| Apify subscription | $30/month |
| Apify compute (100 items x 4/day x 30 days) | ~$0.72 |
| Claude Haiku enrichment (12,000 jobs/month x ~500 tokens) | ~$0.90 |
| PostgreSQL (Supabase free tier) | $0 |
| Hosting (Railway hobby) | $5/month |
| **Total** | **~$37/month** |
