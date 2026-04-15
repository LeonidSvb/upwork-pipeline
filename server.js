import 'dotenv/config';
import express from 'express';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const PORT = process.env.PORT || 3000;

app.use(express.static(resolve(__dirname, 'public')));

// GET /api/jobs - список вакансий с фильтрами
app.get('/api/jobs', async (req, res) => {
  try {
    const {
      minScore = 0,
      maxProposals = '',
      category = '',
      type = '',
      notified = '',
      limit = 50,
      offset = 0,
      sort = 'score',
    } = req.query;

    const conditions = ['e.job_id IS NOT NULL'];
    const params = [];
    let p = 1;

    if (minScore > 0) {
      conditions.push(`e.overall_score >= $${p++}`);
      params.push(Number(minScore));
    }
    if (maxProposals !== '') {
      conditions.push(`(j.total_applicants IS NULL OR j.total_applicants <= $${p++})`);
      params.push(Number(maxProposals));
    }
    if (category) {
      conditions.push(`e.primary_category = $${p++}`);
      params.push(category);
    }
    if (type) {
      conditions.push(`j.type = $${p++}`);
      params.push(type.toUpperCase());
    }
    if (notified === 'yes') {
      conditions.push(`n.job_id IS NOT NULL`);
    } else if (notified === 'no') {
      conditions.push(`n.job_id IS NULL`);
    }

    const sortMap = {
      score: 'e.overall_score DESC, j.ts_publish DESC',
      newest: 'j.ts_publish DESC',
      proposals: 'j.total_applicants ASC NULLS FIRST',
    };
    const orderBy = sortMap[sort] || sortMap.score;

    params.push(Number(limit), Number(offset));

    const { rows } = await pool.query(
      `SELECT
        j.id, j.title, j.url, j.type, j.ts_publish, j.scraped_at,
        j.hourly_min, j.hourly_max, j.fixed_budget,
        j.client_country, j.client_score, j.client_total_spend, j.total_applicants,
        j.level, j.category, j.skills,
        e.overall_score, e.is_relevant, e.primary_category,
        e.tags, e.llm_reasoning, e.rejection_reasons,
        e.is_good_client, e.is_long_term, e.is_budget_ok,
        n.job_id IS NOT NULL AS notified
       FROM jobs j
       JOIN job_enrichments e ON j.id = e.job_id
       LEFT JOIN notifications n ON j.id = n.job_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT $${p++} OFFSET $${p++}`,
      params
    );

    // Итого без пагинации
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) FROM jobs j
       JOIN job_enrichments e ON j.id = e.job_id
       LEFT JOIN notifications n ON j.id = n.job_id
       WHERE ${conditions.join(' AND ')}`,
      params.slice(0, -2)
    );

    res.json({ jobs: rows, total: Number(countRows[0].count) });
  } catch (err) {
    console.error('[api] /jobs error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats
app.get('/api/stats', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM jobs) AS total_jobs,
        (SELECT COUNT(*) FROM job_enrichments) AS enriched,
        (SELECT COUNT(*) FROM job_enrichments WHERE is_relevant = true) AS relevant,
        (SELECT COUNT(*) FROM job_enrichments WHERE overall_score >= 7) AS high_score,
        (SELECT COUNT(*) FROM notifications) AS notified,
        (SELECT COUNT(*) FROM scrape_runs WHERE status = 'succeeded') AS successful_runs,
        (SELECT MAX(finished_at) FROM scrape_runs WHERE status = 'succeeded') AS last_run
    `);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export function startServer() {
  app.listen(PORT, () => {
    console.log(`[server] Running at http://localhost:${PORT}`);
  });
}
