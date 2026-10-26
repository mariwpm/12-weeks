'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SENSITIVE = /password|passwd|secret|authorization|jwt|token|database_url|connection/i;

function redact(v) {
  if (v == null) return v;
  if (typeof v === 'string') return SENSITIVE.test(v) && v.length > 20 ? '[redacted]' : v;
  if (Array.isArray(v)) return v.map(redact);
  if (typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = SENSITIVE.test(k) ? '[redacted]' : redact(val);
    return out;
  }
  return v;
}

function createLogger(logDir) {
  fs.mkdirSync(logDir, { recursive: true });
  const file = path.join(logDir, 'app.log');

  function write(level, payload) {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, ...redact(payload) });
    fs.appendFileSync(file, `${line}\n`, 'utf8');
    if (level === 'error') console.error(line);
    else console.log(line);
  }

  return { file, info: (p) => write('info', p), warn: (p) => write('warn', p), error: (p) => write('error', p) };
}

module.exports = { createLogger };