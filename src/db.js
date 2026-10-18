import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

// Capa fina sobre SQLite. Los servicios solo usan run/get/all/tx, así que el
// adaptador a Postgres externo puede implementar la misma interfaz.
export function openDb(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  raw.exec(SCHEMA);

  let depth = 0;
  return {
    run: (sql, ...p) => raw.prepare(sql).run(...p),
    get: (sql, ...p) => raw.prepare(sql).get(...p),
    all: (sql, ...p) => raw.prepare(sql).all(...p),
    tx(fn) {
      if (depth > 0) return fn(); // anidada: participa de la transacción externa
      raw.exec('BEGIN IMMEDIATE');
      depth++;
      try {
        const out = fn();
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
    close: () => raw.close(),
  };
}
