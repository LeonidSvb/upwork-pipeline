import 'dotenv/config';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getJobsToEnrich, saveEnrichment } from '../db/client.js';
import { CONFIG } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const MODEL = process.env.ENRICH_MODEL || 'google/gemini-2.5-flash-lite';

function loadPromptFile(name) {
  const path = resolve(__dirname, '../prompts', `${name}.txt`);
  return readFileSync(path, 'utf8').trim();
}

const SYSTEM_PROMPT = loadPromptFile('system');
const USER_TEMPLATE = loadPromptFile(CONFIG.enrichPrompt || 'default');

function buildJobBlock(job) {
  const budget = job.type === 'HOURLY'
    ? `$${job.hourly_min || '?'}-${job.hourly_max || '?'}/hr`
    : `$${job.fixed_budget || '?'} fixed`;

  return `JOB:
Title: ${job.title}
Type: ${job.type} | Budget: ${budget}
Level: ${job.level || 'N/A'}
Client: ${job.client_country || 'Unknown'} | Score: ${job.client_score || 'none'} | Spent: $${Math.round(job.client_total_spend || 0).toLocaleString()} | Jobs posted: ${job.client_total_jobs || 0}
Category: ${job.category || 'N/A'}
Skills: ${Array.isArray(job.skills) ? job.skills.map(s => s.name || s).join(', ') : 'N/A'}

Description (first 600 chars):
${(job.description || '').substring(0, 600)}`;
}

function buildPrompt(job) {
  return USER_TEMPLATE.replace('{{job_block}}', buildJobBlock(job));
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
      max_tokens: 500,
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error(`OpenRouter error: ${data.error.message}`);
  return data.choices[0].message.content.trim();
}

export async function enrichJob(job) {
  const text = await callOpenRouter(buildPrompt(job));
  const cleaned = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
  const parsed = JSON.parse(cleaned);
  return { ...parsed, model: MODEL };
}

export async function enrichPending(batchSize = 20) {
  const jobs = await getJobsToEnrich(batchSize);
  console.log(`[enrich] Processing ${jobs.length} jobs with ${MODEL} (prompt: ${CONFIG.enrichPrompt || 'default'})`);

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
