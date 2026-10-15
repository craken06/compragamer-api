/*
 * Completa datos que necesitan el motor de compatibilidad y la tienda (AURYX_FALTANTES.md):
 *   - Baterías: nominalVoltage y maxContinuousCurrent (antes no estaban: el configurador
 *     no podía validarlas).
 *   - Paneles: tech (tecnología de celda) para el filtro "Tecnología" de la tienda.
 *   - Microinversor Enphase IQ8MC: campos del motor (entra al configurador con su lógica propia).
 *   - spec_schema de bateria y panel: se agregan esas claves.
 *
 * Por defecto NO escribe nada. Para aplicar:  node scripts/backfill-baterias-paneles-micro.js --apply
 * Merge sobre specs (no borra claves), idempotente. Cada fila valida que el nombre coincida
 * con el id antes de escribir.
 */
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');

// id: [texto que tiene que estar en el nombre, specs, campos a verificar]
const DATOS = {
  // --- Baterías: tensión nominal (V) y corriente continua máx. de descarga (A) ---
  41: ['US5000', { nominalVoltage: 48, maxContinuousCurrent: 100 }, ['maxContinuousCurrent']],
  40: ['US3000C', { nominalVoltage: 48, maxContinuousCurrent: 37 }, ['maxContinuousCurrent']],
  39: ['US2000C', { nominalVoltage: 48, maxContinuousCurrent: 25 }, ['maxContinuousCurrent']],
  42: ['A48100', { nominalVoltage: 48, maxContinuousCurrent: 75 }, []],
  43: ['B4850', { nominalVoltage: 48, maxContinuousCurrent: 50 }, []],
  44: ['LVS 4.0', { nominalVoltage: 51.2, maxContinuousCurrent: 65 }, []],
  45: ['LVS 8.0', { nominalVoltage: 51.2, maxContinuousCurrent: 130 }, []],
  46: ['12.8V 200Ah', { nominalVoltage: 12.8, maxContinuousCurrent: 200 }, []],
  47: ['25.6V 200Ah', { nominalVoltage: 25.6, maxContinuousCurrent: 200 }, ['maxContinuousCurrent']],
  // RESU10H Prime: alta tensión (350-450 V); 14,3 A a 350 V = 5 kW continuos según la hoja de datos
  48: ['RESU10H', { nominalVoltage: 350, maxContinuousCurrent: 14.3 }, []],
  49: ['ARK', { nominalVoltage: 51.2, maxContinuousCurrent: 25 }, ['maxContinuousCurrent']],
  50: ['SBR096', { nominalVoltage: 192, maxContinuousCurrent: 30 }, ['nominalVoltage']],
  51: ['SBR128', { nominalVoltage: 256, maxContinuousCurrent: 30 }, ['nominalVoltage']],
  52: ['Smile5', { nominalVoltage: 48, maxContinuousCurrent: 100 }, []],
  53: ['48V 100Ah', { nominalVoltage: 51.2, maxContinuousCurrent: 100 }, []],

  // --- Paneles: tecnología de celda ---
  9: ['Tiger Neo', { tech: 'N-type TOPCon' }, []],
  10: ['Tiger Neo', { tech: 'N-type TOPCon' }, []],
  11: ['DeepBlue 3.0', { tech: 'Mono PERC' }, []],
  12: ['DeepBlue 4.0', { tech: 'N-type TOPCon' }, []],
  13: ['Hi-MO 5', { tech: 'Mono PERC' }, []],
  14: ['Hi-MO 6', { tech: 'HPBC (back contact)' }, []],
  15: ['TSM-DE18', { tech: 'Mono PERC' }, []],
  16: ['NEG9R', { tech: 'N-type TOPCon' }, []],
  17: ['CS6W', { tech: 'Mono PERC' }, []],
  18: ['TOPHiKu6', { tech: 'N-type TOPCon' }, []],
  19: ['Q.PEAK DUO', { tech: 'Mono PERC' }, []],
  21: ['ASTRO N5', { tech: 'N-type TOPCon' }, []],
  22: ['Maxeon 6', { tech: 'IBC (back contact)' }, []],
  23: ['TWMND', { tech: 'N-type TOPCon' }, ['tech']],
  // 20 (Risen Titan 700 W): sin dato confiable de tecnología, se deja vacío.

  // --- Microinversor Enphase IQ8MC (hoja de datos IQ8MC-72-M-US) ---
  38: ['IQ8MC', {
    maxPvVoltage: 60, mpptRangeMin: 25, mpptRangeMax: 45, mpptCount: 1,
    maxInputCurrentPerMppt: 14, maxShortCircuitCurrentPerMppt: 20, // 20 A = Isc máx. del módulo admitido
    maxPvPower: 460, // límite superior de los módulos "comúnmente usados": por encima, ⚠ recorte
    ratedPowerAC: 330, systemTypes: ['ongrid'], vmpp_min: 25, vmpp_max: 45,
  }, ['maxPvVoltage']], // la versión INT figura en revendedores con 49 V
};

const SCHEMA_PROPS = {
  bateria: {
    nominalVoltage: { type: 'number', unit: 'V', label: 'Tensión nominal' },
    maxContinuousCurrent: { type: 'number', unit: 'A', label: 'Corriente continua máx. de descarga' },
  },
  panel: {
    tech: { type: 'string', label: 'Tecnología de celda (Mono PERC, N-type TOPCon, HJT, back contact...)' },
  },
};

async function main() {
  const prisma = new PrismaClient();
  console.log(APPLY ? '*** MODO APPLY: se escribe en la base ***\n' : '--- Simulación (sin --apply no se escribe nada) ---\n');
  const ids = Object.keys(DATOS).map(Number);
  const rows = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, brand: true, name: true, specs: true } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  let n = 0;
  for (const id of ids) {
    const [expected, specs, verificar] = DATOS[id];
    const p = byId.get(id);
    if (!p) { console.log(`#${id}: NO EXISTE, se saltea`); continue; }
    if (!p.name.includes(expected)) { console.log(`#${id} "${p.name}": no contiene "${expected}", se saltea por seguridad`); continue; }
    const cambios = Object.entries(specs).filter(([k, v]) => JSON.stringify(p.specs?.[k]) !== JSON.stringify(v));
    if (!cambios.length) { console.log(`#${id} ${p.brand} ${p.name}: sin cambios`); continue; }
    console.log(`#${id} ${p.brand} ${p.name}`);
    for (const [k, v] of cambios) console.log(`   ${k}: ${JSON.stringify(p.specs?.[k])} -> ${JSON.stringify(v)}${verificar.includes(k) ? '  [verificar]' : ''}`);
    if (APPLY) await prisma.product.update({ where: { id }, data: { specs: { ...p.specs, ...specs } } });
    n++;
  }

  console.log('\n--- spec_schema ---');
  for (const [slug, props] of Object.entries(SCHEMA_PROPS)) {
    const cat = await prisma.category.findUnique({ where: { slug } });
    const cur = cat?.specSchema?.properties || {};
    const nuevos = Object.fromEntries(Object.entries(props).filter(([k]) => !cur[k]));
    if (!Object.keys(nuevos).length) { console.log(`${slug}: sin cambios`); continue; }
    console.log(`${slug}: se agregan ${Object.keys(nuevos).join(', ')}`);
    if (APPLY) await prisma.category.update({ where: { id: cat.id }, data: { specSchema: { ...cat.specSchema, properties: { ...cur, ...nuevos } } } });
  }
  console.log(`\n${APPLY ? 'Aplicado' : 'Se aplicarían'}: ${n} productos.`);
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
