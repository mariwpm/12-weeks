'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const { AppError, badRequest, unauthorized, notFound } = require('./errors');
const { signToken, verifyPassword, requireAuth, requireAdmin, publicUser } = require('./auth');
const { createBookingService, bookingSelect } = require('./bookings');
const time = require('./time');

function createApp(deps) {
  const { pool, transaction, logger, jwtSecret, jwtExpiresIn, databaseName } = deps;
  const bookings = createBookingService({ pool, transaction });
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  app.use((req, res, next) => {
    req.traceId = req.headers['x-request-id'] || crypto.randomUUID();
    res.setHeader('X-Request-Id', req.traceId);
    res.setHeader('X-Timezone', 'Europe/Moscow');
    next();
  });
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const auth = requireAuth(jwtSecret);

  app.get('/health/live', (_req, res) => res.json({ status: 'live' }));

  app.get('/health/ready', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({
        code: 'NOT_READY', message: 'Сервис временно не готов.',
        traceId: crypto.randomUUID()
      });
    }
  });

  app.post('/api/auth/login', async (req, res, next) => {
    try {
      const login = String(req.body.login || '').trim();
      const password = String(req.body.password || '');
      if (!login || !password) throw badRequest('Укажите логин и пароль.');
      const { rows } = await pool.query('SELECT * FROM users WHERE login = $1', [login]);
      const user = rows[0];
      if (!user || !verifyPassword(password, user.password_hash)) {
        logger.warn({ msg: 'login_failed', login, traceId: req.traceId });
        throw unauthorized('Неверный логин или пароль.');
      }
      const token = signToken(user, jwtSecret, jwtExpiresIn);
      logger.info({ msg: 'login_ok', userId: user.id, traceId: req.traceId });
      res.json({ token, user: publicUser(user), timezone: 'МСК (UTC+3)' });
    } catch (err) { next(err); }
  });

  app.get('/api/auth/me', auth, (req, res) => {
    res.json({ user: req.user, timezone: 'МСК (UTC+3)' });
  });

  app.get('/api/resources', auth, async (req, res, next) => {
    try {
      const q = String(req.query.q || '').trim().toLowerCase();
      const location = String(req.query.location || '').trim().toLowerCase();
      let { rows } = await pool.query('SELECT * FROM resources WHERE is_active = TRUE ORDER BY name');
      if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q));
      if (location) rows = rows.filter((r) => r.location.toLowerCase().includes(location));
      res.json({ items: rows.map((r) => ({
        id: r.id, name: r.name, description: r.description,
        location: r.location, isActive: r.is_active
      })) });
    } catch (err) { next(err); }
  });

  app.get('/api/resources/:id', auth, async (req, res, next) => {
    try {
      const { rows } = await pool.query('SELECT * FROM resources WHERE id = $1', [req.params.id]);
      const r = rows[0];
      if (!r) throw notFound('Ресурс не найден.');
      res.json({ id: r.id, name: r.name, description: r.description, location: r.location, isActive: r.is_active });
    } catch (err) { next(err); }
  });

  app.get('/api/resources/:id/availability', auth, async (req, res, next) => {
    try {
      const { rows: rrows } = await pool.query('SELECT * FROM resources WHERE id = $1', [req.params.id]);
      if (!rrows[0]) throw notFound('Ресурс не найден.');
      const date = String(req.query.date || '');
      const range = time.mskDayRangeUtc(date);
      if (!range) throw badRequest('Укажите дату в формате YYYY-MM-DD.');
      const { rows } = await pool.query(
        `SELECT starts_at, ends_at FROM bookings
         WHERE resource_id = $1 AND status = 'ACTIVE'
           AND starts_at < $2 AND ends_at > $3
         ORDER BY starts_at`,
        [req.params.id, range.end.toISOString(), range.start.toISOString()]
      );
      res.json({
        date, timezone: 'МСК',
        occupied: rows.map((r) => ({
          startsAt: new Date(r.starts_at).toISOString(),
          endsAt: new Date(r.ends_at).toISOString(),
          startsAtMsk: time.formatMsk(new Date(r.starts_at)),
          endsAtMsk: time.formatMsk(new Date(r.ends_at))
        }))
      });
    } catch (err) { next(err); }
  });

  app.post('/api/bookings', auth, async (req, res, next) => {
    try {
      const result = await bookings.createBooking({
        user: req.user, body: req.body || {},
        idempotencyKey: req.headers['idempotency-key'], requestId: req.traceId
      });
      res.status(result.replayed ? 200 : 201)
        .json({ booking: sanitizeBooking(result.booking, req.user), replayed: result.replayed });
    } catch (err) { next(err); }
  });

  app.get('/api/bookings/my', auth, async (req, res, next) => {
    try {
      const status = String(req.query.status || '').toUpperCase();
      const nowIso = time.toIso(time.nowUtc());
      const { rows } = await pool.query(
        `${bookingSelect()} WHERE b.owner_id = $1 ORDER BY b.starts_at DESC`, [req.user.id]
      );
      const mapped = rows.map((row) => bookings.mapBooking(row, nowIso));
      const filtered = mapped.filter((item) => {
        if (!status) return true;
        if (status === 'COMPLETED') return item.derivedStatus === 'COMPLETED';
        return item.status === status;
      });
      res.json({ items: filtered.map((b) => sanitizeBooking(b, req.user)) });
    } catch (err) { next(err); }
  });

  app.get('/api/bookings/:id', auth, async (req, res, next) => {
    try {
      const row = await bookings.getBooking(pool, req.params.id);
      if (!row) throw notFound('Запись не найдена.');
      if (row.owner_id !== req.user.id && req.user.role !== 'admin') throw notFound('Запись не найдена.');
      res.json({ booking: sanitizeBooking(bookings.mapBooking(row, time.toIso(time.nowUtc())), req.user) });
    } catch (err) { next(err); }
  });

  app.post('/api/bookings/:id/cancel', auth, async (req, res, next) => {
    try {
      const booking = await bookings.cancelBooking({
        user: req.user, bookingId: req.params.id,
        reason: req.body && req.body.reason, requestId: req.traceId
      });
      res.json({ booking: sanitizeBooking(booking, req.user) });
    } catch (err) { next(err); }
  });

  app.get('/api/admin/bookings', auth, requireAdmin, async (req, res, next) => {
    try {
      const nowIso = time.toIso(time.nowUtc());
      const resourceId = String(req.query.resourceId || '');
      const status = String(req.query.status || '').toUpperCase();
      const date = String(req.query.date || '');
      let sql = `${bookingSelect()} WHERE 1=1`;
      const params = [];
      if (resourceId) { sql += ` AND b.resource_id = $${params.length + 1}`; params.push(resourceId); }
      if (date) {
        const range = time.mskDayRangeUtc(date);
        if (!range) throw badRequest('Укажите дату в формате YYYY-MM-DD.');
        sql += ` AND b.starts_at < $${params.length + 1} AND b.ends_at > $${params.length + 2}`;
        params.push(range.end.toISOString(), range.start.toISOString());
      }
      sql += ' ORDER BY b.starts_at DESC';
      let { rows } = await pool.query(sql, params);
      rows = rows.map((row) => bookings.mapBooking(row, nowIso));
      if (status === 'COMPLETED') rows = rows.filter((b) => b.derivedStatus === 'COMPLETED');
      else if (status) rows = rows.filter((b) => b.status === status);
      res.json({ items: rows });
    } catch (err) { next(err); }
  });

  app.post('/api/admin/resources', auth, requireAdmin, async (req, res, next) => {
    try {
      const name = String(req.body.name || '').trim();
      const description = String(req.body.description || '').trim();
      const location = String(req.body.location || '').trim();
      if (!name || !description || !location) throw badRequest('Заполните название, описание и местоположение.');
      const id = crypto.randomUUID();
      await transaction(async (client) => {
        await client.query(
          'INSERT INTO resources(id, name, description, location, is_active) VALUES ($1, $2, $3, $4, TRUE)',
          [id, name, description, location]
        );
        await bookings.writeAudit(client, {
          actorId: req.user.id, action: 'resource.create', objectType: 'resource',
          objectId: id, result: 'success', requestId: req.traceId
        });
      });
      const { rows } = await pool.query('SELECT * FROM resources WHERE id = $1', [id]);
      const r = rows[0];
      res.status(201).json({ id: r.id, name: r.name, description: r.description, location: r.location, isActive: r.is_active });
    } catch (err) { next(err); }
  });

  app.patch('/api/admin/resources/:id', auth, requireAdmin, async (req, res, next) => {
    try {
      const result = await transaction(async (client) => {
        const { rows } = await client.query('SELECT * FROM resources WHERE id = $1 FOR UPDATE', [req.params.id]);
        const resource = rows[0];
        if (!resource) throw notFound('Ресурс не найден.');
        const name = req.body.name != null ? String(req.body.name).trim() : resource.name;
        const description = req.body.description != null ? String(req.body.description).trim() : resource.description;
        const location = req.body.location != null ? String(req.body.location).trim() : resource.location;
        const isActive = req.body.isActive != null ? Boolean(req.body.isActive) : resource.is_active;
        await client.query(
          'UPDATE resources SET name = $1, description = $2, location = $3, is_active = $4 WHERE id = $5',
          [name, description, location, isActive, resource.id]
        );
        await bookings.writeAudit(client, {
          actorId: req.user.id,
          action: isActive !== resource.is_active ? 'resource.toggle' : 'resource.update',
          objectType: 'resource', objectId: resource.id, result: 'success',
          requestId: req.traceId, details: { isActive }
        });
        const { rows: updated } = await client.query('SELECT * FROM resources WHERE id = $1', [resource.id]);
        return updated[0];
      });
      res.json({ id: result.id, name: result.name, description: result.description, location: result.location, isActive: result.is_active });
    } catch (err) { next(err); }
  });

  app.get('/api/admin/resources', auth, requireAdmin, async (_req, res, next) => {
    try {
      const { rows } = await pool.query('SELECT * FROM resources ORDER BY name');
      res.json({ items: rows.map((r) => ({
        id: r.id, name: r.name, description: r.description, location: r.location, isActive: r.is_active
      })) });
    } catch (err) { next(err); }
  });

  app.get('/api/admin/audit', auth, requireAdmin, async (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 300);
      const { rows } = await pool.query('SELECT * FROM audit_events ORDER BY at DESC LIMIT $1', [limit]);
      res.json({ items: rows.map((row) => ({
        id: row.id, at: row.at, actorId: row.actor_id, action: row.action,
        objectType: row.object_type, objectId: row.object_id, result: row.result,
        requestId: row.request_id, details: row.details
      })) });
    } catch (err) { next(err); }
  });

  app.get('/api/meta', (_req, res) => {
    res.json({
      name: 'Бронь без конфликтов', timezone: 'Europe/Moscow',
      workingHours: '08:00–22:00 МСК', database: databaseName || 'postgres'
    });
  });

  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') err = badRequest('Тело запроса должно быть корректным JSON.');
    const status = err instanceof AppError ? err.status : 500;
    const code = err instanceof AppError ? err.code : 'INTERNAL_ERROR';
    const message = err instanceof AppError ? err.message : 'Непредвиденная ошибка. Повторите позже.';
    logger[status >= 500 ? 'error' : 'warn']({
      msg: 'request_error', traceId: req.traceId, status, code,
      path: req.path, method: req.method, userId: req.user && req.user.id
    });
    res.status(status).json({ code, message, traceId: req.traceId });
  });

  return app;
}

function sanitizeBooking(booking, user) {
  if (user.role === 'admin' || booking.ownerId === user.id) return booking;
  const copy = { ...booking };
  delete copy.ownerName; delete copy.ownerLogin; delete copy.purpose;
  return copy;
}

module.exports = { createApp };