'use strict';

const crypto = require('node:crypto');
const { badRequest, conflict, notFound, uniqueViolation } = require('./errors');
const time = require('./time');

function fingerprint(payload) {
  return crypto.createHash('sha256').update(JSON.stringify({
    resourceId: payload.resourceId,
    startsAt: payload.startsAt,
    endsAt: payload.endsAt,
    purpose: String(payload.purpose || '').trim()
  })).digest('hex');
}

function mapBooking(row, nowIso) {
  const derived = row.status === 'ACTIVE' && new Date(row.ends_at).toISOString() <= nowIso
    ? 'COMPLETED' : row.status;
  return {
    id: row.id, resourceId: row.resource_id, resourceName: row.resource_name,
    resourceLocation: row.resource_location, ownerId: row.owner_id,
    ownerName: row.owner_name, ownerLogin: row.owner_login,
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
    startsAtMsk: time.formatMsk(new Date(row.starts_at)),
    endsAtMsk: time.formatMsk(new Date(row.ends_at)),
    purpose: row.purpose, status: row.status, derivedStatus: derived,
    createdAt: row.created_at, cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by, cancelReason: row.cancel_reason
  };
}

function bookingSelect() {
  return `
    SELECT b.*, r.name AS resource_name, r.location AS resource_location,
           u.name AS owner_name, u.login AS owner_login
    FROM bookings b
    JOIN resources r ON r.id = b.resource_id
    JOIN users u ON u.id = b.owner_id
  `;
}

async function writeAudit(client, event) {
  await client.query(
    `INSERT INTO audit_events(id, at, actor_id, action, object_type, object_id, result, request_id, details)
     VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8)`,
    [
      crypto.randomUUID(), event.actorId || null, event.action,
      event.objectType, event.objectId || null, event.result,
      event.requestId, event.details ? JSON.stringify(event.details) : null
    ]
  );
}

async function getBooking(dbOrClient, id) {
  const { rows } = await dbOrClient.query(`${bookingSelect()} WHERE b.id = $1`, [id]);
  return rows[0];
}

