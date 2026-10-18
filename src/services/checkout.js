import { AppError, now, audit, notify, requireInt } from './common.js';
import { requireRole } from './auth.js';
import { currentSession } from './cash.js';
import { orderTotal } from './orders.js';
import { createPendingInvoice, emitInvoice } from './billing.js';

const METHODS = ['efectivo', 'debito', 'credito', 'transferencia', 'qr'];

// Cobra y cierra el pedido. Siempre queda registrado en la caja; la factura nace
// "pendiente" y se emite ahora (`emitirFactura`) o más tarde desde "pendientes".
export function closeOrder(ctx, orderId, { payments, emitirFactura = false, receptor }, actor, registerId) {
  requireRole(actor, 'cajero');
  const result = ctx.db.tx(() => {
    if (!registerId) throw new AppError('Esta máquina no tiene caja asignada');
    const session = currentSession(ctx, registerId);
    if (!session) throw new AppError('Abrí la caja antes de cobrar');

    const order = ctx.db.get('SELECT * FROM customer_order WHERE id = ?', orderId);
    if (!order) throw new AppError('Pedido inexistente', 404);
    if (!['abierto', 'cuenta_pedida'].includes(order.status)) throw new AppError('El pedido ya está cerrado');

    const pending = ctx.db.get(
      `SELECT COUNT(*) AS n FROM order_item WHERE order_id = ?
       AND status NOT IN ('entregado','cancelado')`, orderId).n;
    if (pending) throw new AppError(`Quedan ${pending} ítem(s) sin entregar o cancelar`);

    const total = orderTotal(ctx, orderId);
    if (total === 0) throw new AppError('El pedido no tiene ítems para cobrar');
    if (!Array.isArray(payments) || payments.length === 0) throw new AppError('Faltan los pagos');
    let sum = 0;
    for (const p of payments) {
      if (!METHODS.includes(p.method)) throw new AppError('Medio de pago inválido');
      requireInt(p.amountCents, 'Monto', { min: 1 });
      sum += p.amountCents;
    }
    if (sum !== total) throw new AppError(`Los pagos (${sum}) no coinciden con el total (${total})`);

    for (const p of payments) {
      ctx.db.run(
        `INSERT INTO payment (order_id, session_id, method, amount_cents, created_by, created_at)
         VALUES (?,?,?,?,?,?)`, orderId, session.id, p.method, p.amountCents, actor.id, now());
    }
    ctx.db.run(`UPDATE customer_order SET status = 'cerrado', closed_at = ?, closed_session_id = ? WHERE id = ?`,
      now(), session.id, orderId);
    createPendingInvoice(ctx, orderId, total);
    audit(ctx, actor.id, 'pedido.cobrar', 'customer_order', orderId, { total, payments });
    return { orderId, totalCents: total };
  });
  notify(ctx, 'pedidos');

  // Se emite fuera de la transacción del cobro: si ARCA falla, el cobro NO se pierde.
  let invoice = null;
  let invoiceError = null;
  if (emitirFactura) {
    try {
      invoice = emitInvoice(ctx, orderId, receptor, actor);
    } catch (e) {
      invoiceError = e.message;
    }
  }
  return { ...result, invoice, invoiceError };
}
