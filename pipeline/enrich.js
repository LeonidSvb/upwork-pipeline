import 'dotenv/config';
import { getJobsToEnrich, saveEnrichment } from '../db/client.js';

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

// Модель по умолчанию - дешевая и быстрая
const MODEL = process.env.ENRICH_MODEL || 'google/gemini-2.5-flash-lite';

const SYSTEM_PROMPT = `You are an expert Upwork job evaluator for a senior developer/automation specialist.
Analyze job postings and return structured JSON assessments. Be concise and direct.`;

function buildPrompt(job) {
  const budget = job.type === 'HOURLY'
    ? `$${job.hourly_min || '?'}-${job.hourly_max || '?'}/hr`
    : `$${job.fixed_budget || '?'} fixed`;

  return `Evaluate this Upwork job for a specialist in: lead generation systems, sales automation, CRM workflows (Airtable/HubSpot), web scraping (Python/Apify), n8n/Make/Zapier automations, outreach infrastructure (Instantly/Smartlead), Python scripts, API integrations.

JOB:
Title: ${job.title}
Type: ${job.type} | Budget: ${budget}
Level: ${job.level || 'N/A'}
Client: ${job.client_country || 'Unknown'} | Score: ${job.client_score || 'N/A'} | Spent: $${Math.round(job.client_total_spend || 0).toLocaleString()}
Category: ${job.category || 'N/A'}
Skills: ${Array.isArray(job.skills) ? job.skills.map(s => s.name || s).join(', ') : 'N/A'}

Description (first 600 chars):
${(job.description || '').substring(0, 600)}

Return ONLY valid JSON (no markdown, no explanation):
{
  "is_relevant": boolean,
  "is_good_client": boolean,
  "is_budget_ok": boolean,
  "has_clear_requirements": boolean,
  "is_long_term": boolean,
  "relevance_score": 0-10,
  "budget_score": 0-10,
  "client_quality_score": 0-10,
  "overall_score": 0-10,
  "primary_category": "lead_gen|outreach|crm|airtable|scraping|automation|python|other",
  "tags": ["tag1"],
  "rejection_reasons": [],
  "llm_reasoning": "2 sentence summary"
}`;
}

async function callOpenRouter(prompt) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/upwork-pipeline',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 400,
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error(`OpenRouter error: ${data.error.message}`);
  return data.choices[0].message.content.trim();
}

export async function enrichJob(job) {
  const text = await callOpenRouter(buildPrompt(job));

  // Убираем markdown если модель добавила
  const cleaned = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
  const parsed = JSON.parse(cleaned);
  return { ...parsed, model: MODEL };
}

export async function enrichPending(batchSize = 20) {
  const jobs = await getJobsToEnrich(batchSize);
  console.log(`[enrich] Processing ${jobs.length} jobs with ${MODEL}`);

  let done = 0;
  for (const job of jobs) {
    try {
      const enrichment = await enrichJob(job);
      await saveEnrichment(job.id, enrichment);
      done++;
      console.log(`[enrich] ${done}/${jobs.length} | score=${enrichment.overall_score} relevant=${enrichment.is_relevant} | ${job.title?.substring(0, 50)}`);
    } catch (err) {
      console.error(`[enrich] Failed ${job.id}:`, err.message);
    }
  }

  console.log(`[enrich] Done: ${done}/${jobs.length}`);
  return done;
}

// Direct run: node pipeline/enrich.js
if (process.argv[1]?.endsWith('enrich.js')) {
  enrichPending(50).then(() => process.exit(0));
}
