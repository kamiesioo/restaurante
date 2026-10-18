// Arranque "portable" para pruebas: datos de demo, ARCA simulado, IP local para los QR.
import { startLocal } from '../src/launcher.js';
import { DEMO_USERS } from '../src/demo-data.js';

const { config, port } = await startLocal({
  port: Number(process.env.PORT || 3000),
  dbPath: process.env.DB_PATH || 'datos/demo.db',
  machineId: process.env.MACHINE_ID || 'demo-pc',
  registerId: process.env.REGISTER_ID || 'PB',
  arcaMode: process.env.ARCA_MODE || 'mock',
});

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
