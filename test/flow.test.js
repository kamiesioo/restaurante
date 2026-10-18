import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { setPrice, priceHistory, getMenu, setAvailable } from '../src/services/catalog.js';
import { placeOrderByToken, confirmItems, setItemStatus, kitchenQueue, floorQueue,
  getOrder, requestBillByToken, publicOrderView, openOrder, addItems } from '../src/services/orders.js';
import { openSession, closeSession, addMovement, sessionSummary } from '../src/services/cash.js';
import { closeOrder } from '../src/services/checkout.js';
import { emitInvoice, pendingInvoices } from '../src/services/billing.js';
import { userFromToken, login } from '../src/services/auth.js';

test('flujo completo: QR → mozo confirma → cocina → entrega → cobro', () => {
  const { ctx, mozo, cocina, cajero, milanesa, gaseosa, table } = setup();

  const r = placeOrderByToken(ctx, table.qr_token, [
    { productId: milanesa, qty: 2, notes: 'sin sal' }, { productId: gaseosa, qty: 1 }]);
  assert.equal(r.needsConfirmation, true);
  assert.equal(kitchenQueue(ctx, 'cocina').length, 0, 'sin confirmar no llega a cocina');
  assert.equal(floorQueue(ctx).porConfirmar.length, 2);

  confirmItems(ctx, r.itemIds, mozo);
  const q = kitchenQueue(ctx, 'cocina');
  assert.equal(q.length, 1);
  assert.deepEqual([q[0].sector, q[0].table_number, q[0].qty], ['PB', '1', 2]);
  assert.equal(kitchenQueue(ctx, 'barra').length, 1);

  const [mila, gas] = r.itemIds;
  setItemStatus(ctx, mila, 'en_preparacion', cocina);
  setItemStatus(ctx, mila, 'listo', cocina);
  setItemStatus(ctx, gas, 'listo', cocina);
  assert.equal(floorQueue(ctx).listos.length, 2);
  setItemStatus(ctx, mila, 'entregado', mozo);
  setItemStatus(ctx, gas, 'entregado', mozo);

  requestBillByToken(ctx, table.qr_token);
  assert.equal(getOrder(ctx, r.orderId).status, 'cuenta_pedida');
  assert.equal(getOrder(ctx, r.orderId).total_cents, 23000);

  openSession(ctx, 'PB', 5000, cajero);
  const out = closeOrder(ctx, r.orderId,
    { payments: [{ method: 'efectivo', amountCents: 13000 }, { method: 'debito', amountCents: 10000 }] },
    cajero, 'PB');
  assert.equal(out.invoice, null);
  assert.equal(pendingInvoices(ctx).length, 1, 'queda registrada y pendiente de facturar');

  const res = closeSession(ctx, 'PB', 18000, cajero);
  assert.equal(res.expectedCashCents, 18000); // 5000 inicial + 13000 efectivo
  assert.equal(res.differenceCents, 0);
  assert.equal(res.totalCobrado, 23000);
});

test('cambio de precio: la carta cambia sola, el pedido ya tomado conserva su precio', () => {
  const { ctx, admin, mozo, milanesa, table } = setup({ qrRequiresConfirmation: false });
  const r = placeOrderByToken(ctx, table.qr_token, [{ productId: milanesa, qty: 1 }]);
  setPrice(ctx, milanesa, 12500, admin);

  const prod = getMenu(ctx)[0].products.find((p) => p.id === milanesa);
  assert.equal(prod.price_cents, 12500);
  assert.equal(getOrder(ctx, r.orderId).items[0].unit_price_cents, 10000);

  const r2 = placeOrderByToken(ctx, table.qr_token, [{ productId: milanesa, qty: 1 }]);
  assert.equal(getOrder(ctx, r2.orderId).items[1].unit_price_cents, 12500);
  assert.deepEqual(priceHistory(ctx, milanesa).map((h) => [h.old_cents, h.new_cents]), [[10000, 12500]]);
  assert.throws(() => setPrice(ctx, milanesa, 1, mozo), /permiso/);
  assert.throws(() => setPrice(ctx, milanesa, -5, admin), /inválido/);
  assert.throws(() => setPrice(ctx, milanesa, 10.5, admin), /inválido/);
});

test('validaciones del pedido por QR', () => {
  const { ctx, milanesa, table, admin } = setup();
  assert.throws(() => placeOrderByToken(ctx, 'token-falso', [{ productId: milanesa, qty: 1 }]), /QR inválido/);
  assert.throws(() => placeOrderByToken(ctx, table.qr_token, []), /vacío/);
  assert.throws(() => placeOrderByToken(ctx, table.qr_token, [{ productId: milanesa, qty: 0 }]), /Cantidad/);
  assert.throws(() => placeOrderByToken(ctx, table.qr_token, [{ productId: milanesa, qty: 999 }]), /Cantidad/);
  setAvailable(ctx, milanesa, false, admin);
  assert.throws(() => placeOrderByToken(ctx, table.qr_token, [{ productId: milanesa, qty: 1 }]), /no está disponible/);
  assert.equal(publicOrderView(ctx, table.qr_token).items.length, 0);
});

