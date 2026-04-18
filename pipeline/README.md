# Pipeline

Оркестрация скрейпинга, обогащения и уведомлений.

## Файлы

**scrape.js** — скрейпит джобы через Apify, сохраняет в БД.
Поисковые запросы: `scraper/inputs/my-searches.json` (age, keywords, лимиты).
Принимает параметр `age` (минуты) — сколько времени назад искать.

**enrich.js** — двухэтапное LLM-обогащение новых джобов.
Этап 1: filter.txt (нишевый фильтр, дешёвая модель).
Этап 2: score.txt (скоринг, только релевантные).
Результат сохраняется в `job_enrichments.llm_result` (JSONB).

**run.js** — экспортирует `fullPipeline()`: scrape → enrich → notify.
Вызывается из Telegram бота по командам /run, /start_jobs.

**run-once.js** — разовый запуск для дебага/теста.

## Запуск вручную

```bash
node pipeline/scrape.js    # только скрейп
node pipeline/enrich.js    # только обогащение pending джобов
```
