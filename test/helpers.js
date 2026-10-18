import { openDb } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { createContext } from '../src/services/common.js';
import { createUser, login } from '../src/services/auth.js';
import { createCategory, createProduct } from '../src/services/catalog.js';
import { createTable } from '../src/services/tables.js';
import { ensureRegister } from '../src/services/cash.js';

export function setup(configOverrides = {}) {
  const config = loadConfig({ qrRequiresConfirmation: true, registerId: 'PB', ...configOverrides });
  const ctx = createContext({ db: openDb(':memory:'), config });
  const mk = (name, role, pin) => {
    const id = createUser(ctx, { name, role, pin });
    return login(ctx, id, pin).user;
  };
  const admin = mk('Ana', 'admin', '1111');
  const cajero = mk('Caro', 'cajero', '2222');
  const mozo = mk('Mati', 'mozo', '3333');
  const cocina = mk('Coco', 'cocina', '4444');
  ensureRegister(ctx, 'PB', 'Planta baja');
  ensureRegister(ctx, 'P1', 'Primer piso');
  const cat = createCategory(ctx, { name: 'Platos' }, admin);
  const milanesa = createProduct(ctx, { categoryId: cat, name: 'Milanesa', priceCents: 10000 }, admin);
  const gaseosa = createProduct(ctx, { categoryId: cat, name: 'Gaseosa', priceCents: 3000, station: 'barra' }, admin);
  const tableId = createTable(ctx, { sector: 'PB', number: '1' }, admin);
  const table = ctx.db.get('SELECT * FROM dining_table WHERE id = ?', tableId);
  return { ctx, admin, cajero, mozo, cocina, cat, milanesa, gaseosa, tableId, table };
}
