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
     ORDER BY j.ts_publish DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function saveEnrichment(jobId, enrichment) {
  const { model, ...rest } = enrichment;
  await pool.query(
    `INSERT INTO job_enrichments (
      job_id, model,
      relevance_score, budget_score, client_quality_score, overall_score,
      is_relevant, is_good_client, is_budget_ok, has_clear_requirements, is_long_term,
      primary_category, tags, rejection_reasons, llm_reasoning, llm_raw
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    ON CONFLICT (job_id) DO UPDATE SET
      enriched_at = NOW(),
      model = EXCLUDED.model,
      overall_score = EXCLUDED.overall_score,
      is_relevant = EXCLUDED.is_relevant,
      llm_raw = EXCLUDED.llm_raw`,
    [
      jobId, model,
      enrichment.relevance_score, enrichment.budget_score,
      enrichment.client_quality_score, enrichment.overall_score,
      enrichment.is_relevant, enrichment.is_good_client,
      enrichment.is_budget_ok, enrichment.has_clear_requirements,
      enrichment.is_long_term,
      enrichment.primary_category,
      enrichment.tags,
      enrichment.rejection_reasons,
      enrichment.llm_reasoning,
      JSON.stringify(rest),
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
    hourlyMax = 45,
    fixedMax = 500,
    notifiedOnly = false,
  } = filters;

  const { rows } = await pool.query(
    `SELECT j.id, j.title, j.description, j.url, j.type, j.hourly_min, j.hourly_max, j.fixed_budget,
            j.client_country, j.client_score, j.client_total_spend, j.client_total_jobs,
            j.client_hire_rate, j.client_payment_verified, j.level, j.category, j.skills,
            j.total_applicants, j.ts_publish, j.scraped_at,
            e.overall_score, e.is_relevant, e.primary_category, e.tags, e.llm_reasoning, e.llm_raw
     FROM jobs j
     JOIN job_enrichments e ON j.id = e.job_id
     LEFT JOIN notifications n ON j.id = n.job_id
     WHERE e.overall_score >= $1
       AND (j.total_applicants IS NULL OR j.total_applicants <= $2)
       AND (
         (j.type = 'HOURLY' AND (j.hourly_min IS NULL OR j.hourly_min <= $4) AND (j.hourly_max IS NULL OR j.hourly_max >= $3))
         OR
         (j.type = 'FIXED' AND (j.fixed_budget IS NULL OR j.fixed_budget <= $5))
         OR j.type IS NULL
       )
       AND n.job_id IS NULL
     ORDER BY e.overall_score DESC, j.ts_publish DESC
     LIMIT $6`,
    [minScore, maxProposals, hourlyMin, hourlyMax, fixedMax, limit]
  );
  return rows;
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

export async function getJobById(id) {
  const { rows } = await pool.query(
    `SELECT j.*, e.overall_score, e.llm_reasoning, e.tags, e.primary_category
     FROM jobs j
     LEFT JOIN job_enrichments e ON j.id = e.job_id
     WHERE j.id = $1`,
    [id]
  );
  return rows[0] || null;
}
