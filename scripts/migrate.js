'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { openDatabase } = require('../src/db');

(async () => {
  const url = process.env.DATABASE_URL || 'postgres://bbc:bbc_dev_password@localhost:5432/bbc';
  const store = openDatabase(url);
  try { await store.migrate(); console.log('Миграция применена.'); }
  finally { await store.close(); }
})().catch((err) => { console.error(err); process.exit(1); });