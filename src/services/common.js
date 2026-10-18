import { EventEmitter } from 'node:events';

export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const now = () => new Date().toISOString();

export function createContext({ db, config }) {
  return { db, config, bus: new EventEmitter() };
}

export function audit(ctx, userId, action, entity, entityId, detail) {
  ctx.db.run(
    `INSERT INTO audit_log (at, user_id, machine_id, action, entity, entity_id, detail)
     VALUES (?,?,?,?,?,?,?)`,
    now(), userId ?? null, ctx.config.machineId, action, entity,
    entityId == null ? null : String(entityId),
    detail === undefined ? null : JSON.stringify(detail),
  );
}

// Avisa a las pantallas abiertas que algo cambió (se reenvía por SSE).
export const notify = (ctx, topic) => ctx.bus.emit('change', topic);

export function requireInt(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new AppError(`${name} inválido`);
  }
  return value;
}
