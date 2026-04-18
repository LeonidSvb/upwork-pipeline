import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function mapJobToDb(item) {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    url: item.url,
    type: item.type,
    ts_publish: item.ts_publish,
    ts_create: item.ts_create,
    hourly_min: item.hourly?.min ?? null,
    hourly_max: item.hourly?.max ?? null,
    fixed_budget: item.fixed?.budget?.amount ?? null,
    client_country: item.buyer?.location?.country ?? null,
    client_score: item.buyer?.stats?.score ?? null,
    client_total_spend: item.buyer?.stats?.totalCharges?.amount ?? null,
    client_total_jobs: item.buyer?.jobs?.postedCount ?? null,
    client_hire_rate: item.buyer?.hireRate ?? null,
    client_payment_verified: item.isPaymentMethodVerified ?? null,
    level: item.level ?? null,
    category: item.category?.name ?? null,
    category_group: item.categoryGroup?.name ?? null,
    skills: JSON.stringify(item.skills ?? []),
    qualifications: JSON.stringify(item.qualifications ?? {}),
    total_applicants: item.clientActivity?.totalApplicants ?? null,
    invited_to_interview: item.clientActivity?.totalInvitedToInterview ?? null,
    raw: JSON.stringify(item),
  };
}

export async function upsertJobs(items, preFilter = {}) {
  let newCount = 0;
  let skippedCount = 0;
  const {
    excludeCountries = [],
    fixedMin = 0,
    hourlyMin = 0,
    proposalsMax = Infinity,
  } = preFilter;

  const excludeLower = excludeCountries.map(c => c.toLowerCase());

  for (const item of items) {
    const j = mapJobToDb(item);

    // Pre-filter: country exclusion
    if (j.client_country && excludeLower.includes(j.client_country.toLowerCase())) {
      skippedCount++;
      continue;
    }

    // Pre-filter: budget minimums
    if (j.type === 'FIXED' && j.fixed_budget !== null && j.fixed_budget < fixedMin) {
      skippedCount++;
      continue;
    }
    if (j.type === 'HOURLY' && j.hourly_max !== null && j.hourly_max < hourlyMin) {
      skippedCount++;
      continue;
    }

    // Pre-filter: too many proposals
    if (j.total_applicants !== null && j.total_applicants > proposalsMax) {
      skippedCount++;
      continue;
    }

    const result = await pool.query(
      `INSERT INTO jobs (
        id, title, description, url, type, ts_publish, ts_create,
        hourly_min, hourly_max, fixed_budget,
        client_country, client_score, client_total_spend, client_total_jobs,
        client_hire_rate, client_payment_verified,
        level, category, category_group, skills, qualifications,
        total_applicants, invited_to_interview, raw
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
      )
      ON CONFLICT (id) DO UPDATE SET
        total_applicants = EXCLUDED.total_applicants,
        invited_to_interview = EXCLUDED.invited_to_interview,
        raw = EXCLUDED.raw,
        updated_at = NOW()
      RETURNING (xmax = 0) AS inserted`,
      [
        j.id, j.title, j.description, j.url, j.type, j.ts_publish, j.ts_create,
        j.hourly_min, j.hourly_max, j.fixed_budget,
        j.client_country, j.client_score, j.client_total_spend, j.client_total_jobs,
        j.client_hire_rate, j.client_payment_verified,
        j.level, j.category, j.category_group, j.skills, j.qualifications,
        j.total_applicants, j.invited_to_interview, j.raw,
      ]
    );
    if (result.rows[0]?.inserted) newCount++;
  }

  if (skippedCount > 0) console.log(`[upsert] Skipped by pre-filter: ${skippedCount}`);
  return { newCount, skippedCount };
}

