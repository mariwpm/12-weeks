'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const roots = ['src', 'scripts', 'public'].map((r) => path.join(__dirname, '..', r));
const files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith('.js')) files.push(full);
  }
}
for (const root of roots) walk(root);

let failed = false;
for (const file of files) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) { failed = true; console.error(r.stderr || r.stdout); }
  else console.log('OK', path.relative(path.join(__dirname, '..'), file));
}
if (failed) process.exit(1);