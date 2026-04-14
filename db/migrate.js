import 'dotenv/config';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const schema = readFileSync(resolve(__dirname, 'schema.sql'), 'utf8');
  console.log('[migrate] Running schema...');
  await pool.query(schema);
  console.log('[migrate] Done');
  await pool.end();
}

migrate().catch(err => {
  console.error('[migrate] Error:', err.message);
  process.exit(1);
});
