import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { AppError, now, audit, requireInt } from './common.js';

const ROLES = ['admin', 'cajero', 'mozo', 'cocina'];

const hashPin = (pin, salt = randomBytes(16)) =>
  `${salt.toString('hex')}:${scryptSync(String(pin), salt, 32).toString('hex')}`;

function verifyPin(pin, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = scryptSync(String(pin), Buffer.from(salt, 'hex'), 32);
  return timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

const sha = (s) => createHash('sha256').update(s).digest('hex');

export function createUser(ctx, { name, role, pin }, actorId = null) {
  if (!ROLES.includes(role)) throw new AppError('Rol inválido');
  if (!name?.trim()) throw new AppError('Nombre requerido');
  if (!/^\d{4,8}$/.test(String(pin))) throw new AppError('El PIN debe tener de 4 a 8 dígitos');
  const { lastInsertRowid: id } = ctx.db.run(
    'INSERT INTO user (name, role, pin_hash, created_at) VALUES (?,?,?,?)',
    name.trim(), role, hashPin(pin), now(),
  );
  audit(ctx, actorId, 'usuario.crear', 'user', id, { name, role });
  return Number(id);
}

export const listLoginUsers = (ctx) =>
  ctx.db.all('SELECT id, name, role FROM user WHERE active = 1 ORDER BY name');

// Límite de intentos por usuario (en memoria, por proceso).
const attempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCK_MS = 60_000;

export function login(ctx, userId, pin) {
  const a = attempts.get(userId);
  if (a && a.count >= MAX_ATTEMPTS && Date.now() - a.last < LOCK_MS) {
    throw new AppError('Demasiados intentos, esperá un minuto', 429);
  }
  const user = ctx.db.get('SELECT * FROM user WHERE id = ? AND active = 1', userId);
  if (!user || !verifyPin(pin, user.pin_hash)) {
    attempts.set(userId, { count: (a?.count ?? 0) + 1, last: Date.now() });
    throw new AppError('Usuario o PIN incorrecto', 401);
  }
  attempts.delete(userId);
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + ctx.config.sessionHours * 3600_000).toISOString();
  ctx.db.run('INSERT INTO auth_session (token_hash, user_id, expires_at) VALUES (?,?,?)',
    sha(token), user.id, expires);
  return { token, user: { id: user.id, name: user.name, role: user.role } };
}

export function userFromToken(ctx, token) {
  if (!token) return null;
  return ctx.db.get(
    `SELECT u.id, u.name, u.role FROM auth_session s JOIN user u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
    sha(token), now(),
  ) ?? null;
}

export function logout(ctx, token) {
  ctx.db.run('DELETE FROM auth_session WHERE token_hash = ?', sha(token));
}

export function setUserActive(ctx, userId, active, actor) {
  requireRole(actor, 'admin');
  requireInt(userId, 'userId');
  ctx.db.run('UPDATE user SET active = ? WHERE id = ?', active ? 1 : 0, userId);
  audit(ctx, actor.id, active ? 'usuario.activar' : 'usuario.desactivar', 'user', userId);
}

export function requireRole(user, ...roles) {
  if (!user) throw new AppError('No autenticado', 401);
  if (user.role !== 'admin' && !roles.includes(user.role)) {
    throw new AppError('No tenés permiso para esto', 403);
  }
}
