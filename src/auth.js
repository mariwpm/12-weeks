'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { unauthorized, forbidden } = require('./errors');

function signToken(user, secret, expiresIn) {
  return jwt.sign(
    { sub: user.id, login: user.login, role: user.role, name: user.name },
    secret, { expiresIn }
  );
}

const hashPassword = (p) => bcrypt.hashSync(p, 10);
const verifyPassword = (p, h) => bcrypt.compareSync(p, h);

function readBearer(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  return m ? m[1] : null;
}

function requireAuth(secret) {
  return (req, _res, next) => {
    const token = readBearer(req);
    if (!token) return next(unauthorized('Нет действительного JWT.'));
    try {
      const p = jwt.verify(token, secret);
      req.user = { id: p.sub, login: p.login, role: p.role, name: p.name };
      next();
    } catch { next(unauthorized('JWT отсутствует, недействителен или истёк.')); }
  };
}

function requireAdmin(req, _res, next) {
  if (!req.user || req.user.role !== 'admin') return next(forbidden());
  next();
}

const publicUser = (r) => ({ id: r.id, name: r.name, login: r.login, role: r.role });

module.exports = { signToken, hashPassword, verifyPassword, requireAuth, requireAdmin, publicUser };