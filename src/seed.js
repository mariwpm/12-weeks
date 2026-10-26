'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { openDatabase } = require('./db');
const { hashPassword } = require('./auth');
const time = require('./time');

const USERS = [
  { id: 'user-ivan',  name: 'Иван Петров',           login: 'ivan',  role: 'user' },
  { id: 'user-maria', name: 'Мария Соколова',        login: 'maria', role: 'user' },
  { id: 'user-admin', name: 'Администратор сервиса', login: 'admin', role: 'admin' }
];

const RESOURCES = [
  { id: 'res-pc-01', name: 'ПК-01', description: 'Рабочее место с IDE, Docker и доступом к учебному Git.', location: 'Ауд. 214' },
  { id: 'res-pc-02', name: 'ПК-02', description: 'Рабочее место для веб-разработки, два монитора.',       location: 'Ауд. 214' },
  { id: 'res-pc-03', name: 'ПК-03', description: 'Стенд с предустановленным Node.js и инструментами API.', location: 'Ауд. 215' },
  { id: 'res-pc-04', name: 'ПК-04', description: 'Рабочее место с пакетами для баз данных.',              location: 'Ауд. 215' },
  { id: 'res-pc-05', name: 'ПК-05', description: 'Место у окна, подходит для индивидуальных занятий.',    location: 'Ауд. 301' }
];

function nextHalfHour(from) {
  return new Date(Math.ceil(from.getTime() / (30 * 60 * 1000)) * (30 * 60 * 1000));
}

function mskHourOnDate(base, hour) {
  const p = time.mskParts(base);
  return time.mskDateTimeToUtc(
    `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`,
    `${String(hour).padStart(2, '0')}:00`
  );
}

async function runSeed() {
  const databaseUrl = process.env.DATABASE_URL || 'postgres://bbc:bbc_dev_password@localhost:5432/bbc';
  const store = openDatabase(databaseUrl);
  await store.migrate();

  const userPassword = process.env.DEMO_USER_PASSWORD || 'User12345';
  const adminPassword = process.env.DEMO_ADMIN_PASSWORD || 'Admin12345';

  const client = await store.pool.connect();
  try {
    await client.query('BEGIN');

    for (const u of USERS) {
      const pwd = u.role === 'admin' ? adminPassword : userPassword;
      await client.query(
        `INSERT INTO users(id, name, login, password_hash, role) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, login=EXCLUDED.login,
           role=EXCLUDED.role, password_hash=EXCLUDED.password_hash`,
        [u.id, u.name, u.login, hashPassword(pwd), u.role]
      );
    }

    for (const r of RESOURCES) {
      await client.query(
        `INSERT INTO resources(id, name, description, location, is_active) VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description,
           location=EXCLUDED.location`,
        [r.id, r.name, r.description, r.location]
      );
    }

    await client.query('DELETE FROM booking_slots');
    await client.query('DELETE FROM idempotency_keys');
    await client.query('DELETE FROM bookings');

    const now = time.nowUtc();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    let futureStart = mskHourOnDate(tomorrow, 10);
    if (futureStart.getTime() < now.getTime() + 60 * 60 * 1000) {
      futureStart = nextHalfHour(new Date(now.getTime() + 2 * 60 * 60 * 1000));
    }
    const futureEnd = new Date(futureStart.getTime() + 60 * 60 * 1000);

    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const completedStart = mskHourOnDate(yesterday, 9);
    const completedEnd = new Date(completedStart.getTime() + 60 * 60 * 1000);

    const cancelledStart = new Date(futureStart.getTime() + 3 * 60 * 60 * 1000);
    const cancelledEnd = new Date(cancelledStart.getTime() + 60 * 60 * 1000);

    async function addBooking(spec) {
      await client.query(
        `INSERT INTO bookings(id, resource_id, owner_id, starts_at, ends_at, purpose, status,
                              created_at, cancelled_at, cancelled_by, cancel_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          spec.id, spec.resourceId, spec.ownerId, spec.startsAt, spec.endsAt,
          spec.purpose, spec.status, spec.createdAt,
          spec.cancelledAt || null, spec.cancelledBy || null, spec.cancelReason || null
        ]
      );
      if (spec.status === 'ACTIVE') {
        for (const slot of time.slotStarts(spec.startsAt, spec.endsAt)) {
          await client.query(
            'INSERT INTO booking_slots(resource_id, slot_start, booking_id) VALUES ($1, $2, $3)',
            [spec.resourceId, slot, spec.id]
          );
        }
      }
    }

    await addBooking({
      id: 'book-future-active', resourceId: 'res-pc-01', ownerId: 'user-ivan',
      startsAt: futureStart, endsAt: futureEnd,
      purpose: 'Лабораторная по серверным функциям', status: 'ACTIVE', createdAt: now
    });
    await addBooking({
      id: 'book-cancelled', resourceId: 'res-pc-02', ownerId: 'user-maria',
      startsAt: cancelledStart, endsAt: cancelledEnd,
      purpose: 'Подготовка к защите проекта', status: 'CANCELLED', createdAt: now,
      cancelledAt: now, cancelledBy: 'user-maria', cancelReason: 'Планы изменились'
    });
    await addBooking({
      id: 'book-completed', resourceId: 'res-pc-03', ownerId: 'user-ivan',
      startsAt: completedStart, endsAt: completedEnd,
      purpose: 'Завершённое учебное занятие', status: 'ACTIVE',
      createdAt: new Date(completedStart.getTime() - 48 * 60 * 60 * 1000)
    });

    await client.query('COMMIT');
    console.log('Учебные данные записаны.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await store.close();
  }
}

if (require.main === module) runSeed().catch((err) => { console.error(err); process.exit(1); });
module.exports = { runSeed };