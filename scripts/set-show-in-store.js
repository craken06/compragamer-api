/*
 * Pone TODOS los productos en "solo dimensionador" (show_in_store = false) o de vuelta en la tienda.
 * No toca `active`: los desactivados siguen desactivados.
 *
 *   node scripts/set-show-in-store.js oculto            -> simulación: cuántos cambiarían
 *   node scripts/set-show-in-store.js oculto --apply    -> los saca de la tienda (el dimensionador los sigue usando)
 *   node scripts/set-show-in-store.js visible --apply   -> los vuelve a mostrar en la tienda
 */
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');
const MODE = process.argv[2];

async function main() {
  if (MODE !== 'oculto' && MODE !== 'visible') {
    console.error('Uso: node scripts/set-show-in-store.js oculto|visible [--apply]');
    process.exit(1);
  }
  const showInStore = MODE === 'visible';
  const prisma = new PrismaClient();
  console.log(APPLY ? '*** MODO APPLY: se escribe en la base ***\n' : '--- Simulación (sin --apply no se escribe nada) ---\n');

  const all = await prisma.product.findMany({ select: { id: true, active: true, showInStore: true } });
  const toChange = all.filter((p) => p.showInStore !== showInStore);
  const inactive = all.filter((p) => !p.active).length;
  console.log(`Productos: ${all.length} (${inactive} desactivados, siguen así)`);
  console.log(`Pasan a ${showInStore ? '"En la tienda"' : '"Solo dimensionador"'}: ${toChange.length}`);

  if (APPLY && toChange.length) {
    const r = await prisma.product.updateMany({ where: { id: { in: toChange.map((p) => p.id) } }, data: { showInStore } });
    console.log(`\nListo: ${r.count} actualizados.`);
  }
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
