// Arranque "portable" para pruebas: datos de demo, ARCA simulado, IP local para los QR.
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createContext } from '../src/services/common.js';
import { createApp } from '../src/server.js';
import { seedDemo, DEMO_USERS } from './demo-data.js';

const port = Number(process.env.PORT || 3000);
const lan = Object.values(networkInterfaces()).flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;

const config = loadConfig({
  machineId: process.env.MACHINE_ID || 'demo-pc',
  registerId: process.env.REGISTER_ID || 'PB',
  port,
  dbPath: process.env.DB_PATH || 'datos/demo.db',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://${lan ?? 'localhost'}:${port}`,
  arca: { mode: process.env.ARCA_MODE || 'mock', cuit: '', ptoVta: 1, issuerCondition: 'RI', identifyAboveCents: 0 },
});
const ctx = createContext({ db: openDb(config.dbPath), config });

if (!ctx.db.get('SELECT 1 FROM user')) {
  seedDemo(ctx);
  console.log('Se cargaron datos de demostración.');
}

createServer(createApp(ctx)).listen(config.port, '0.0.0.0', () => {
  console.log(`
 ================================================================
  RESTAURANTE - MODO PRUEBA  (máquina "${config.machineId}", caja ${config.registerId})
 ================================================================
  Panel (staff):  http://localhost:${port}/
  Cocina/salón:   http://localhost:${port}/cocina
  Desde el celular (misma Wi-Fi): ${config.publicBaseUrl}/m/<token de la mesa>
     (los links de cada mesa están en Panel > Admin > QR por mesa)

  Usuarios de prueba:  ${DEMO_USERS.map((u) => `${u.name} ${u.pin}`).join('  |  ')}
  Facturación ARCA: ${config.arca.mode === 'mock' ? 'SIMULADA (CAE falsos, sin validez fiscal)' : config.arca.mode}
  Datos guardados en: ${config.dbPath}
  Para cerrar: Ctrl+C o cerrar esta ventana.
 ================================================================
`);
});
