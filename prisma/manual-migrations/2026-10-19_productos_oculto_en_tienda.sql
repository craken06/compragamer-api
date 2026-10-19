-- Productos ocultos en la tienda que el dimensionador sigue usando (idempotente).
-- Coincide con prisma/schema.prisma (Product.showInStore). Se aplica con: node scripts/migrate.js --apply
-- Todos los productos existentes quedan visibles (DEFAULT TRUE): no cambia nada hasta que se oculte uno desde el admin.

ALTER TABLE products ADD COLUMN IF NOT EXISTS show_in_store BOOLEAN NOT NULL DEFAULT TRUE;
