import fs from 'node:fs'; import path from 'node:path'; import { pool } from './index';
async function main(){await pool.query(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));await pool.end()} main().catch(e=>{console.error(e);process.exit(1)});
