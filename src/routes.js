import * as auth from './services/auth.js';
import * as catalog from './services/catalog.js';
import * as tables from './services/tables.js';
import * as orders from './services/orders.js';
import * as cash from './services/cash.js';
import * as billing from './services/billing.js';
import { closeOrder } from './services/checkout.js';
import { AppError } from './services/common.js';

const route = (method, path, handler, opts = {}) => ({
  method,
  pattern: new RegExp(`^${path.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`),
  handler,
  public: !!opts.public,
});
const id = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new AppError('Id inválido');
  return n;
};

export function buildRoutes(ctx, { rateLimit }) {
  const { config } = ctx;
  const reg = (q) => q.get('register') || config.registerId;

  return [
    // ---------- público (clientes en el Wi-Fi del local, vía QR) ----------
    route('GET', '/api/public/menu/:token', ({ params }) => {
      const t = tables.getTableByToken(ctx, params.token);
      if (!t) throw new AppError('QR inválido', 404);
      return {
        table: { sector: t.sector, number: t.number },
        categories: catalog.getMenu(ctx).map((c) => ({
          ...c, products: c.products.map(({ id, name, description, price_cents, available }) =>
            ({ id, name, description, price_cents, available })),
        })),
      };
    }, { public: true }),
    route('GET', '/api/public/order/:token', ({ params }) => orders.publicOrderView(ctx, params.token), { public: true }),
    route('POST', '/api/public/order/:token', ({ params, body }) => {
      rateLimit(`order:${params.token}`);
      const items = (body.items ?? []).map(({ productId, qty, notes }) => ({ productId, qty, notes }));
      return orders.placeOrderByToken(ctx, params.token, items);
    }, { public: true }),
    route('POST', '/api/public/bill/:token', ({ params }) => {
      rateLimit(`bill:${params.token}`, 3);
      orders.requestBillByToken(ctx, params.token);
    }, { public: true }),

    // ---------- sesión ----------
    route('GET', '/api/login-users', () => auth.listLoginUsers(ctx), { public: true }),
    route('POST', '/api/login', ({ body }) => ({
      ...auth.login(ctx, Number(body.userId), String(body.pin ?? '')),
      machine: { id: config.machineId, registerId: config.registerId },
    }), { public: true }),
    route('POST', '/api/logout', ({ token }) => auth.logout(ctx, token)),

    // ---------- carta / precios ----------
    route('GET', '/api/menu', ({ user }) => catalog.getMenu(ctx, { includeInactive: user.role === 'admin' })),
    route('POST', '/api/categories', ({ body, user }) => ({ id: catalog.createCategory(ctx, body, user) })),
    route('POST', '/api/products', ({ body, user }) => ({ id: catalog.createProduct(ctx, body, user) })),
    route('PUT', '/api/products/:id/price', ({ params, body, user }) =>
      catalog.setPrice(ctx, id(params.id), body.priceCents, user)),
    route('PUT', '/api/products/:id/available', ({ params, body, user }) =>
      catalog.setAvailable(ctx, id(params.id), !!body.available, user)),
    route('PUT', '/api/products/:id/active', ({ params, body, user }) =>
      catalog.setProductActive(ctx, id(params.id), !!body.active, user)),
    route('GET', '/api/products/:id/price-history', ({ params }) => catalog.priceHistory(ctx, id(params.id))),

    // ---------- mesas ----------
    route('GET', '/api/tables', () => tables.listTables(ctx)),
    route('POST', '/api/tables', ({ body, user }) => ({ id: tables.createTable(ctx, body, user) })),
    route('POST', '/api/tables/:id/rotate-qr', ({ params, user }) => tables.rotateQr(ctx, id(params.id), user)),
    route('GET', '/api/tables/qr-links', ({ user }) => tables.qrLinks(ctx, user)),

    // ---------- pedidos ----------
    route('POST', '/api/orders', ({ body, user }) => ({ id: orders.openOrder(ctx, id(body.tableId), user) })),
    route('GET', '/api/orders/:id', ({ params }) => orders.getOrder(ctx, id(params.id))),
    route('POST', '/api/orders/:id/items', ({ params, body, user }) =>
      ({ itemIds: orders.addItems(ctx, id(params.id), body.items, { source: 'mozo', actor: user }) })),
    route('POST', '/api/orders/:id/request-bill', ({ params, user }) => orders.requestBill(ctx, id(params.id), user)),
    route('POST', '/api/orders/:id/close', ({ params, body, user }) =>
      closeOrder(ctx, id(params.id), body, user, config.registerId)),
    route('POST', '/api/items/confirm', ({ body, user }) => orders.confirmItems(ctx, body.itemIds, user)),
    route('POST', '/api/items/:id/status', ({ params, body, user }) =>
      orders.setItemStatus(ctx, id(params.id), body.status, user, body.reason)),

    // ---------- cocina / piso ----------
    route('GET', '/api/kitchen', ({ query }) => orders.kitchenQueue(ctx, query.get('station') || 'cocina')),
    route('GET', '/api/floor', () => orders.floorQueue(ctx)),

    // ---------- caja ----------
    route('GET', '/api/cash/current', ({ query }) => {
      const s = cash.currentSession(ctx, reg(query));
      return s ? cash.sessionSummary(ctx, s.id) : { session: null };
    }),
    route('POST', '/api/cash/open', ({ body, user }) =>
      ({ id: cash.openSession(ctx, config.registerId, body.openingCents, user) })),
    route('POST', '/api/cash/movement', ({ body, user }) =>
      ({ id: cash.addMovement(ctx, config.registerId, body, user) })),
    route('POST', '/api/cash/close', ({ body, user }) =>
      cash.closeSession(ctx, config.registerId, body.countedCents, user)),

    // ---------- auditoría (solo admin) ----------
    route('GET', '/api/audit', ({ query, user }) => {
      auth.requireRole(user, 'admin');
      const limit = Math.min(Number(query.get('limit')) || 100, 500);
      return ctx.db.all(
        `SELECT a.id, a.at, u.name AS user, a.machine_id, a.action, a.entity, a.entity_id, a.detail
         FROM audit_log a LEFT JOIN user u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ?`, limit);
    }),

    // ---------- facturación ----------
    route('GET', '/api/invoices/pending', () => billing.pendingInvoices(ctx)),
    route('POST', '/api/invoices/:orderId/emit', ({ params, body, user }) =>
      billing.emitInvoice(ctx, id(params.orderId), body.receptor, user)),
  ];
}
