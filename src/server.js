'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { openDatabase } = require('./db');
const { createLogger } = require('./logger');
const { createApp } = require('./app');
const { runSeed } = require('./seed');

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://bbc:bbc_dev_password@localhost:5432/bbc';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '2h';
const LOG_DIR = process.env.LOG_DIR || 'logs';

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('JWT_SECRET обязателен в production.'); process.exit(1);
}

async function main() {
  const logger = createLogger(LOG_DIR);
  const store = openDatabase(DATABASE_URL);
  await store.migrate();

  const { rows } = await store.pool.query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n === 0) {
    console.log('Пустая БД — запускаю seed…');
    await runSeed();
  }

  const app = createApp({
    pool: store.pool, transaction: store.transaction, logger,
    jwtSecret: JWT_SECRET, jwtExpiresIn: JWT_EXPIRES_IN, databaseName: 'postgres'
  });

  const server = app.listen(PORT, () => {
    logger.info({ msg: 'server_started', port: PORT, db: 'postgres' });
    console.log(`Сервис: http://localhost:${PORT}`);
  });

  const shutdown = async () => {
    server.close(async () => { await store.close(); process.exit(0); });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => { console.error(err); process.exit(1); });