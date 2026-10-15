/*
 * Destraba el configurador (AURYX_FALTANTES.md, orden sugerido 1 y 2):
 *   1. Completa en los inversores reales los campos que usa el motor de
 *      compatibilidad (maxPvVoltage, mpptRange*, mpptCount, maxPvPower,
 *      maxInputCurrentPerMppt, ratedPowerAC, systemTypes, batteryVoltage*).
 *      También corrige vmpp_min/vmpp_max cuando no coinciden con el datasheet.
 *   2. Crea las categorías `regulador` y `cable` si no existen.
 *
 * Por defecto NO escribe nada: muestra el diff. Para aplicar:
 *   node scripts/backfill-inversores-y-categorias.js --apply
 *
 * Sólo agrega/actualiza claves dentro de specs (merge); no borra productos,
 * claves ni categorías existentes. Es idempotente.
 *
 * Criterio para inversores con dos MPPT asimétricos (p. ej. 22 A / 12 A):
 * el motor usa un único maxInputCurrentPerMppt, así que se carga el menor
 * (conservador: puede rechazar un string que entraría en el MPPT grande,
 * nunca aprueba uno que no entra).
 */
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');

// Valores de datasheet por SKU. `verificar` lista los campos que no se
// pudieron confirmar contra el datasheet oficial del fabricante.
const INVERSORES = {
  'HUA-SUN2000-5KTL-L1': {
    specs: {
      maxPvVoltage: 600, mpptRangeMin: 90, mpptRangeMax: 560, mpptCount: 2,
      maxInputCurrentPerMppt: 12.5, maxPvPower: 7500, ratedPowerAC: 5000,
      maxShortCircuitCurrentPerMppt: 18,
      batteryVoltageMin: 350, batteryVoltageMax: 560, // LUNA2000 (alta tensión)
      systemTypes: ['ongrid', 'hybrid'],
      vmpp_min: 90, vmpp_max: 560,
    },
    verificar: ['maxShortCircuitCurrentPerMppt', 'batteryVoltageMin', 'batteryVoltageMax'],
  },
  'HUA-SUN2000-10KTL-M1': {
    specs: {
      maxPvVoltage: 1100, mpptRangeMin: 140, mpptRangeMax: 980, mpptCount: 2,
      maxInputCurrentPerMppt: 11, // versión estándar (11 A / 15 A); la "High Current" es 13.5 A / 19.5 A
      maxPvPower: 15000, ratedPowerAC: 10000,
      maxShortCircuitCurrentPerMppt: 15,
      batteryVoltageMin: 600, batteryVoltageMax: 980, // LUNA2000 (alta tensión)
      systemTypes: ['ongrid', 'hybrid'],
      vmpp_min: 140, vmpp_max: 980,
    },
    verificar: ['batteryVoltageMin', 'batteryVoltageMax'],
  },
  'SUNGROW-SG5RS': {
    specs: {
      maxPvVoltage: 600, mpptRangeMin: 40, mpptRangeMax: 560, mpptCount: 2,
      maxInputCurrentPerMppt: 16, maxPvPower: 7500, ratedPowerAC: 5000,
      maxShortCircuitCurrentPerMppt: 20,
      systemTypes: ['ongrid'],
    },
    verificar: [],
  },
  'SUNGROW-SG10RT': {
    specs: {
      maxPvVoltage: 1100, mpptRangeMin: 160, mpptRangeMax: 1000, mpptCount: 2,
      maxInputCurrentPerMppt: 12.5, // 25 A / 12.5 A
      maxPvPower: 15000, ratedPowerAC: 10000,
      maxShortCircuitCurrentPerMppt: 18,
      systemTypes: ['ongrid'],
      vmpp_min: 160,
    },
    verificar: [],
  },
  'FRONIUS-GEN24-5': {
    specs: {
      maxPvVoltage: 600, mpptRangeMin: 65, mpptRangeMax: 530, mpptCount: 2,
      maxInputCurrentPerMppt: 12, // 22 A / 12 A
      maxPvPower: 7500, ratedPowerAC: 5000,
      maxShortCircuitCurrentPerMppt: 22,
      batteryVoltageMin: 150, batteryVoltageMax: 455, // baterías HV (BYD HVS/HVM)
      systemTypes: ['ongrid', 'hybrid'],
      vmpp_min: 65, vmpp_max: 530,
    },
    verificar: ['batteryVoltageMin', 'batteryVoltageMax'],
  },
  'FRONIUS-SYMO-GEN24-10': {
    specs: {
      maxPvVoltage: 1000, mpptRangeMin: 80, mpptRangeMax: 800, mpptCount: 2,
      maxInputCurrentPerMppt: 12.5, // 25 A / 12.5 A
      maxPvPower: 15000, ratedPowerAC: 10000,
      maxShortCircuitCurrentPerMppt: 20,
      batteryVoltageMin: 150, batteryVoltageMax: 455, // baterías HV (BYD HVS/HVM)
      systemTypes: ['ongrid', 'hybrid'],
      vmpp_max: 800,
    },
    verificar: ['batteryVoltageMin', 'batteryVoltageMax'],
  },
  'SMA-SB5-0': {
    specs: {
      maxPvVoltage: 600, mpptRangeMin: 175, mpptRangeMax: 500, mpptCount: 2,
      maxInputCurrentPerMppt: 15, maxPvPower: 7500, ratedPowerAC: 5000,
      maxShortCircuitCurrentPerMppt: 20,
      systemTypes: ['ongrid'],
      vmpp_min: 175, vmpp_max: 500,
    },
    verificar: [],
  },
  'SMA-STP10-SE': {
    specs: {
      maxPvVoltage: 1000, mpptRangeMin: 280, mpptRangeMax: 800, mpptCount: 2,
      maxInputCurrentPerMppt: 12.5, // 12.5 A / 25 A
      maxPvPower: 15000, ratedPowerAC: 10000,
      maxShortCircuitCurrentPerMppt: 20,
      batteryVoltageMin: 150, batteryVoltageMax: 600,
      systemTypes: ['ongrid', 'hybrid'],
      vmpp_min: 280, vmpp_max: 800,
    },
    verificar: [],
  },
  'GROWATT-MOD-5K': {
    specs: {
      maxPvVoltage: 1100, mpptRangeMin: 140, mpptRangeMax: 1000, mpptCount: 2,
      maxInputCurrentPerMppt: 13, maxPvPower: 7500, ratedPowerAC: 5000,
      maxShortCircuitCurrentPerMppt: 16,
      systemTypes: ['ongrid'],
    },
    verificar: [],
  },
  'GROWATT-SPH-5K': {
    specs: {
      maxPvVoltage: 550, mpptRangeMin: 120, mpptRangeMax: 550, mpptCount: 2,
      maxInputCurrentPerMppt: 13.5, maxPvPower: 8600, ratedPowerAC: 5000,
      maxShortCircuitCurrentPerMppt: 16.5,
      batteryVoltageMin: 42, batteryVoltageMax: 59, // baja tensión (48 V)
      systemTypes: ['ongrid', 'hybrid'],
    },
    verificar: [],
  },
  'GOODWE-GW5000DNS': {
    specs: {
      maxPvVoltage: 600, mpptRangeMin: 80, mpptRangeMax: 550, mpptCount: 2,
      maxInputCurrentPerMppt: 11, maxPvPower: 6500, ratedPowerAC: 5000,
      maxShortCircuitCurrentPerMppt: 13.8,
      systemTypes: ['ongrid'],
    },
    verificar: [],
  },
  'GOODWE-GW10KDT': {
    specs: {
      maxPvVoltage: 1000, mpptRangeMin: 180, mpptRangeMax: 850, mpptCount: 2,
      maxInputCurrentPerMppt: 12.5, maxPvPower: 15000, ratedPowerAC: 10000,
      maxShortCircuitCurrentPerMppt: 15.6,
      systemTypes: ['ongrid'],
    },
    verificar: [],
  },
};