test('cobro: reglas', () => {
  const { ctx, cajero, mozo, cocina, milanesa, table, tableId } = setup({ qrRequiresConfirmation: false });
  const orderId = openOrder(ctx, tableId, mozo);
  assert.equal(openOrder(ctx, tableId, mozo), orderId, 'una sola cuenta abierta por mesa');
  const [item] = addItems(ctx, orderId, [{ productId: milanesa, qty: 1 }], { source: 'mozo', actor: mozo });
  const pay = { payments: [{ method: 'efectivo', amountCents: 10000 }] };

  assert.throws(() => closeOrder(ctx, orderId, pay, cajero, 'PB'), /Abrí la caja/);
  openSession(ctx, 'PB', 0, cajero);
  assert.throws(() => openSession(ctx, 'PB', 0, cajero), /ya está abierta/);
  assert.throws(() => closeOrder(ctx, orderId, pay, cajero, 'PB'), /sin entregar/);
  assert.throws(() => closeOrder(ctx, orderId, pay, mozo, 'PB'), /permiso/);

  setItemStatus(ctx, item, 'listo', cocina);
  setItemStatus(ctx, item, 'entregado', mozo);
  assert.throws(() => closeOrder(ctx, orderId,
    { payments: [{ method: 'efectivo', amountCents: 9999 }] }, cajero, 'PB'), /no coinciden/);
  closeOrder(ctx, orderId, pay, cajero, 'PB');
  assert.throws(() => closeOrder(ctx, orderId, pay, cajero, 'PB'), /ya está cerrado/);
});

test('cancelaciones: motivo obligatorio y jerarquía según el avance', () => {
  const { ctx, cajero, mozo, cocina, milanesa, tableId } = setup({ qrRequiresConfirmation: false });
  const orderId = openOrder(ctx, tableId, mozo);
  const [a, b] = addItems(ctx, orderId,
    [{ productId: milanesa, qty: 1 }, { productId: milanesa, qty: 1 }], { source: 'mozo', actor: mozo });
  assert.throws(() => setItemStatus(ctx, a, 'cancelado', mozo, ''), /motivo/);
  setItemStatus(ctx, a, 'cancelado', mozo, 'se arrepintió');
  setItemStatus(ctx, b, 'en_preparacion', cocina);
  assert.throws(() => setItemStatus(ctx, b, 'cancelado', mozo, 'x'), /permiso/);
  setItemStatus(ctx, b, 'cancelado', cajero, 'error de cocina');
  assert.equal(getOrder(ctx, orderId).total_cents, 0);
  assert.throws(() => setItemStatus(ctx, b, 'listo', cocina), /No se puede pasar/);
});

test('movimientos de caja y arqueo con diferencia', () => {
  const { ctx, cajero } = setup();
  openSession(ctx, 'PB', 10000, cajero);
  addMovement(ctx, 'PB', { kind: 'egreso', amountCents: 2000, reason: 'Hielo' }, cajero);
  addMovement(ctx, 'PB', { kind: 'ingreso', amountCents: 500, reason: 'Cambio' }, cajero);
  assert.throws(() => addMovement(ctx, 'PB', { kind: 'egreso', amountCents: 1, reason: ' ' }, cajero), /motivo/);
  const res = closeSession(ctx, 'PB', 8000, cajero);
  assert.equal(res.expectedCashCents, 8500);
  assert.equal(res.differenceCents, -500);
});

test('las cajas PB y P1 son independientes', () => {
  const { ctx, cajero } = setup();
  const pb = openSession(ctx, 'PB', 1000, cajero);
  const p1 = openSession(ctx, 'P1', 2000, cajero);
  assert.notEqual(pb, p1);
  closeSession(ctx, 'PB', 1000, cajero);
  assert.equal(sessionSummary(ctx, p1).session.closed_at, null);
});

test('facturación: deshabilitada deja pendiente; mock emite y es idempotente', () => {
  for (const mode of ['deshabilitado', 'mock']) {
    const { ctx, cajero, mozo, cocina, milanesa, tableId } = setup({
      qrRequiresConfirmation: false, arca: { mode, ptoVta: 3, issuerCondition: 'RI', identifyAboveCents: 50000 } });
    const orderId = openOrder(ctx, tableId, mozo);
    const [i] = addItems(ctx, orderId, [{ productId: milanesa, qty: 1 }], { source: 'mozo', actor: mozo });
    setItemStatus(ctx, i, 'listo', cocina); setItemStatus(ctx, i, 'entregado', mozo);
    openSession(ctx, 'PB', 0, cajero);
    const out = closeOrder(ctx, orderId, { payments: [{ method: 'efectivo', amountCents: 10000 }], emitirFactura: true },
      cajero, 'PB');
    if (mode === 'deshabilitado') {
      assert.match(out.invoiceError, /no está configurada/);
      assert.equal(pendingInvoices(ctx).length, 1, 'el cobro no se pierde');
    } else {
      assert.equal(out.invoice.status, 'emitida');
      assert.equal(out.invoice.tipo, 'B');
      assert.equal(out.invoice.pto_vta, 3);
      assert.equal(emitInvoice(ctx, orderId, undefined, cajero).cae, out.invoice.cae);
      assert.equal(pendingInvoices(ctx).length, 0);
    }
  }
});

test('auditoría y pagos no se pueden editar ni borrar', () => {
  const { ctx, admin } = setup();
  setPrice(ctx, 1, 11000, admin);
  assert.ok(ctx.db.get(`SELECT 1 FROM audit_log WHERE action = 'precio.cambiar'`));
  assert.throws(() => ctx.db.run('DELETE FROM audit_log'), /solo-inserción/);
  assert.throws(() => ctx.db.run(`UPDATE audit_log SET action = 'x'`), /solo-inserción/);
});

test('login: PIN incorrecto, sesión y límite de intentos', () => {
  const { ctx, mozo } = setup();
  const { token } = login(ctx, mozo.id, '3333');
  assert.equal(userFromToken(ctx, token).role, 'mozo');
  assert.equal(userFromToken(ctx, 'otro'), null);
  for (let i = 0; i < 5; i++) assert.throws(() => login(ctx, mozo.id, '0000'), /incorrecto/);
  assert.throws(() => login(ctx, mozo.id, '3333'), /Demasiados intentos/);
});
