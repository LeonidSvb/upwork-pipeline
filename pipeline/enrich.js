import 'dotenv/config';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getJobsToEnrich, saveEnrichment } from '../db/client.js';
import { CONFIG } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

function loadPrompt(name) {
  return readFileSync(resolve(__dirname, '../prompts', `${name}.txt`), 'utf8').trim();
}

const FILTER_PROMPT = loadPrompt(CONFIG.filterPrompt);
const SCORE_PROMPT  = loadPrompt(CONFIG.scorePrompt);

function buildJobBlock(job) {
  const budget = job.type === 'HOURLY'
    ? `$${job.hourly_min || '?'}-${job.hourly_max || '?'}/hr`
    : `$${job.fixed_budget || '?'} fixed`;
  return `Title: ${job.title}
Type: ${job.type} | Budget: ${budget} | Level: ${job.level || 'N/A'}
Client: ${job.client_country || 'Unknown'} | Score: ${job.client_score || 'none'} | Spent: $${Math.round(job.client_total_spend || 0).toLocaleString()} | Jobs: ${job.client_total_jobs || 0}
Category: ${job.category || 'N/A'}
Skills: ${Array.isArray(job.skills) ? job.skills.map(s => s.name || s).join(', ') : 'N/A'}
Proposals: ${job.total_applicants ?? 'unknown'}

Description:
${(job.description || '').substring(0, 600)}`;
}

async function callLLM(model, promptTemplate, job) {
  const prompt = promptTemplate.replace('{{job_block}}', buildJobBlock(job));
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/upwork-pipeline',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 300,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`OpenRouter: ${data.error.message}`);
  const text = data.choices[0].message.content.trim();
  return JSON.parse(text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim());
}

export async function enrichJob(job) {
  // Stage 1 — filter
  const filter = await callLLM(CONFIG.filterModel, FILTER_PROMPT, job);
  if (!filter.relevant) {
    return {
      overall_score: 0,
      filter_result: filter,
      llm_result: null,
      llm_reasoning: filter.reason,
      model: CONFIG.filterModel,
      filtered_out: true,
    };
  }

  // Stage 2 — score (only relevant jobs)
  const score = await callLLM(CONFIG.scoreModel, SCORE_PROMPT, job);
  return {
    overall_score: score.overall_score,
    filter_result: filter,
    llm_result: score,
    llm_reasoning: score.reasoning,
    model: CONFIG.scoreModel,
    filtered_out: false,
  };
}

export async function enrichPending(batchSize = 20) {
  const jobs = await getJobsToEnrich(batchSize);
  console.log(`[enrich] ${jobs.length} jobs to process`);

  let done = 0, filtered = 0;
  for (const job of jobs) {
    try {
      const result = await enrichJob(job);
      await saveEnrichment(job.id, result);
      done++;
      if (result.filtered_out) {
        filtered++;
        console.log(`[enrich] FILTERED (${result.filter_result?.niche}) | ${job.title?.substring(0, 50)}`);
      } else {
        console.log(`[enrich] score=${result.overall_score} niche=${result.filter_result?.niche} | ${job.title?.substring(0, 50)}`);
      }
    } catch (err) {
      console.error(`[enrich] Failed ${job.id}:`, err.message);
    }
  }

  console.log(`[enrich] Done: ${done}/${jobs.length}, filtered out: ${filtered}`);
  return done;
}

if (process.argv[1]?.endsWith('enrich.js')) {
  enrichPending(50).then(() => process.exit(0));
}
