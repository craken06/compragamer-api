/*
 * Nombres de productos con el patrón "{Qué es} {Marca} {Tecnología} – {Línea o modelo} – {Dato clave}"
 * (como los de las tiendas de referencia: "Panel Solar Jinko N-Type TOPCon – Tiger Neo – 585 W").
 *
 *   node scripts/rename-products.js            -> simulación: muestra qué cambiaría
 *   node scripts/rename-products.js --apply    -> escribe (todo en una transacción)
 *
 * - Solo cambia un producto si su nombre actual es exactamente el esperado (OLD): si alguien ya lo
 *   editó, lo saltea y avisa.
 * - El nombre técnico de antes se guarda en specs.modelo (si no había uno): el sitio lo muestra en la
 *   ficha ("Modelo: …") y arma con él la dirección del producto, así las URLs no cambian.
 * - Tecnología, fase, tipo y capacidad salen de los datos cargados. "Bifacial Doble Vidrio" solo donde
 *   lo confirma la hoja de datos del fabricante (JA Solar JAM72D40 y Astronergy CHSM72N(DG)/F-BH).
 */
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');

// id: [nombre actual esperado, nombre nuevo]
const RENAMES = {
  // Paneles
  9: ['Tiger Neo 72HL4-V 585W', 'Panel Solar Jinko N-Type TOPCon – Tiger Neo – 585 W'],
  10: ['Tiger Neo 72HL4-V 600W', 'Panel Solar Jinko N-Type TOPCon – Tiger Neo – 600 W'],
  11: ['DeepBlue 3.0 JAM72S30 545W', 'Panel Solar JA Solar Monocristalino PERC – DeepBlue 3.0 – 545 W'],
  12: ['DeepBlue 4.0 Pro JAM72D40 590W', 'Panel Solar JA Solar N-Type TOPCon Bifacial Doble Vidrio – DeepBlue 4.0 Pro – 590 W'],
  13: ['Hi-MO 5 LR5-72HPH 550W', 'Panel Solar LONGi Monocristalino PERC – Hi-MO 5 – 550 W'],
  14: ['Hi-MO 6 LR5-54HTH 435W', 'Panel Solar LONGi Back Contact HPBC – Hi-MO 6 – 435 W'],
  15: ['Vertex TSM-DE18 550W', 'Panel Solar Trina Monocristalino PERC – Vertex – 550 W'],
  16: ['Vertex S+ TSM-NEG9R.28 440W', 'Panel Solar Trina N-Type TOPCon – Vertex S+ – 440 W'],
  17: ['HiKu6 CS6W-550MS', 'Panel Solar Canadian Solar Monocristalino PERC – HiKu6 – 550 W'],
  18: ['TOPHiKu6 CS6.1-72TD 590W', 'Panel Solar Canadian Solar N-Type TOPCon – TOPHiKu6 – 590 W'],
  19: ['Q.PEAK DUO ML-G11.3 480W', 'Panel Solar Qcells Monocristalino PERC – Q.PEAK DUO – 480 W'],
  20: ['Titan RSM132-8-700M', 'Panel Solar Risen – Titan – 700 W'],
  21: ['ASTRO N5 CHSM72N(DG)F-BH 580W', 'Panel Solar Astronergy N-Type TOPCon Bifacial Doble Vidrio – ASTRO N5 – 580 W'],
  22: ['Maxeon 6 440W', 'Panel Solar SunPower Back Contact IBC – Maxeon 6 – 440 W'],
  23: ['TWMND-72HD590 590W', 'Panel Solar TW Solar N-Type TOPCon – TWMND – 590 W'],
  // Inversores
  24: ['SUN2000-5KTL-L1', 'Inversor Híbrido Huawei Monofásico – SUN2000-5KTL-L1 – 5 kW'],
  25: ['SUN2000-10KTL-M1', 'Inversor Híbrido Huawei Trifásico – SUN2000-10KTL-M1 – 10 kW'],
  26: ['SG5.0RS', 'Inversor On-Grid Sungrow Monofásico – SG5.0RS – 5 kW'],
  27: ['SG10RT', 'Inversor On-Grid Sungrow Trifásico – SG10RT – 10 kW'],
  28: ['Primo GEN24 5.0 Plus', 'Inversor Híbrido Fronius Monofásico – Primo GEN24 5.0 Plus – 5 kW'],
  29: ['Symo GEN24 10.0 Plus', 'Inversor Híbrido Fronius Trifásico – Symo GEN24 10.0 Plus – 10 kW'],
  30: ['Sunny Boy 5.0', 'Inversor On-Grid SMA Monofásico – Sunny Boy 5.0 – 5 kW'],
  31: ['Sunny Tripower 10.0 Smart Energy', 'Inversor Híbrido SMA Trifásico – Sunny Tripower 10.0 Smart Energy – 10 kW'],
  32: ['MOD 5000TL3-X', 'Inversor On-Grid Growatt Trifásico – MOD 5000TL3-X – 5 kW'],
  33: ['SPH 5000TL BL-UP', 'Inversor Híbrido Growatt Monofásico – SPH 5000TL BL-UP – 5 kW'],
  34: ['GW5000D-NS', 'Inversor On-Grid GoodWe Monofásico – GW5000D-NS – 5 kW'],
  35: ['GW10KT-DT', 'Inversor On-Grid GoodWe Trifásico – GW10KT-DT – 10 kW'],
  36: ['MultiPlus-II 48/5000/70-50', 'Inversor-Cargador Victron Monofásico – MultiPlus-II 48/5000/70-50 – 4 kW'],
  37: ['SE5000H HD-Wave', 'Inversor On-Grid SolarEdge Monofásico – SE5000H HD-Wave – 5 kW'],
  38: ['IQ8MC Microinverter', 'Microinversor Enphase – IQ8MC – 330 W'],
  // Baterías
  39: ['US2000C', 'Batería de Litio Pylontech LiFePO4 48 V – US2000C – 2,4 kWh'],
  40: ['US3000C', 'Batería de Litio Pylontech LiFePO4 48 V – US3000C – 3,55 kWh'],
  41: ['US5000', 'Batería de Litio Pylontech LiFePO4 48 V – US5000 – 4,8 kWh'],
  42: ['A48100', 'Batería de Litio Dyness LiFePO4 48 V – A48100 – 4,8 kWh'],
  44: ['Battery-Box Premium LVS 4.0', 'Batería de Litio BYD LiFePO4 51,2 V – Battery-Box Premium LVS 4.0 – 4 kWh'],
  45: ['Battery-Box Premium LVS 8.0', 'Batería de Litio BYD LiFePO4 51,2 V – Battery-Box Premium LVS 8.0 – 8 kWh'],
  46: ['Lithium Smart 12.8V 200Ah', 'Batería de Litio Victron LiFePO4 12,8 V – Lithium Smart 200 Ah – 2,56 kWh'],
  47: ['Lithium NG 25.6V 200Ah', 'Batería de Litio Victron LiFePO4 25,6 V – Lithium NG 200 Ah – 5,12 kWh'],
  48: ['RESU10H Prime', 'Batería de Litio LG Alto Voltaje 350 V – RESU10H Prime – 9,6 kWh'],
  49: ['ARK LV 2.56L', 'Batería de Litio Growatt LiFePO4 51,2 V – ARK LV 2.56L – 2,56 kWh'],
  50: ['SBR096', 'Batería de Litio Sungrow LiFePO4 Alto Voltaje 192 V – SBR096 – 9,6 kWh'],
  51: ['SBR128', 'Batería de Litio Sungrow LiFePO4 Alto Voltaje 256 V – SBR128 – 12,8 kWh'],
  52: ['Smile5 ESS 10.1kWh', 'Batería de Litio AlphaESS LiFePO4 48 V – Smile5 ESS – 10,1 kWh'],
  53: ['48V 100Ah Server Rack Battery', 'Batería de Litio SOK LiFePO4 51,2 V – Server Rack 100 Ah – 5,12 kWh'],
};

