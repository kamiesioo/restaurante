import { randomInt } from 'node:crypto';
import { AppError, now, audit } from './common.js';
import { requireRole } from './auth.js';

// Factura A: emisor RI hacia receptor RI con CUIT. B: emisor RI hacia el resto.
// C: emisor Monotributo.
export function tipoComprobante(config, receptor) {
  if (config.arca.issuerCondition === 'MONOTRIBUTO') return 'C';
  return receptor?.docTipo === 'CUIT' && receptor?.condicionIva === 'RI' ? 'A' : 'B';
}

// Proveedores de ARCA. Todos devuelven { numero, cae, caeVto } o lanzan error.
const providers = {
  deshabilitado() {
    throw new AppError('La facturación electrónica (ARCA) no está configurada en esta máquina', 503);
  },
  // Solo para desarrollo: números y CAE FALSOS, sin validez fiscal.
  mock(ctx) {
    const last = ctx.db.get('SELECT COALESCE(MAX(numero),0) AS n FROM invoice').n;
    const vto = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);
    return { numero: last + 1, cae: `MOCK${randomInt(1e13, 1e14)}`, caeVto: vto };
  },
  // TODO: homologacion / produccion → WSAA (token+sign) y WSFEv1
  // (FECompUltimoAutorizado + FECAESolicitar), con certificado y clave del emisor.
};

export function createPendingInvoice(ctx, orderId, totalCents) {
  ctx.db.run(
    `INSERT INTO invoice (order_id, total_cents, created_at, updated_at) VALUES (?,?,?,?)`,
    orderId, totalCents, now(), now());
}

export function emitInvoice(ctx, orderId, receptor = { docTipo: 'CF' }, actor) {
  requireRole(actor, 'cajero');
  const inv = ctx.db.get('SELECT * FROM invoice WHERE order_id = ?', orderId);
  if (!inv) throw new AppError('El pedido no tiene factura asociada (¿está cobrado?)', 404);
  if (inv.status === 'emitida') return inv; // idempotente

  const anonymous = !receptor?.docNro;
  const limit = ctx.config.arca.identifyAboveCents;
  if (limit > 0 && inv.total_cents > limit && anonymous) {
    throw new AppError('El importe exige identificar al receptor (DNI/CUIT)');
  }
  const tipo = tipoComprobante(ctx.config, receptor);
  const provider = providers[ctx.config.arca.mode];
  if (!provider) throw new AppError(`Modo ARCA no soportado: ${ctx.config.arca.mode}`, 501);

  let result;
  try {
    result = provider(ctx);
  } catch (e) {
    if (e.status === 503) throw e; // no configurado: sigue pendiente, no es un error del comprobante
    ctx.db.run(`UPDATE invoice SET status = 'error', error = ?, updated_at = ? WHERE id = ?`,
      e.message, now(), inv.id);
    audit(ctx, actor.id, 'factura.error', 'invoice', inv.id, { error: e.message });
    throw e;
  }
  ctx.db.run(
    `UPDATE invoice SET status = 'emitida', tipo = ?, pto_vta = ?, numero = ?, cae = ?, cae_vto = ?,
            receptor_doc_tipo = ?, receptor_doc_nro = ?, error = NULL, updated_at = ? WHERE id = ?`,
    tipo, ctx.config.arca.ptoVta, result.numero, result.cae, result.caeVto,
    receptor?.docTipo ?? 'CF', receptor?.docNro ?? null, now(), inv.id);
  audit(ctx, actor.id, 'factura.emitir', 'invoice', inv.id, { tipo, numero: result.numero });
  return ctx.db.get('SELECT * FROM invoice WHERE id = ?', inv.id);
}

export const pendingInvoices = (ctx) =>
  ctx.db.all(
    `SELECT i.*, o.closed_at FROM invoice i JOIN customer_order o ON o.id = i.order_id
     WHERE i.status != 'emitida' ORDER BY i.id`);
