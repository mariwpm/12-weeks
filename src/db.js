'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const INIT_SQL = fs.readFileSync(path.join(__dirname, 'migrations', '001_init.sql'), 'utf8');

function openDatabase(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });

  async function migrate() {
    const client = await pool.connect();
    try {
      await client.query(INIT_SQL);
      const { rowCount } = await client.query(
        'SELECT 1 FROM schema_migrations WHERE name = $1', ['001_init']
      );
      if (rowCount === 0) {
        await client.query(
          'INSERT INTO schema_migrations(id, name, applied_at) VALUES ($1, $2, now())',
          [1, '001_init']
        );
      }
    } finally { client.release(); }
  }

  async function transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally { client.release(); }
  }

  async function close() { await pool.end(); }

  return { pool, migrate, transaction, close };
}

module.exports = { openDatabase, INIT_SQL };