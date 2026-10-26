'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL не задан.'); process.exit(1); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destDir = path.resolve(process.argv[2] || path.join('data', 'backups'));
fs.mkdirSync(destDir, { recursive: true });
const dest = path.join(destDir, `app-${stamp}.dump`);

const result = spawnSync('pg_dump', [url, '-Fc', '-f', dest], { encoding: 'utf8' });
if (result.status !== 0) { console.error(result.stderr || result.stdout); process.exit(1); }
console.log(`Резервная копия: ${dest}`);