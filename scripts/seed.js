// Datos iniciales para probar. Uso: ADMIN_PIN=1234 npm run seed
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createContext } from '../src/services/common.js';
import { createUser, login } from '../src/services/auth.js';
import { createCategory, createProduct } from '../src/services/catalog.js';
import { createTable } from '../src/services/tables.js';
import { ensureRegister } from '../src/services/cash.js';

const config = loadConfig();
const ctx = createContext({ db: openDb(config.dbPath), config });

if (ctx.db.get('SELECT 1 FROM user')) {
  console.log('La base ya tiene datos; no se hace nada.');
  process.exit(0);
}
const pin = process.env.ADMIN_PIN;
if (!pin) { console.error('Definí ADMIN_PIN (4 a 8 dígitos)'); process.exit(1); }

const adminId = createUser(ctx, { name: 'Admin', role: 'admin', pin });
const admin = login(ctx, adminId, pin).user;
ensureRegister(ctx, 'PB', 'Caja planta baja');
ensureRegister(ctx, 'P1', 'Caja primer piso');

const comidas = createCategory(ctx, { name: 'Platos', position: 1 }, admin);
const bebidas = createCategory(ctx, { name: 'Bebidas', position: 2 }, admin);
createProduct(ctx, { categoryId: comidas, name: 'Milanesa con papas', priceCents: 1_200_000 }, admin);
createProduct(ctx, { categoryId: comidas, name: 'Ensalada mixta', priceCents: 600_000 }, admin);
createProduct(ctx, { categoryId: bebidas, name: 'Gaseosa', priceCents: 300_000, station: 'barra' }, admin);
for (const n of [1, 2, 3]) createTable(ctx, { sector: 'PB', number: String(n) }, admin);
for (const n of [1, 2, 3]) createTable(ctx, { sector: 'P1', number: String(n) }, admin);
console.log('Listo. Usuario "Admin" creado con el PIN indicado, 2 cajas, carta y 6 mesas de ejemplo.');
