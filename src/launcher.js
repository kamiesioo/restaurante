import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createContext } from './services/common.js';
import { createApp } from './server.js';
import { seedDemo } from './demo-data.js';

export const lanAddress = () =>
  Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;

// Arranca el agente local (base + servidor HTTP). Si el puerto está ocupado prueba los siguientes.
export async function startLocal({
  port = 3000, dbPath, machineId = 'demo-pc', registerId = 'PB', arcaMode = 'mock', demo = true,
}) {
  for (let p = port; p < port + 20; p++) {
    const config = loadConfig({
      machineId, registerId, port: p, dbPath,
      publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://${lanAddress() ?? 'localhost'}:${p}`,
      arca: { mode: arcaMode, cuit: '', ptoVta: 1, issuerCondition: 'RI', identifyAboveCents: 0 },
    });
    const ctx = createContext({ db: openDb(dbPath), config });
    if (demo && !ctx.db.get('SELECT 1 FROM user')) seedDemo(ctx);
    const server = createServer(createApp(ctx));
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(p, '0.0.0.0', resolve);
      });
      return { server, ctx, config, port: p };
    } catch (e) {
      ctx.db.close();
      if (e.code !== 'EADDRINUSE') throw e;
    }
  }
  throw new Error(`No hay puertos libres desde el ${port}`);
}