function createBookingService(ctx) {
  const { pool, transaction } = ctx;

  async function createBooking({ user, body, idempotencyKey, requestId }) {
    if (!idempotencyKey || String(idempotencyKey).length < 8) {
      throw badRequest('Заголовок Idempotency-Key обязателен.');
    }
    const resourceId = body.resourceId;
    const purpose = String(body.purpose || '').trim();
    if (!resourceId) throw badRequest('Укажите ресурс.');
    if (purpose.length < 5 || purpose.length > 300) throw badRequest('Цель бронирования — от 5 до 300 символов.');

    const start = time.parseIso(body.startsAt);
    const end = time.parseIso(body.endsAt);
    const windowError = time.validateBookingWindow(start, end, time.nowUtc());
    if (windowError) throw badRequest(windowError);

    const payload = { resourceId, startsAt: start.toISOString(), endsAt: end.toISOString(), purpose };
    const fp = fingerprint(payload);
    const slots = time.slotStarts(start, end);

    try {
      return await transaction(async (client) => {
        const { rows: keyRows } = await client.query(
          'SELECT * FROM idempotency_keys WHERE user_id = $1 AND key = $2',
          [user.id, idempotencyKey]
        );
        const existingKey = keyRows[0];
        if (existingKey) {
          if (existingKey.request_fingerprint !== fp) {
            await writeAudit(client, {
              actorId: user.id, action: 'booking.create', objectType: 'booking',
              objectId: existingKey.booking_id, result: 'conflict_key', requestId,
              details: { reason: 'fingerprint_mismatch' }
            });
            throw conflict('Этот ключ повторного запроса уже использован с другими данными.');
          }
          return { booking: mapBooking(await getBooking(client, existingKey.booking_id), time.toIso(time.nowUtc())), replayed: true };
        }

        const { rows: resRows } = await client.query(
          'SELECT * FROM resources WHERE id = $1 FOR UPDATE', [resourceId]
        );
        const resource = resRows[0];
        if (!resource) throw notFound('Ресурс не найден.');
        if (!resource.is_active) throw conflict('Ресурс отключён и недоступен для новых бронирований.', 'RESOURCE_DISABLED');

        const bookingId = crypto.randomUUID();
        await client.query(
          `INSERT INTO bookings(id, resource_id, owner_id, starts_at, ends_at, purpose, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', now())`,
          [bookingId, resourceId, user.id, payload.startsAt, payload.endsAt, purpose]
        );
        for (const slot of slots) {
          await client.query(
            'INSERT INTO booking_slots(resource_id, slot_start, booking_id) VALUES ($1, $2, $3)',
            [resourceId, slot, bookingId]
          );
        }
        await client.query(
          `INSERT INTO idempotency_keys(user_id, key, request_fingerprint, booking_id, created_at)
           VALUES ($1, $2, $3, $4, now())`,
          [user.id, idempotencyKey, fp, bookingId]
        );
        await writeAudit(client, {
          actorId: user.id, action: 'booking.create', objectType: 'booking',
          objectId: bookingId, result: 'success', requestId,
          details: { resourceId, startsAt: payload.startsAt, endsAt: payload.endsAt }
        });
        return { booking: mapBooking(await getBooking(client, bookingId), time.toIso(time.nowUtc())), replayed: false };
      });
    } catch (err) {
      if (err.status) throw err;
      if (uniqueViolation(err)) {
        const { rows } = await pool.query(
          'SELECT * FROM idempotency_keys WHERE user_id = $1 AND key = $2',
          [user.id, idempotencyKey]
        );
        if (rows[0]) {
          if (rows[0].request_fingerprint !== fp) {
            throw conflict('Этот ключ повторного запроса уже использован с другими данными.');
          }
          return { booking: mapBooking(await getBooking(pool, rows[0].booking_id), time.toIso(time.nowUtc())), replayed: true };
        }
        await transaction(async (client) => {
          await writeAudit(client, {
            actorId: user.id, action: 'booking.create', objectType: 'resource',
            objectId: resourceId, result: 'conflict_overlap', requestId
          });
        });
        throw conflict('Ресурс уже занят в выбранное время.', 'OVERLAP');
      }
      throw err;
    }
  }

  async function cancelBooking({ user, bookingId, reason, requestId }) {
    return transaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
      const row = rows[0];
      if (!row) throw notFound('Запись не найдена.');
      const isOwner = row.owner_id === user.id;
      const isAdmin = user.role === 'admin';
      if (!isOwner && !isAdmin) throw notFound('Запись не найдена.');
      if (row.status === 'CANCELLED') throw conflict('Запись уже отменена.', 'ALREADY_CANCELLED');
      const now = time.nowUtc();
      if (new Date(row.starts_at).getTime() <= now.getTime()) {
        throw conflict('Начавшиеся и завершённые записи отменять нельзя.', 'ALREADY_STARTED');
      }

      let cancelReason = null;
      if (isAdmin && !isOwner) {
        cancelReason = String(reason || '').trim();
        if (cancelReason.length < 5) throw badRequest('Администратор указывает причину (не менее 5 символов).');
      } else if (reason) cancelReason = String(reason).trim();

      const { rowCount } = await client.query(
        `UPDATE bookings SET status = 'CANCELLED', cancelled_at = now(),
                            cancelled_by = $1, cancel_reason = $2
         WHERE id = $3 AND status = 'ACTIVE'`,
        [user.id, cancelReason, bookingId]
      );
      if (rowCount === 0) throw conflict('Запись уже отменена.', 'ALREADY_CANCELLED');

      await client.query('DELETE FROM booking_slots WHERE booking_id = $1', [bookingId]);
      await writeAudit(client, {
        actorId: user.id, action: 'booking.cancel', objectType: 'booking',
        objectId: bookingId, result: 'success', requestId, details: { cancelReason }
      });
      return mapBooking(await getBooking(client, bookingId), time.toIso(now));
    });
  }

  return { createBooking, cancelBooking, getBooking, mapBooking, writeAudit, fingerprint };
}

module.exports = { createBookingService, mapBooking, bookingSelect, writeAudit };