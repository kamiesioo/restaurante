import { AppError, now, audit, notify, requireInt } from './common.js';
import { requireRole } from './auth.js';
import { getTableByToken } from './tables.js';

const MAX_QTY = 20;
const OPEN = ['abierto', 'cuenta_pedida'];

export function openOrder(ctx, tableId, actor = null) {
  return ctx.db.tx(() => {
    const table = ctx.db.get('SELECT id FROM dining_table WHERE id = ? AND active = 1', tableId);
    if (!table) throw new AppError('Mesa inexistente', 404);
    const existing = ctx.db.get(
      `SELECT id FROM customer_order WHERE table_id = ? AND status IN ('abierto','cuenta_pedida')`, tableId);
    if (existing) return existing.id;
    const { lastInsertRowid: id } = ctx.db.run(
      'INSERT INTO customer_order (table_id, opened_by, opened_at) VALUES (?,?,?)',
      tableId, actor?.id ?? null, now());
    audit(ctx, actor?.id, 'pedido.abrir', 'customer_order', id, { tableId });
    return Number(id);
  });
}

// Agrega ítems congelando nombre y precio vigentes. Una cuenta pedida vuelve a "abierto".
export function addItems(ctx, orderId, items, { source, actor = null }) {
  if (!Array.isArray(items) || items.length === 0) throw new AppError('Pedido vacío');
  if (items.length > 30) throw new AppError('Demasiados ítems');
  const status = source === 'qr' && ctx.config.qrRequiresConfirmation ? 'por_confirmar' : 'enviado';
  const ids = ctx.db.tx(() => {
    const order = ctx.db.get('SELECT status FROM customer_order WHERE id = ?', orderId);
    if (!order) throw new AppError('Pedido inexistente', 404);
    if (!OPEN.includes(order.status)) throw new AppError('El pedido ya está cerrado');
    const out = [];
    for (const it of items) {
      requireInt(it.qty, 'Cantidad', { min: 1, max: MAX_QTY });
      const p = ctx.db.get('SELECT * FROM product WHERE id = ? AND active = 1', it.productId);
      if (!p) throw new AppError('Producto inexistente', 404);
      if (!p.available) throw new AppError(`"${p.name}" no está disponible`);
      const notes = String(it.notes ?? '').slice(0, 200);
      const t = now();
      const { lastInsertRowid } = ctx.db.run(
        `INSERT INTO order_item (order_id, product_id, name_snap, unit_price_cents, iva_rate,
           qty, notes, station, source, status, created_at, status_changed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        orderId, p.id, p.name, p.price_cents, p.iva_rate, it.qty, notes, p.station, source, status, t, t);
      out.push(Number(lastInsertRowid));
    }
    if (order.status === 'cuenta_pedida') {
      ctx.db.run(`UPDATE customer_order SET status = 'abierto' WHERE id = ?`, orderId);
    }
    audit(ctx, actor?.id, 'pedido.items', 'customer_order', orderId, { source, itemIds: out });
    return out;
  });
  notify(ctx, 'pedidos');
  return ids;
}

// Pedido del cliente escaneando el QR de la mesa.
export function placeOrderByToken(ctx, token, items) {
  const table = getTableByToken(ctx, token);
  if (!table) throw new AppError('QR inválido', 404);
  const orderId = openOrder(ctx, table.id);
  const itemIds = addItems(ctx, orderId, items, { source: 'qr' });
  return { orderId, itemIds, needsConfirmation: ctx.config.qrRequiresConfirmation };
}

export function requestBillByToken(ctx, token) {
  const table = getTableByToken(ctx, token);
  if (!table) throw new AppError('QR inválido', 404);
  const order = ctx.db.get(
    `SELECT id FROM customer_order WHERE table_id = ? AND status IN ('abierto','cuenta_pedida')`, table.id);
  if (!order) throw new AppError('No hay un pedido abierto en esta mesa');
  return requestBill(ctx, order.id, null);
}

export function requestBill(ctx, orderId, actor) {
  const r = ctx.db.run(`UPDATE customer_order SET status = 'cuenta_pedida'
                        WHERE id = ? AND status IN ('abierto','cuenta_pedida')`, orderId);
  if (!r.changes) throw new AppError('El pedido no está abierto');
  audit(ctx, actor?.id, 'pedido.pedir_cuenta', 'customer_order', orderId);
  notify(ctx, 'pedidos');
}

export function confirmItems(ctx, itemIds, actor) {
  requireRole(actor, 'mozo', 'cajero');
  ctx.db.tx(() => {
    for (const id of itemIds) {
      const r = ctx.db.run(
        `UPDATE order_item SET status = 'enviado', status_changed_at = ? WHERE id = ? AND status = 'por_confirmar'`,
        now(), id);
      if (!r.changes) throw new AppError(`El ítem ${id} no está esperando confirmación`);
    }
    audit(ctx, actor.id, 'pedido.confirmar', 'order_item', itemIds.join(','));
  });
  notify(ctx, 'pedidos');
}

const FORWARD = {
  enviado: ['en_preparacion', 'listo'],
  en_preparacion: ['listo'],
  listo: ['entregado'],
};
const WHO = {
  en_preparacion: ['cocina', 'cajero'],
  listo: ['cocina', 'cajero'],
  entregado: ['mozo', 'cajero'],
};

export function setItemStatus(ctx, itemId, status, actor, reason = '') {
  ctx.db.tx(() => {
    const item = ctx.db.get('SELECT * FROM order_item WHERE id = ?', itemId);
    if (!item) throw new AppError('Ítem inexistente', 404);
    if (status === 'cancelado') {
      if (!reason.trim()) throw new AppError('Indicá el motivo de la cancelación');
      if (['entregado', 'cancelado'].includes(item.status)) {
        throw new AppError('Ese ítem ya no se puede cancelar');
      }
      // Cancelar algo que cocina ya empezó exige más jerarquía.
      requireRole(actor, ...(['por_confirmar', 'enviado'].includes(item.status)
        ? ['mozo', 'cajero'] : ['cajero']));
    } else {
      if (!FORWARD[item.status]?.includes(status)) {
        throw new AppError(`No se puede pasar de ${item.status} a ${status}`);
      }
      requireRole(actor, ...WHO[status]);
    }
    ctx.db.run(`UPDATE order_item SET status = ?, cancel_reason = ?, status_changed_at = ? WHERE id = ?`,
      status, status === 'cancelado' ? reason.trim() : null, now(), itemId);
    audit(ctx, actor.id, `item.${status}`, 'order_item', itemId,
      { from: item.status, ...(reason && { reason }) });
  });
  notify(ctx, 'pedidos');
}

// Lo que cocina/barra tiene que preparar, lo más viejo primero.
export function kitchenQueue(ctx, station) {
  return ctx.db.all(
    `SELECT i.id, i.name_snap AS name, i.qty, i.notes, i.status, i.created_at,
            t.sector, t.number AS table_number
     FROM order_item i
     JOIN customer_order o ON o.id = i.order_id
     JOIN dining_table t ON t.id = o.table_id
     WHERE i.station = ? AND i.status IN ('enviado','en_preparacion')
     ORDER BY i.created_at, i.id`, station);
}

// Lo listo para llevar a la mesa, y lo del QR que espera confirmación del mozo.
export function floorQueue(ctx) {
  const base = `SELECT i.id, i.name_snap AS name, i.qty, i.notes, i.created_at,
                       t.sector, t.number AS table_number, o.id AS order_id
                FROM order_item i
                JOIN customer_order o ON o.id = i.order_id
                JOIN dining_table t ON t.id = o.table_id
                WHERE i.status = ? ORDER BY i.status_changed_at, i.id`;
  return { listos: ctx.db.all(base, 'listo'), porConfirmar: ctx.db.all(base, 'por_confirmar') };
}

export function orderTotal(ctx, orderId) {
  return ctx.db.get(
    `SELECT COALESCE(SUM(unit_price_cents * qty), 0) AS total FROM order_item
     WHERE order_id = ? AND status != 'cancelado'`, orderId).total;
}

export function getOrder(ctx, orderId) {
  const order = ctx.db.get(
    `SELECT o.*, t.sector, t.number AS table_number FROM customer_order o
     JOIN dining_table t ON t.id = o.table_id WHERE o.id = ?`, orderId);
  if (!order) throw new AppError('Pedido inexistente', 404);
  const items = ctx.db.all('SELECT * FROM order_item WHERE order_id = ? ORDER BY id', orderId);
  return { ...order, items, total_cents: orderTotal(ctx, orderId) };
}

// Vista pública (cliente): sin datos internos.
export function publicOrderView(ctx, token) {
  const table = getTableByToken(ctx, token);
  if (!table) throw new AppError('QR inválido', 404);
  const order = ctx.db.get(
    `SELECT id, status FROM customer_order WHERE table_id = ? AND status IN ('abierto','cuenta_pedida')`, table.id);
  if (!order) return { table: { sector: table.sector, number: table.number }, items: [], totalCents: 0 };
  const items = ctx.db.all(
    `SELECT name_snap AS name, qty, unit_price_cents, status FROM order_item
     WHERE order_id = ? ORDER BY id`, order.id);
  return {
    table: { sector: table.sector, number: table.number },
    status: order.status, items, totalCents: orderTotal(ctx, order.id),
  };
}
