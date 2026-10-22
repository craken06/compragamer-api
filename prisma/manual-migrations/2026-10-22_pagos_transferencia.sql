-- Medio de pago de cada pedido y datos de la transferencia bancaria (idempotente).
-- Coincide con prisma/schema.prisma (enum PaymentMethod y Order.paymentMethod/transferDeadline/receipt*/paidAt).
-- Se aplica con: node scripts/migrate.js --apply
-- Los pedidos existentes quedan como Mercado Pago (DEFAULT): no cambia nada de lo que ya hay.

DO $$ BEGIN
  CREATE TYPE payment_method_enum AS ENUM ('mercadopago', 'transferencia');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method payment_method_enum NOT NULL DEFAULT 'mercadopago';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS transfer_deadline TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS receipt_key TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS receipt_uploaded_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
