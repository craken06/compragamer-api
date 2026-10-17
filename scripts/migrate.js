/*
 * Migraciones manuales (prisma/manual-migrations/*.sql) + datos iniciales de las reglas.
 *
 *   node scripts/migrate.js            -> simulación: muestra qué tablas faltan y qué se sembraría
 *   node scripts/migrate.js --apply    -> crea lo que falta (todo en una transacción)
 *
 * Sólo crea (IF NOT EXISTS) e inserta reglas si la tabla está vacía: no borra ni pisa datos.
 * Las reglas por defecto salen de src/compatibility/engine.ts (DEFAULT_RULES / DEFAULT_PARAMS).
 */
const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true });
const { PrismaClient } = require('@prisma/client');
const { DEFAULT_RULES, DEFAULT_PARAMS } = require('../src/compatibility/engine');
const { generateOrderCode } = require('../src/orders/order-code');

const APPLY = process.argv.includes('--apply');
const DIR = path.join(__dirname, '..', 'prisma', 'manual-migrations');
const NEW_TABLES = ['compatibility_rules', 'orders', 'order_items', 'contact_messages', 'customers', 'customer_identities'];

// Campos que se suman al spec_schema de "proteccion" para que el motor pueda validar las DC.
const PROTECCION_PROPS = {
  lado: { type: 'string', enum: ['dc', 'ac'], label: 'Lado de la instalación' },
  tension_max_v: { type: 'number', unit: 'V', label: 'Tensión máxima de servicio' },
  corriente_nominal_a: { type: 'number', unit: 'A', label: 'Corriente nominal' },
};

/** Separa un .sql en sentencias respetando los bloques $$ ... $$. */
function splitSql(sql) {
  const out = [];
  let cur = '', inDollar = false;
  for (const line of sql.split(/\r?\n/)) {
    if (/^\s*--/.test(line) && !inDollar) continue;
    cur += line + '\n';
    const dollars = (line.match(/\$\$/g) || []).length;
    if (dollars % 2 === 1) inDollar = !inDollar;
    if (!inDollar && /;\s*$/.test(line)) { out.push(cur.trim()); cur = ''; }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function seedRows() {
  const params = Object.entries(DEFAULT_PARAMS).map(([k, v]) => ({
    sourceCategory: '_param', targetCategory: '-', checkKey: k, priority: 0,
    condition: { op: '>', value: v }, resultType: 'param', message: '', active: true,
  }));
  const rules = DEFAULT_RULES.map((r) => ({
    sourceCategory: r.sourceCategory, targetCategory: r.targetCategory, checkKey: r.checkKey,
    priority: r.priority, condition: r.condition, resultType: r.resultType, message: r.message, active: true,
  }));
  return [...params, ...rules];
}

async function main() {
  const prisma = new PrismaClient();
  console.log(APPLY ? '*** MODO APPLY: se escribe en la base ***\n' : '--- Simulación (sin --apply no se escribe nada) ---\n');

  const existing = (await prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`).map((r) => r.table_name);
  const missing = NEW_TABLES.filter((t) => !existing.includes(t));
  console.log(`Tablas nuevas que faltan: ${missing.length ? missing.join(', ') : 'ninguna'}`);

  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  const statements = files.flatMap((f) => splitSql(fs.readFileSync(path.join(DIR, f), 'utf8')).map((s) => ({ f, s })));
  console.log(`Sentencias a ejecutar (${files.join(', ')}): ${statements.length} (todas idempotentes)`);

  const rulesTableExists = existing.includes('compatibility_rules');
  const ruleCount = rulesTableExists ? Number((await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM compatibility_rules`)[0].n) : 0;
  const seed = seedRows();
  console.log(ruleCount ? `compatibility_rules ya tiene ${ruleCount} filas: no se siembra nada` : `Se sembrarían ${seed.length} filas en compatibility_rules (${seed.filter((r) => r.resultType === 'param').length} parámetros + ${seed.filter((r) => r.resultType !== 'param').length} reglas)`);

  const prot = await prisma.category.findUnique({ where: { slug: 'proteccion' } });
  const protProps = prot?.specSchema?.properties || {};
  const newProtProps = Object.fromEntries(Object.entries(PROTECCION_PROPS).filter(([k]) => !protProps[k]));
  console.log(`spec_schema de proteccion: ${Object.keys(newProtProps).length ? 'se agregan ' + Object.keys(newProtProps).join(', ') : 'sin cambios'}`);

  // Pedidos sin código: si la columna todavía no existe (simulación antes de aplicar), son todos.
  const hasCodeCol = (await prisma.$queryRaw`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'code'`).length > 0;
  const ordersExist = existing.includes('orders');
  const noCode = !ordersExist ? 0
    : hasCodeCol ? Number((await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM orders WHERE code IS NULL`)[0].n)
    : Number((await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM orders`)[0].n);
  console.log(`Pedidos sin código: ${noCode}`);

  if (!APPLY) { await prisma.$disconnect(); return; }

  await prisma.$transaction(async (tx) => {
    for (const { s } of statements) await tx.$executeRawUnsafe(s);
    // Códigos AX- para los pedidos que no tienen; recién después la columna pasa a NOT NULL.
    // (un choque abortaría la transacción en Postgres, así que se evita de antemano con un Set)
    const usados = new Set((await tx.$queryRaw`SELECT code FROM orders WHERE code IS NOT NULL`).map((r) => r.code));
    const sinCodigo = await tx.$queryRaw`SELECT id FROM orders WHERE code IS NULL`;
    for (const { id } of sinCodigo) {
      let code;
      do { code = generateOrderCode(); } while (usados.has(code));
      usados.add(code);
      await tx.$executeRaw`UPDATE orders SET code = ${code} WHERE id = ${id}`;
    }
    await tx.$executeRawUnsafe('ALTER TABLE orders ALTER COLUMN code SET NOT NULL');
    if (!ruleCount) await tx.compatibilityRule.createMany({ data: seed });
    if (prot && Object.keys(newProtProps).length) {
      await tx.category.update({ where: { id: prot.id }, data: { specSchema: { ...prot.specSchema, properties: { ...protProps, ...newProtProps } } } });
    }
  }, { timeout: 60000, maxWait: 10000 }); // Neon + el relleno pedido por pedido pueden pasar los 5 s por defecto
  console.log('\nListo.');
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
