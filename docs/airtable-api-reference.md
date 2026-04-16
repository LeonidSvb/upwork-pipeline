---
title: Airtable API Reference
description: Endpoints used in upwork-pipeline for Ideas table
---

# Airtable API Reference

Base URL: `https://api.airtable.com`

## Auth

All requests: `Authorization: Bearer <AIRTABLE_TOKEN>`

Token scopes needed:
- `data:records:read` — читать записи
- `data:records:write` — создавать/обновлять записи
- `schema:bases:read` — читать схему (поля, таблицы)
- `schema:bases:write` — изменять схему (переименовывать choices, менять типы полей)

Создать/обновить токен: https://airtable.com/create/tokens

---

## Records

### Создать запись
```
POST /v0/{baseId}/{tableId}
Content-Type: application/json

{
  "fields": {
    "title": "...",
    "raw": "...",
    "category": "upwork",
    "priority": "high",
    "status": "new",
    "date": "2026-04-16"
  }
}
```

### Получить записи
```
GET /v0/{baseId}/{tableId}?maxRecords=10&sort[0][field]=date&sort[0][direction]=desc
```

### Обновить запись
```
PATCH /v0/{baseId}/{tableId}/{recordId}
Content-Type: application/json

{
  "fields": {
    "status": "doing"
  }
}
```

### Удалить запись
```
DELETE /v0/{baseId}/{tableId}/{recordId}
```

---

## Schema (требует scope: schema:bases:write)

### Список таблиц + поля
```
GET /v0/meta/bases/{baseId}/tables
```

### Обновить поле (переименовать choices у singleSelect)
```
PATCH /v0/meta/bases/{baseId}/tables/{tableId}/fields/{fieldId}
Content-Type: application/json

{
  "name": "category",
  "type": "singleSelect",
  "options": {
    "choices": [
      { "id": "selOrpJzb4cqsDMUz", "name": "upwork" },
      { "id": "sel3DOZ8GVUT3PYg6", "name": "product" },
      { "id": "selF0h8txTzQbIIfE", "name": "outreach" },
      { "id": "selOIZZiWJmq3sUvo", "name": "learning" },
      { "id": "selAUZUYm3PQbtkmO", "name": "business" },
      { "id": "sel7jJ24LrxqNFvmJ", "name": "life" },
      { "id": "sel4NGmmpV3oj38dv", "name": "other" }
    ]
  }
}
```

### Создать новое поле
```
POST /v0/meta/bases/{baseId}/tables/{tableId}/fields
Content-Type: application/json

{
  "name": "tags",
  "type": "multilineText"
}
```

---

## Текущие IDs (upwork-pipeline)

| Переменная | Значение |
|---|---|
| AIRTABLE_BASE_ID | из .env |
| AIRTABLE_TABLE_ID | tblnxUOzl6OTsW4IP |
| field: category | fldI6Y2wEVcIKjANR |
| field: priority | (сверь через GET /tables) |

### Choices поля category (текущие IDs)
| ID | Нужное имя |
|---|---|
| selOrpJzb4cqsDMUz | upwork |
| sel3DOZ8GVUT3PYg6 | product |
| selF0h8txTzQbIIfE | outreach |
| selOIZZiWJmq3sUvo | learning |
| selAUZUYm3PQbtkmO | business |
| sel7jJ24LrxqNFvmJ | life |
| sel4NGmmpV3oj38dv | other |
