-- Cuentas de clientes, datos de entrega y código de pedido (idempotente).
-- Coincide con prisma/schema.prisma. Se aplica con: node scripts/migrate.js --apply
-- orders.code queda NULL acá: scripts/migrate.js completa los pedidos existentes y recién ahí lo vuelve NOT NULL.

DO $$ BEGIN
  CREATE TYPE fulfillment_status_enum AS ENUM ('pendiente', 'preparando', 'enviado', 'listo_para_retirar', 'entregado');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS customers (
  id              SERIAL PRIMARY KEY,
  email           TEXT          NOT NULL UNIQUE,
  name            TEXT          NOT NULL,
  avatar_url      TEXT,
  phone           TEXT,
  default_address JSONB,
  billing_doc     TEXT,
  billing_name    TEXT,
  blocked         BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at   TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_identities (
  id          SERIAL PRIMARY KEY,
  customer_id INTEGER       NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  provider    TEXT          NOT NULL,
  subject     TEXT          NOT NULL,
  email       TEXT          NOT NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, subject)
);
CREATE INDEX IF NOT EXISTS customer_identities_customer_idx ON customer_identities (customer_id);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS code               TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id        INTEGER REFERENCES customers (id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_method    TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address   JSONB;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_doc        TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_name       TEXT;
-- Sólo la primera vez (cuando la columna todavía no existe): los pedidos ya pagados antes de esta
-- función se marcan como entregados para que no inunden "Para preparar". Corridas siguientes: no hace nada.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'fulfillment_status'
  ) THEN
    ALTER TABLE orders ADD COLUMN fulfillment_status fulfillment_status_enum NOT NULL DEFAULT 'pendiente';
    UPDATE orders SET fulfillment_status = 'entregado' WHERE status::text = 'pagado';
  END IF;
END $$;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number    TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_url        TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS orders_code_key ON orders (code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders (customer_id);