// Quedan fuera del configurador a propósito (systemTypes vacío): el motor
// actual dimensiona strings contra un MPPT y no aplica a estos equipos.
const EXCLUIDOS = {
  'VIC-MULTIPLUS2-48-5000': 'inversor/cargador sin entrada FV (necesita regulador MPPT aparte)',
  'SOLAREDGE-SE5000H': 'tensión fija con optimizadores; no se dimensiona como string común',
  'ENPHASE-IQ8MC': 'microinversor; pendiente lógica propia (FALTANTES 3)',
};

// Campos que se suman al spec_schema existente de `inversor` (sólo si faltan).
const PROPIEDADES_INVERSOR = {
  maxShortCircuitCurrentPerMppt: {
    type: 'number', unit: 'A',
    description: 'Corriente máxima de cortocircuito por MPPT (límite para la Isc del arreglo)',
  },
};

const CATEGORIAS_NUEVAS = [
  {
    slug: 'regulador',
    name: 'Regulador de carga',
    specSchema: {
      type: 'object',
      required: ['ratedChargeCurrent', 'maxPvVoltage', 'systemVoltageOptions', 'maxPvPowerBySystemVoltage'],
      properties: {
        tipo: { type: 'string', enum: ['MPPT', 'PWM'], label: 'Tipo de regulador' },
        ratedChargeCurrent: { type: 'number', unit: 'A', label: 'Corriente de carga nominal' },
        maxPvVoltage: { type: 'number', unit: 'V', label: 'Tensión FV máxima (Voc)' },
        systemVoltageOptions: { type: 'array', items: { type: 'integer', enum: [12, 24, 36, 48] }, label: 'Tensiones de batería admitidas' },
        maxPvPowerBySystemVoltage: {
          type: 'object', unit: 'W', label: 'Potencia FV máx. por tensión de batería',
          additionalProperties: { type: 'number' },
          description: 'Clave = tensión de batería (V), valor = potencia FV máxima (W). Ej: {"12": 520, "24": 1040}',
        },
        trackingEfficiency: { type: 'number', unit: '%', label: 'Eficiencia de seguimiento MPPT' },
        systemTypes: {
          type: 'array', items: { type: 'string', enum: ['ongrid', 'hybrid', 'offgrid'] },
          description: 'Tipos de sistema donde este regulador aparece como opción en el configurador',
        },
        ip: { type: 'string', enum: ['IP20', 'IP21', 'IP22', 'IP43', 'IP65', 'IP67'], label: 'Grado IP' },
        normas: { type: 'array', items: { type: 'string' }, label: 'Normas' },
      },
    },
  },
  {
    slug: 'cable',
    name: 'Cables y conectores',
    specSchema: {
      type: 'object',
      required: ['tipo'],
      properties: {
        tipo: { type: 'string', enum: ['cable_dc', 'cable_ac', 'conector'], label: 'Tipo' },
        norma_cable: { type: 'string', label: 'Designación (PV1-F, H1Z2Z2-K, MC4...)' },
        seccion_mm2: { type: 'number', unit: 'mm²', label: 'Sección' },
        tension_max_v: { type: 'number', unit: 'V', label: 'Tensión máxima' },
        corriente_max_a: { type: 'number', unit: 'A', label: 'Corriente máxima' },
        largo_m: { type: 'number', unit: 'm', label: 'Largo (rollo)' },
        resistencia_uv: { type: 'boolean', label: 'Resistente a UV' },
        ip: { type: 'string', enum: ['IP65', 'IP67', 'IP68'], label: 'Grado IP (conectores)' },
        normas: { type: 'array', items: { type: 'string' }, label: 'Normas (EN 50618, IEC 62930, IEC 62852...)' },
      },
    },
  },
];

