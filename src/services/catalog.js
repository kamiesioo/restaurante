import { AppError, now, audit, notify, requireInt } from './common.js';
import { requireRole } from './auth.js';

export function createCategory(ctx, { name, position = 0 }, actor) {
  requireRole(actor, 'admin');
  if (!name?.trim()) throw new AppError('Nombre requerido');
  const { lastInsertRowid: id } = ctx.db.run(
    'INSERT INTO category (name, position) VALUES (?,?)', name.trim(), position);
  audit(ctx, actor.id, 'categoria.crear', 'category', id, { name });
  notify(ctx, 'carta');
  return Number(id);
}

export function createProduct(ctx, p, actor) {
  requireRole(actor, 'admin');
  if (!p.name?.trim()) throw new AppError('Nombre requerido');
  requireInt(p.priceCents, 'Precio');
  const station = p.station ?? 'cocina';
  if (!['cocina', 'barra'].includes(station)) throw new AppError('Estación inválida');
  if (!ctx.db.get('SELECT 1 FROM category WHERE id = ?', p.categoryId)) {
    throw new AppError('Categoría inexistente', 404);
  }
  const { lastInsertRowid: id } = ctx.db.run(
    `INSERT INTO product (category_id, name, description, price_cents, iva_rate, station, updated_at)
     VALUES (?,?,?,?,?,?,?)`,
    p.categoryId, p.name.trim(), p.description ?? '', p.priceCents, p.ivaRate ?? 21, station, now());
  audit(ctx, actor.id, 'producto.crear', 'product', id, { name: p.name, priceCents: p.priceCents });
  notify(ctx, 'carta');
  return Number(id);
}

// El precio nuevo se aplica a la carta de inmediato (la carta se lee siempre de
// `product`). Los pedidos ya tomados conservan el precio con el que se pidieron.
export function setPrice(ctx, productId, newCents, actor) {
  requireRole(actor, 'admin');
  requireInt(newCents, 'Precio');
  ctx.db.tx(() => {
    const prod = ctx.db.get('SELECT id, price_cents FROM product WHERE id = ?', productId);
    if (!prod) throw new AppError('Producto inexistente', 404);
    if (prod.price_cents === newCents) return;
    ctx.db.run('UPDATE product SET price_cents = ?, updated_at = ? WHERE id = ?',
      newCents, now(), productId);
    ctx.db.run(
      `INSERT INTO price_history (product_id, old_cents, new_cents, changed_by, changed_at)
       VALUES (?,?,?,?,?)`, productId, prod.price_cents, newCents, actor.id, now());
    audit(ctx, actor.id, 'precio.cambiar', 'product', productId,
      { oldCents: prod.price_cents, newCents });
  });
  notify(ctx, 'carta');
}

export function setAvailable(ctx, productId, available, actor) {
  requireRole(actor, 'admin', 'cajero', 'cocina');
  const r = ctx.db.run('UPDATE product SET available = ?, updated_at = ? WHERE id = ?',
    available ? 1 : 0, now(), productId);
  if (!r.changes) throw new AppError('Producto inexistente', 404);
  audit(ctx, actor.id, available ? 'producto.disponible' : 'producto.agotado', 'product', productId);
  notify(ctx, 'carta');
}

export function setProductActive(ctx, productId, active, actor) {
  requireRole(actor, 'admin');
  const r = ctx.db.run('UPDATE product SET active = ?, updated_at = ? WHERE id = ?',
    active ? 1 : 0, now(), productId);
  if (!r.changes) throw new AppError('Producto inexistente', 404);
  audit(ctx, actor.id, active ? 'producto.activar' : 'producto.baja', 'product', productId);
  notify(ctx, 'carta');
}

export function priceHistory(ctx, productId) {
  return ctx.db.all(
    'SELECT * FROM price_history WHERE product_id = ? ORDER BY id DESC', productId);
}

// La carta que ven clientes (QR), mozos y admin. `includeInactive` es solo admin.
export function getMenu(ctx, { includeInactive = false } = {}) {
  const cats = ctx.db.all(
    `SELECT id, name FROM category ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY position, id`);
  const prods = ctx.db.all(
    `SELECT id, category_id, name, description, price_cents, iva_rate, station, available, active
     FROM product ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY name`);
  return cats.map((c) => ({
    ...c,
    products: prods.filter((p) => p.category_id === c.id)
      .map((p) => ({ ...p, available: !!p.available, active: !!p.active })),
  }));
}
