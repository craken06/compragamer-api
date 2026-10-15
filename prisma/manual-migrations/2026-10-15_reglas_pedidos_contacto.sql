-- Tablas nuevas (sólo CREATE ... IF NOT EXISTS: no modifica ni borra nada existente).
-- Coinciden con los modelos de prisma/schema.prisma. Se aplica con: node scripts/migrate.js --apply

DO $$ BEGIN
  CREATE TYPE order_status_enum AS ENUM ('pendiente_pago', 'pagado', 'rechazado', 'cancelado', 'cotizacion');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS compatibility_rules (
  id              SERIAL PRIMARY KEY,
  source_category TEXT        NOT NULL,
  target_category TEXT        NOT NULL,
  check_key       TEXT        NOT NULL,
  priority        INTEGER     NOT NULL DEFAULT 100,
  condition       JSONB       NOT NULL,
  result_type     TEXT        NOT NULL,
  message         TEXT        NOT NULL DEFAULT '',
  active          BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS compatibility_rules_pair_idx ON compatibility_rules (source_category, target_category, priority);

CREATE TABLE IF NOT EXISTS orders (
  id               SERIAL PRIMARY KEY,
  public_id        TEXT              NOT NULL UNIQUE,
  status           order_status_enum NOT NULL DEFAULT 'pendiente_pago',
  customer_name    TEXT              NOT NULL,
  customer_email   TEXT              NOT NULL,
  customer_phone   TEXT,
  notes            TEXT,
  total_ars        DECIMAL(14, 2)    NOT NULL,
  usd_ars_rate     DECIMAL(12, 4)    NOT NULL,
  mp_preference_id TEXT,
  mp_payment_id    TEXT,
  mp_status        TEXT,
  created_at       TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
  id             SERIAL PRIMARY KEY,
  order_id       INTEGER        NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id     INTEGER        NOT NULL,
  product_name   TEXT           NOT NULL,
  quantity       INTEGER        NOT NULL,
  unit_price_ars DECIMAL(14, 2) NOT NULL
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);

CREATE TABLE IF NOT EXISTS contact_messages (
  id         SERIAL PRIMARY KEY,
  name       TEXT         NOT NULL,
  email      TEXT         NOT NULL,
  phone      TEXT,
  message    TEXT         NOT NULL,
  read       BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
