import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createContext, AppError } from './services/common.js';
import { buildRoutes } from './routes.js';
import { userFromToken } from './services/auth.js';

const PAGES = {
  '/': 'panel.html',
  '/cocina': 'cocina.html',
  '/panel': 'panel.html',
};
const page = (name) => readFileSync(new URL(`./public/${name}`, import.meta.url));

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 100_000) { reject(new AppError('Cuerpo demasiado grande', 413)); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new AppError('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

// Límite simple de pedidos públicos por mesa (anti-abuso).
const hits = new Map();
export function rateLimit(key, max = 12, windowMs = 60_000) {
  const t = Date.now();
  const arr = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
  if (arr.length >= max) throw new AppError('Esperá un momento antes de volver a pedir', 429);
  arr.push(t);
  hits.set(key, arr);
}

export function createApp(ctx) {
  const routes = buildRoutes(ctx, { rateLimit });
  const sseClients = new Set();
  ctx.bus.on('change', (topic) => {
    for (const res of sseClients) res.write(`data: ${JSON.stringify({ topic })}\n\n`);
  });

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', ...SEC_HEADERS });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    try {
      if (req.method === 'GET' && url.pathname.startsWith('/m/')) return send(200, page('menu.html'), 'text/html');
      if (req.method === 'GET' && PAGES[url.pathname]) return send(200, page(PAGES[url.pathname]), 'text/html');

      const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '') || url.searchParams.get('token');
      if (req.method === 'GET' && url.pathname === '/api/stream') {
        if (!userFromToken(ctx, bearer)) throw new AppError('No autenticado', 401);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write('retry: 3000\n\n');
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }

      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.pattern.exec(url.pathname);
        if (!m) continue;
        const user = r.public ? null : userFromToken(ctx, bearer);
        if (!r.public && !user) throw new AppError('No autenticado', 401);
        const body = req.method === 'GET' ? {} : await readBody(req);
        const out = r.handler({ params: m.groups ?? {}, query: url.searchParams, body, user, token: bearer });
        return send(200, out ?? { ok: true });
      }
      send(404, { error: 'No encontrado' });
    } catch (e) {
      if (e instanceof AppError) return send(e.status, { error: e.message });
      console.error(e);
      send(500, { error: 'Error interno' });
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const ctx = createContext({ db: openDb(config.dbPath), config });
  createServer(createApp(ctx)).listen(config.port, config.host, () => {
    console.log(`[${config.machineId}] caja=${config.registerId ?? '-'} escuchando en ${config.host}:${config.port}`);
    console.log(`QR base: ${config.publicBaseUrl}/m/<token>`);
  });
}
