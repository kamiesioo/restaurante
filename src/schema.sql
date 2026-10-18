CREATE TABLE IF NOT EXISTS user (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','cajero','mozo','cocina')),
  pin_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_session (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES user(id),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS category (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS product (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES category(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  iva_rate REAL NOT NULL DEFAULT 21,
  station TEXT NOT NULL DEFAULT 'cocina' CHECK (station IN ('cocina','barra')),
  available INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES product(id),
  old_cents INTEGER NOT NULL,
  new_cents INTEGER NOT NULL,
  changed_by INTEGER REFERENCES user(id),
  changed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dining_table (
  id INTEGER PRIMARY KEY,
  sector TEXT NOT NULL,
  number TEXT NOT NULL,
  qr_token TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (sector, number)
);

CREATE TABLE IF NOT EXISTS customer_order (
  id INTEGER PRIMARY KEY,
  table_id INTEGER NOT NULL REFERENCES dining_table(id),
  status TEXT NOT NULL DEFAULT 'abierto'
    CHECK (status IN ('abierto','cuenta_pedida','cerrado','anulado')),
  opened_by INTEGER REFERENCES user(id),
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  closed_session_id INTEGER REFERENCES cash_session(id)
);
-- una sola cuenta abierta por mesa
CREATE UNIQUE INDEX IF NOT EXISTS one_open_order_per_table
  ON customer_order(table_id) WHERE status IN ('abierto','cuenta_pedida');

CREATE TABLE IF NOT EXISTS order_item (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES customer_order(id),
  product_id INTEGER NOT NULL REFERENCES product(id),
  name_snap TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  iva_rate REAL NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  notes TEXT NOT NULL DEFAULT '',
  station TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('qr','mozo')),
  status TEXT NOT NULL CHECK (status IN
    ('por_confirmar','enviado','en_preparacion','listo','entregado','cancelado')),
  cancel_reason TEXT,
  created_at TEXT NOT NULL,
  status_changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS item_by_order ON order_item(order_id);
CREATE INDEX IF NOT EXISTS item_by_status ON order_item(status, station);

CREATE TABLE IF NOT EXISTS cash_register (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cash_session (
  id INTEGER PRIMARY KEY,
  register_id TEXT NOT NULL REFERENCES cash_register(id),
  opened_by INTEGER NOT NULL REFERENCES user(id),
  opened_at TEXT NOT NULL,
  opening_cents INTEGER NOT NULL CHECK (opening_cents >= 0),
  closed_by INTEGER REFERENCES user(id),
  closed_at TEXT,
  counted_cents INTEGER,
  expected_cents INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_session_per_register
  ON cash_session(register_id) WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS cash_movement (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES cash_session(id),
  kind TEXT NOT NULL CHECK (kind IN ('ingreso','egreso')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  created_by INTEGER NOT NULL REFERENCES user(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payment (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES customer_order(id),
  session_id INTEGER NOT NULL REFERENCES cash_session(id),
  method TEXT NOT NULL CHECK (method IN
    ('efectivo','debito','credito','transferencia','qr')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_by INTEGER NOT NULL REFERENCES user(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL UNIQUE REFERENCES customer_order(id),
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','emitida','error')),
  tipo TEXT,
  pto_vta INTEGER,
  numero INTEGER,
  cae TEXT,
  cae_vto TEXT,
  receptor_doc_tipo TEXT,
  receptor_doc_nro TEXT,
  total_cents INTEGER NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  user_id INTEGER,
  machine_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  detail TEXT
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log es solo-inserción'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log es solo-inserción'); END;

-- Los pagos y las facturas emitidas tampoco se borran ni se editan.
CREATE TRIGGER IF NOT EXISTS payment_no_update BEFORE UPDATE ON payment
BEGIN SELECT RAISE(ABORT, 'payment es solo-inserción'); END;
CREATE TRIGGER IF NOT EXISTS payment_no_delete BEFORE DELETE ON payment
BEGIN SELECT RAISE(ABORT, 'payment es solo-inserción'); END;
CREATE TRIGGER IF NOT EXISTS invoice_no_delete BEFORE DELETE ON invoice
BEGIN SELECT RAISE(ABORT, 'invoice no se borra'); END;
CREATE TRIGGER IF NOT EXISTS invoice_emitted_immutable BEFORE UPDATE ON invoice
WHEN OLD.status = 'emitida'
BEGIN SELECT RAISE(ABORT, 'una factura emitida no se modifica'); END;
