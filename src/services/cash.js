import { AppError, now, audit, notify, requireInt } from './common.js';
import { requireRole } from './auth.js';

export function ensureRegister(ctx, id, name) {
  ctx.db.run('INSERT OR IGNORE INTO cash_register (id, name) VALUES (?,?)', id, name);
}

function assertRegister(ctx, registerId) {
  if (!registerId) throw new AppError('Esta máquina no tiene caja asignada');
  if (!ctx.db.get('SELECT 1 FROM cash_register WHERE id = ?', registerId)) {
    throw new AppError('Caja inexistente', 404);
  }
}

export const currentSession = (ctx, registerId) =>
  ctx.db.get('SELECT * FROM cash_session WHERE register_id = ? AND closed_at IS NULL', registerId) ?? null;

export function openSession(ctx, registerId, openingCents, actor) {
  requireRole(actor, 'cajero');
  assertRegister(ctx, registerId);
  requireInt(openingCents, 'Efectivo inicial');
  if (currentSession(ctx, registerId)) throw new AppError('La caja ya está abierta');
  const { lastInsertRowid: id } = ctx.db.run(
    `INSERT INTO cash_session (register_id, opened_by, opened_at, opening_cents) VALUES (?,?,?,?)`,
    registerId, actor.id, now(), openingCents);
  audit(ctx, actor.id, 'caja.abrir', 'cash_session', id, { registerId, openingCents });
  notify(ctx, 'caja');
  return Number(id);
}

export function addMovement(ctx, registerId, { kind, amountCents, reason }, actor) {
  requireRole(actor, 'cajero');
  if (!['ingreso', 'egreso'].includes(kind)) throw new AppError('Tipo inválido');
  requireInt(amountCents, 'Monto', { min: 1 });
  if (!reason?.trim()) throw new AppError('Indicá el motivo');
  const s = currentSession(ctx, registerId);
  if (!s) throw new AppError('La caja está cerrada');
  const { lastInsertRowid: id } = ctx.db.run(
    `INSERT INTO cash_movement (session_id, kind, amount_cents, reason, created_by, created_at)
     VALUES (?,?,?,?,?,?)`, s.id, kind, amountCents, reason.trim(), actor.id, now());
  audit(ctx, actor.id, `caja.${kind}`, 'cash_movement', id, { amountCents, reason });
  return Number(id);
}

// Resumen de una sesión (abierta o cerrada).
export function sessionSummary(ctx, sessionId) {
  const s = ctx.db.get('SELECT * FROM cash_session WHERE id = ?', sessionId);
  if (!s) throw new AppError('Sesión inexistente', 404);
  const byMethod = Object.fromEntries(ctx.db.all(
    `SELECT method, SUM(amount_cents) AS total FROM payment WHERE session_id = ? GROUP BY method`,
    sessionId).map((r) => [r.method, r.total]));
  const mov = (kind) => ctx.db.get(
    `SELECT COALESCE(SUM(amount_cents),0) AS t FROM cash_movement WHERE session_id = ? AND kind = ?`,
    sessionId, kind).t;
  const ingresos = mov('ingreso');
  const egresos = mov('egreso');
  const efectivo = byMethod.efectivo ?? 0;
  const orders = ctx.db.get(
    `SELECT COUNT(DISTINCT p.order_id) AS n FROM payment p WHERE p.session_id = ?`, sessionId).n;
  const fiscal = ctx.db.all(
    `SELECT i.status, SUM(i.total_cents) AS total, COUNT(*) AS n FROM invoice i
     WHERE i.order_id IN (SELECT order_id FROM payment WHERE session_id = ?) GROUP BY i.status`, sessionId);
  return {
    session: s,
    byMethod,
    totalCobrado: Object.values(byMethod).reduce((a, b) => a + b, 0),
    ingresos, egresos,
    expectedCashCents: s.opening_cents + efectivo + ingresos - egresos,
    orders,
    facturacion: Object.fromEntries(fiscal.map((f) => [f.status, { total: f.total, n: f.n }])),
  };
}

export function closeSession(ctx, registerId, countedCents, actor) {
  requireRole(actor, 'cajero');
  requireInt(countedCents, 'Efectivo contado');
  return ctx.db.tx(() => {
    const s = currentSession(ctx, registerId);
    if (!s) throw new AppError('La caja ya está cerrada');
    const open = ctx.db.get(
      `SELECT COUNT(*) AS n FROM customer_order o
       JOIN dining_table t ON t.id = o.table_id WHERE o.status = 'cuenta_pedida'`).n;
    const { expectedCashCents } = sessionSummary(ctx, s.id);
    ctx.db.run(
      `UPDATE cash_session SET closed_by = ?, closed_at = ?, counted_cents = ?, expected_cents = ? WHERE id = ?`,
      actor.id, now(), countedCents, expectedCashCents, s.id);
    audit(ctx, actor.id, 'caja.cerrar', 'cash_session', s.id,
      { countedCents, expectedCashCents, differenceCents: countedCents - expectedCashCents });
    notify(ctx, 'caja');
    return { ...sessionSummary(ctx, s.id), differenceCents: countedCents - expectedCashCents, cuentasPedidasSinCobrar: open };
  });
}
