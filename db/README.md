# DB

PostgreSQL через Supabase. Подключение через `DATABASE_URL` в `.env`.

## Файлы

**client.js** — все запросы к БД (экспортирует функции для остальных модулей).
**schema.sql** — полная схема таблиц.
**migrate.js** — запускает schema.sql (базовая инициализация).
**migrations/** — инкрементальные миграции, запускать вручную при обновлениях.

## Таблицы

| Таблица | Что хранит |
|---|---|
| `jobs` | Сырые джобы из Apify |
| `job_enrichments` | LLM результаты. `overall_score` (INT) для фильтрации, `llm_result` + `filter_result` (JSONB) для деталей |
| `notifications` | Какие джобы уже отправлены в Telegram |
| `job_feedback` | Реакции: applied / maybe / bad / skip |
| `scrape_runs` | Лог запусков скрейпера |

## Миграции

```bash
# Применить конкретную миграцию
node -e "require('dotenv/config'); ..." # см. примеры в db/migrations/
```
