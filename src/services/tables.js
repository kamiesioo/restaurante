import { randomBytes } from 'node:crypto';
import { AppError, audit } from './common.js';
import { requireRole } from './auth.js';

const newToken = () => randomBytes(16).toString('base64url');

export function createTable(ctx, { sector, number }, actor) {
  requireRole(actor, 'admin');
  if (!sector?.trim() || !String(number ?? '').trim()) throw new AppError('Sector y número requeridos');
  try {
    const { lastInsertRowid: id } = ctx.db.run(
      'INSERT INTO dining_table (sector, number, qr_token) VALUES (?,?,?)',
      sector.trim(), String(number).trim(), newToken());
    audit(ctx, actor.id, 'mesa.crear', 'dining_table', id, { sector, number });
    return Number(id);
  } catch (e) {
    if (/UNIQUE/.test(e.message)) throw new AppError('Esa mesa ya existe');
    throw e;
  }
}

export const qrUrl = (ctx, table) => `${ctx.config.publicBaseUrl}/m/${table.qr_token}`;

export function rotateQr(ctx, tableId, actor) {
  requireRole(actor, 'cajero');
  const r = ctx.db.run('UPDATE dining_table SET qr_token = ? WHERE id = ?', newToken(), tableId);
  if (!r.changes) throw new AppError('Mesa inexistente', 404);
  audit(ctx, actor.id, 'mesa.rotar_qr', 'dining_table', tableId);
}

export const getTableByToken = (ctx, token) =>
  ctx.db.get('SELECT * FROM dining_table WHERE qr_token = ? AND active = 1', String(token));

// Mesas con su estado (derivado del pedido abierto) y total parcial.
export function listTables(ctx) {
  return ctx.db.all(
    `SELECT t.id, t.sector, t.number,
            o.id AS order_id, o.status AS order_status,
            COALESCE((SELECT SUM(i.unit_price_cents * i.qty) FROM order_item i
                      WHERE i.order_id = o.id AND i.status != 'cancelado'), 0) AS total_cents
     FROM dining_table t
     LEFT JOIN customer_order o ON o.table_id = t.id AND o.status IN ('abierto','cuenta_pedida')
     WHERE t.active = 1 ORDER BY t.sector, CAST(t.number AS INTEGER), t.number`,
  ).map((r) => ({ ...r, state: r.order_id ? (r.order_status === 'cuenta_pedida' ? 'pidio_cuenta' : 'ocupada') : 'libre' }));
}

export function qrLinks(ctx, actor) {
  requireRole(actor, 'cajero');
  return ctx.db.all('SELECT * FROM dining_table WHERE active = 1 ORDER BY sector, number')
    .map((t) => ({ id: t.id, sector: t.sector, number: t.number, url: qrUrl(ctx, t) }));
}
