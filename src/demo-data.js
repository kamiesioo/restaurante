import { createUser, login } from './services/auth.js';
import { createCategory, createProduct } from './services/catalog.js';
import { createTable } from './services/tables.js';
import { ensureRegister } from './services/cash.js';

// Datos de prueba. Los PIN son públicos a propósito: NO usar en producción.
export const DEMO_USERS = [
  { name: 'Admin', role: 'admin', pin: '1111' },
  { name: 'Cajero', role: 'cajero', pin: '2222' },
  { name: 'Mozo', role: 'mozo', pin: '3333' },
  { name: 'Cocina', role: 'cocina', pin: '4444' },
];

export function seedDemo(ctx) {
  let admin;
  for (const u of DEMO_USERS) {
    const id = createUser(ctx, u);
    if (u.role === 'admin') admin = login(ctx, id, u.pin).user;
  }
  ensureRegister(ctx, 'PB', 'Caja planta baja');
  ensureRegister(ctx, 'P1', 'Caja primer piso');
  const platos = createCategory(ctx, { name: 'Platos', position: 1 }, admin);
  const bebidas = createCategory(ctx, { name: 'Bebidas', position: 2 }, admin);
  const postres = createCategory(ctx, { name: 'Postres', position: 3 }, admin);
  const prod = (categoryId, name, pesos, station = 'cocina') =>
    createProduct(ctx, { categoryId, name, priceCents: pesos * 100, station }, admin);
  prod(platos, 'Milanesa con papas', 12000);
  prod(platos, 'Ñoquis con salsa', 9500);
  prod(platos, 'Ensalada mixta', 6000);
  prod(bebidas, 'Gaseosa', 3000, 'barra');
  prod(bebidas, 'Agua mineral', 2500, 'barra');
  prod(bebidas, 'Cerveza', 4500, 'barra');
  prod(postres, 'Flan con dulce de leche', 4000);
  for (let n = 1; n <= 4; n++) createTable(ctx, { sector: 'PB', number: String(n) }, admin);
  for (let n = 1; n <= 3; n++) createTable(ctx, { sector: 'P1', number: String(n) }, admin);
}
