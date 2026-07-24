import path from 'node:path';
import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';

// Workspace npm scripts run from apps/api, while Docker injects variables directly.
// Load both the local workspace file (if present) and the repository-root .env.
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../../.env'), override: false });
export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined });
export async function tx<T>(fn: (client: PoolClient) => Promise<T>) { const c = await pool.connect(); try { await c.query('BEGIN'); const value = await fn(c); await c.query('COMMIT'); return value; } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } }
