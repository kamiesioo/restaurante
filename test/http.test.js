import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setup } from './helpers.js';
import { createApp } from '../src/server.js';

async function start() {
  const s = setup();
  const server = createServer(createApp(s.ctx));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, token) => {
    const r = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: body && JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  return { ...s, server, call, base };
}

test('API: cliente por QR, mozo confirma, cocina avanza; permisos', async () => {
  const t = await start();
  try {
    const menu = await t.call('GET', `/api/public/menu/${t.table.qr_token}`);
    assert.equal(menu.status, 200);
    const find = (m) => m.body.categories[0].products.find((p) => p.id === t.milanesa);
    assert.equal(find(menu).price_cents, 10000);
    assert.equal(JSON.stringify(menu.body).includes('station'), false, 'no filtra datos internos');

    assert.equal((await t.call('GET', '/api/public/menu/falso')).status, 404);
    assert.equal((await t.call('GET', '/api/tables')).status, 401, 'el staff exige login');

    const order = await t.call('POST', `/api/public/order/${t.table.qr_token}`, { items: [{ productId: t.milanesa, qty: 1 }] });
    assert.equal(order.status, 200);

    const login = async (user, pin) => (await t.call('POST', '/api/login', { userId: user.id, pin })).body.token;
    const mozoTk = await login(t.mozo, '3333');
    const cocinaTk = await login(t.cocina, '4444');

    const floor = await t.call('GET', '/api/floor', null, mozoTk);
    assert.equal(floor.body.porConfirmar.length, 1);
    assert.equal((await t.call('POST', '/api/items/confirm', { itemIds: order.body.itemIds }, mozoTk)).status, 200);

    const q = await t.call('GET', '/api/kitchen?station=cocina', null, cocinaTk);
    assert.equal(q.body.length, 1);
    assert.equal((await t.call('POST', `/api/items/${q.body[0].id}/status`, { status: 'listo' }, cocinaTk)).status, 200);
    assert.equal((await t.call('POST', `/api/items/${q.body[0].id}/status`, { status: 'entregado' }, cocinaTk)).status, 403);

    // cambiar precio: solo admin
    assert.equal((await t.call('PUT', `/api/products/${t.milanesa}/price`, { priceCents: 5 }, mozoTk)).status, 403);
    const adminTk = await login(t.admin, '1111');
    assert.equal((await t.call('PUT', `/api/products/${t.milanesa}/price`, { priceCents: 11000 }, adminTk)).status, 200);
    const menu2 = await t.call('GET', `/api/public/menu/${t.table.qr_token}`);
    assert.equal(find(menu2).price_cents, 11000);

    const page = await fetch(`${t.base}/m/${t.table.qr_token}`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<title>Carta<\/title>/);
  } finally {
    t.server.close();
  }
});

test('API: pedidos del QR tienen límite de frecuencia', async () => {
  const t = await start();
  try {
    let last;
    for (let i = 0; i < 14; i++) {
      last = await t.call('POST', `/api/public/order/${t.table.qr_token}`, { items: [{ productId: t.gaseosa, qty: 1 }] });
    }
    assert.equal(last.status, 429);
  } finally {
    t.server.close();
  }
});