function diffSpecs(actual, nuevos) {
  const cambios = [];
  for (const [k, v] of Object.entries(nuevos)) {
    if (JSON.stringify(actual[k]) !== JSON.stringify(v)) cambios.push({ k, antes: actual[k], despues: v });
  }
  return cambios;
}

async function main() {
  const prisma = new PrismaClient();
  console.log(APPLY ? '*** MODO APPLY: se escribe en la base ***\n' : '--- Simulación (sin --apply no se escribe nada) ---\n');

  const inversores = await prisma.product.findMany({
    where: { category: { slug: 'inversor' } },
    select: { id: true, sku: true, brand: true, name: true, specs: true },
  });
  const porSku = new Map(inversores.map((p) => [p.sku, p]));

  const faltan = Object.keys(INVERSORES).filter((sku) => !porSku.has(sku));
  if (faltan.length) console.log(`AVISO: SKUs del script que no están en la base: ${faltan.join(', ')}\n`);

  let actualizados = 0;
  for (const [sku, { specs, verificar }] of Object.entries(INVERSORES)) {
    const prod = porSku.get(sku);
    if (!prod) continue;
    const cambios = diffSpecs(prod.specs || {}, specs);
    console.log(`#${prod.id} ${prod.brand} ${prod.name} (${sku})`);
    if (!cambios.length) { console.log('   sin cambios\n'); continue; }
    for (const c of cambios) {
      const marca = verificar.includes(c.k) ? '  [verificar]' : '';
      console.log(`   ${c.k}: ${JSON.stringify(c.antes)} -> ${JSON.stringify(c.despues)}${marca}`);
    }
    console.log('');
    if (APPLY) {
      await prisma.product.update({ where: { id: prod.id }, data: { specs: { ...prod.specs, ...specs } } });
    }
    actualizados++;
  }

  for (const [sku, motivo] of Object.entries(EXCLUIDOS)) {
    if (porSku.has(sku)) console.log(`Fuera del configurador: ${sku}: ${motivo}`);
  }
  const sinCubrir = inversores.filter((p) => !INVERSORES[p.sku] && !EXCLUIDOS[p.sku]);
  if (sinCubrir.length) console.log(`\nAVISO: inversores en la base sin datos en este script: ${sinCubrir.map((p) => p.sku).join(', ')}`);

  console.log('\n--- spec_schema de inversor ---');
  const catInversor = await prisma.category.findUnique({ where: { slug: 'inversor' } });
  const props = catInversor.specSchema?.properties || {};
  const nuevasProps = Object.fromEntries(Object.entries(PROPIEDADES_INVERSOR).filter(([k]) => !props[k]));
  if (!Object.keys(nuevasProps).length) console.log('sin cambios');
  else {
    console.log(`se agregan: ${Object.keys(nuevasProps).join(', ')}`);
    if (APPLY) {
      await prisma.category.update({
        where: { id: catInversor.id },
        data: { specSchema: { ...catInversor.specSchema, properties: { ...props, ...nuevasProps } } },
      });
    }
  }

  console.log('\n--- Categorías ---');
  for (const cat of CATEGORIAS_NUEVAS) {
    const existe = await prisma.category.findUnique({ where: { slug: cat.slug } });
    if (existe) { console.log(`${cat.slug}: ya existe (id ${existe.id}), no se toca`); continue; }
    console.log(`${cat.slug}: se crea "${cat.name}" con ${Object.keys(cat.specSchema.properties).length} campos en spec_schema`);
    if (APPLY) await prisma.category.create({ data: cat });
  }

  console.log(`\n${APPLY ? 'Aplicado' : 'Se aplicarían'}: ${actualizados} inversores.`);
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