export async function getJobsToEnrich(limit = 20) {
  const { rows } = await pool.query(
    `SELECT j.id, j.title, j.description, j.type, j.level,
            j.hourly_min, j.hourly_max, j.fixed_budget,
            j.client_country, j.client_score, j.client_total_spend,
            j.category, j.skills
     FROM jobs j
     LEFT JOIN job_enrichments e ON j.id = e.job_id
     WHERE e.job_id IS NULL
       AND j.scraped_at >= NOW() - INTERVAL '3 days'
       AND (j.total_applicants IS NULL OR j.total_applicants <= 30)
     ORDER BY j.ts_publish DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function saveEnrichment(jobId, enrichment) {
  await pool.query(
    `INSERT INTO job_enrichments (
      job_id, model, overall_score, llm_result, filter_result, llm_reasoning, llm_raw
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (job_id) DO UPDATE SET
      enriched_at    = NOW(),
      model          = EXCLUDED.model,
      overall_score  = EXCLUDED.overall_score,
      llm_result     = EXCLUDED.llm_result,
      filter_result  = EXCLUDED.filter_result,
      llm_reasoning  = EXCLUDED.llm_reasoning,
      llm_raw        = EXCLUDED.llm_raw`,
    [
      jobId,
      enrichment.model,
      enrichment.overall_score,
      JSON.stringify(enrichment.llm_result),
      JSON.stringify(enrichment.filter_result),
      enrichment.llm_reasoning,
      JSON.stringify(enrichment),
    ]
  );
}

export async function logScrapeRun(run) {
  await pool.query(
    `INSERT INTO scrape_runs (apify_run_id, search_query, input, items_fetched, items_new, status, error, started_at, finished_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      run.apify_run_id ?? null,
      run.search_query,
      JSON.stringify(run.input),
      run.items_fetched,
      run.items_new,
      run.status,
      run.error ?? null,
      run.started_at,
      run.finished_at,
    ]
  );
}

export async function getTopJobs(limit = 50, filters = {}) {
  const {
    minScore = 6,
    maxProposals = 15,
    hourlyMin = 15,
    hourlyMax = 80,
    notifiedOnly = false,
  } = filters;

  const { rows } = await pool.query(
    `SELECT j.id, j.title, j.description, j.url, j.type, j.hourly_min, j.hourly_max, j.fixed_budget,
            j.client_country, j.client_score, j.client_total_spend, j.client_total_jobs,
            j.client_hire_rate, j.client_payment_verified, j.level, j.category, j.skills,
            j.total_applicants, j.ts_publish, j.scraped_at,
            e.overall_score, e.llm_result, e.filter_result, e.llm_reasoning
     FROM jobs j
     JOIN job_enrichments e ON j.id = e.job_id
     LEFT JOIN notifications n ON j.id = n.job_id
     WHERE e.overall_score >= $1
       AND (j.total_applicants IS NULL OR j.total_applicants <= $2)
       AND (
         (j.type = 'HOURLY' AND (j.hourly_min IS NULL OR j.hourly_min <= $4) AND (j.hourly_max IS NULL OR j.hourly_max >= $3))
         OR j.type = 'FIXED'
         OR j.type IS NULL
       )
       AND n.job_id IS NULL
       AND j.ts_publish >= NOW() - INTERVAL '3 hours'
     ORDER BY e.overall_score DESC, j.ts_publish DESC
     LIMIT $5`,
    [minScore, maxProposals, hourlyMin, hourlyMax, limit]
  );
  return rows;
}

export async function getRecentJobs(hours = 3, limit = 10) {
  const { rows } = await pool.query(
    `SELECT j.id, j.title, j.url, j.type, j.hourly_min, j.hourly_max, j.fixed_budget,
            j.client_country, j.client_score, j.client_total_spend, j.client_total_jobs,
            j.client_hire_rate, j.client_payment_verified, j.level, j.category, j.skills,
            j.total_applicants, j.ts_publish, j.scraped_at,
            e.overall_score, e.llm_reasoning, e.llm_result, e.filter_result,
            j.description
     FROM jobs j
     LEFT JOIN job_enrichments e ON j.id = e.job_id
     LEFT JOIN job_feedback f ON j.id = f.job_id
     WHERE j.scraped_at >= NOW() - ($1 || ' hours')::INTERVAL
       AND f.job_id IS NULL
     ORDER BY e.overall_score DESC NULLS LAST, j.scraped_at DESC
     LIMIT $2`,
    [hours, limit]
  );
  return rows;
}

export async function getLastScrapeTime() {
  const { rows } = await pool.query(
    `SELECT finished_at FROM scrape_runs WHERE status = 'succeeded' ORDER BY finished_at DESC LIMIT 1`
  );
  return rows[0]?.finished_at ?? null;
}

export async function markNotified(jobIds, channel = 'telegram') {
  if (!jobIds.length) return;
  const values = jobIds.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
  const params = jobIds.flatMap(id => [id, channel]);
  await pool.query(
    `INSERT INTO notifications (job_id, channel) VALUES ${values} ON CONFLICT (job_id, channel) DO NOTHING`,
    params
  );
}

export async function saveFeedback(jobId, feedback, reason = null) {
  await pool.query(
    `INSERT INTO job_feedback (job_id, feedback, reason) VALUES ($1, $2, $3)`,
    [jobId, feedback, reason]
  );
}

export async function getDailyStats() {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM jobs) AS total_jobs,
      (SELECT COUNT(*) FROM jobs WHERE scraped_at >= NOW() - INTERVAL '24 hours') AS jobs_24h,
      (SELECT COUNT(*) FROM job_enrichments WHERE enriched_at >= NOW() - INTERVAL '24 hours') AS enriched_24h,
      (SELECT COUNT(*) FROM notifications WHERE sent_at >= NOW() - INTERVAL '24 hours') AS notified_24h,
      (SELECT COUNT(*) FROM job_feedback WHERE created_at >= NOW() - INTERVAL '24 hours') AS feedback_24h,
      (SELECT COUNT(*) FROM job_feedback WHERE feedback IN ('good','applied') AND created_at >= NOW() - INTERVAL '24 hours') AS good_24h,
      (SELECT COUNT(*) FROM job_feedback WHERE feedback = 'bad' AND created_at >= NOW() - INTERVAL '24 hours') AS bad_24h,
      (SELECT COUNT(*) FROM job_feedback WHERE feedback = 'applied' AND created_at >= NOW() - INTERVAL '24 hours') AS applied_24h,
      (SELECT MAX(finished_at) FROM scrape_runs WHERE status = 'succeeded') AS last_run,
      (SELECT COUNT(*) FROM scrape_runs WHERE status = 'failed' AND finished_at >= NOW() - INTERVAL '24 hours') AS failed_runs_24h
  `);
  return rows[0];
}

export async function getJobById(id) {
  const { rows } = await pool.query(
    `SELECT j.*, e.overall_score, e.llm_reasoning, e.llm_result, e.filter_result
     FROM jobs j
     LEFT JOIN job_enrichments e ON j.id = e.job_id
     WHERE j.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function saveSkoolFeedback(postId, feedback, reason = null) {
  await pool.query(
    `UPDATE skool_signals SET feedback = $1, feedback_reason = $2, feedback_at = NOW() WHERE post_id = $3`,
    [feedback, reason, postId]
  );
}

export async function getPendingSkoolSignals({ community = null, confidenceOnly = false } = {}) {
  const conditions = [
    `is_signal = TRUE`, `notified = TRUE`, `feedback IS NULL`,
    `NOT EXISTS (SELECT 1 FROM skool_blacklist b WHERE b.user_id = (s.contact->>'user_id'))`,
  ];
  const params = [];

  if (community) {
    params.push(community);
    conditions.push(`community = $${params.length}`);
  }
  if (confidenceOnly) {
    conditions.push(`confidence = 'high'`);
  } else {
    conditions.push(`confidence IN ('high', 'medium')`);
  }

  const where = conditions.join(' AND ');
  const { rows } = await pool.query(
    `SELECT s.post_id, s.post_url, s.post_title, s.category, s.community, s.confidence, s.intent,
            s.signal_type, s.signal_text, s.contact, s.reason
     FROM skool_signals s
     WHERE ${where}
     ORDER BY CASE s.confidence WHEN 'high' THEN 0 ELSE 1 END, s.created_at DESC`,
    params
  );
  return rows;
}

export async function addToBlacklist(userId, name, reason = null) {
  await pool.query(
    `INSERT INTO skool_blacklist (user_id, name, reason) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING`,
    [userId, name, reason]
  );
}

export async function saveOutreachAction(postId, action) {
  await pool.query(
    `INSERT INTO skool_outreach (post_id, action) VALUES ($1, $2)`,
    [postId, action]
  );
}

export async function getSkoolSignalContact(postId) {
  const { rows } = await pool.query(
    `SELECT contact FROM skool_signals WHERE post_id = $1`,
    [postId]
  );
  if (!rows[0]) return {};
  try { return typeof rows[0].contact === 'string' ? JSON.parse(rows[0].contact) : (rows[0].contact || {}); } catch { return {}; }
}