async function main() {
  const prisma = new PrismaClient();
  console.log(APPLY ? '*** MODO APPLY: se escribe en la base ***\n' : '--- Simulación (sin --apply no se escribe nada) ---\n');
  const ids = Object.keys(RENAMES).map(Number);
  const rows = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, brand: true, name: true, specs: true } });
  const byId = new Map(rows.map((r) => [r.id, r]));

  const updates = [];
  const skipped = [];
  for (const id of ids) {
    const [oldName, newName] = RENAMES[id];
    const row = byId.get(id);
    if (!row) { skipped.push(`#${id}: no existe en la base`); continue; }
    if (row.name === newName) { skipped.push(`#${id}: ya tiene el nombre nuevo`); continue; }
    if (row.name !== oldName) { skipped.push(`#${id}: el nombre actual ("${row.name}") no es el esperado ("${oldName}"); no se toca`); continue; }
    const specs = row.specs && typeof row.specs === 'object' && !Array.isArray(row.specs) ? row.specs : {};
    const data = { name: newName };
    if (!specs.modelo) data.specs = { ...specs, modelo: oldName };
    updates.push({ id, data });
    console.log(`#${id} ${row.brand}\n   antes:   ${row.name}\n   después: ${newName}${data.specs ? `\n   modelo:  ${oldName}` : ''}`);
  }
  if (skipped.length) console.log(`\nSalteados (${skipped.length}):\n - ${skipped.join('\n - ')}`);
  console.log(`\n${updates.length} producto(s) para renombrar.`);

  if (APPLY && updates.length) {
    await prisma.$transaction(updates.map((u) => prisma.product.update({ where: { id: u.id }, data: u.data })));
    console.log('Listo: nombres actualizados.');
  } else if (!APPLY) {
    console.log('Nada escrito. Para aplicar: node scripts/rename-products.js --apply');
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
