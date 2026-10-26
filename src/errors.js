'use strict';

class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const badRequest = (m, c = 'VALIDATION_ERROR') => new AppError(400, c, m);
const unauthorized = (m = 'Требуется вход. Укажите действительный JWT.') => new AppError(401, 'UNAUTHORIZED', m);
const forbidden = (m = 'Недостаточно прав для административной операции.') => new AppError(403, 'FORBIDDEN', m);
const notFound = (m = 'Запись не найдена.') => new AppError(404, 'NOT_FOUND', m);
const conflict = (m, c = 'CONFLICT') => new AppError(409, c, m);

function uniqueViolation(err) {
  if (!err) return false;
  if (err.code === '23505') return true;
  return /duplicate key value/i.test(String(err.message || ''));
}

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict, uniqueViolation };