import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sizer, buildSizerCatalog } from '../src/sizer/sizer';
import { cleanInputs, toSizerProduct } from '../src/sizer/sizer.service';

const RATE = 1450;
// productos como los devuelve Prisma (datos reales del catálogo)
const ROWS = [
  { id: 11, category: { slug: 'panel' }, brand: 'JA Solar', name: 'DeepBlue 3.0 JAM72S30 545W', price: '265000', currency: 'ARS',
    specs: { imp: 13.04, isc: 13.95, vmp: 41.8, voc: 49.9, potencia_wp: 545, coef_temp_voc: -0.275 } },
  { id: 33, category: { slug: 'inversor' }, brand: 'Growatt', name: 'SPH 5000TL BL-UP', price: '2200000', currency: 'ARS',
    specs: { tipo: 'monofasico', mpptCount: 2, maxPvPower: 8600, systemTypes: ['ongrid', 'hybrid'], maxPvVoltage: 550, mpptRangeMax: 550, mpptRangeMin: 120,
      ratedPowerAC: 5000, batteryVoltageMax: 59, batteryVoltageMin: 42, maxInputCurrentPerMppt: 13.5, maxShortCircuitCurrentPerMppt: 16.5 } },
  { id: 24, category: { slug: 'inversor' }, brand: 'Huawei', name: 'SUN2000-5KTL-L1', price: '1850000', currency: 'ARS',
    specs: { tipo: 'monofasico', mpptCount: 2, maxPvPower: 7500, systemTypes: ['ongrid', 'hybrid'], maxPvVoltage: 600, mpptRangeMax: 560, mpptRangeMin: 90,
      ratedPowerAC: 5000, batteryVoltageMax: 560, batteryVoltageMin: 350, maxInputCurrentPerMppt: 12.5, maxShortCircuitCurrentPerMppt: 18 } },
  { id: 25, category: { slug: 'inversor' }, brand: 'Huawei', name: 'SUN2000-10KTL-M1', price: '2900000', currency: 'ARS',
    specs: { tipo: 'trifasico', mpptCount: 2, maxPvPower: 15000, systemTypes: ['ongrid', 'hybrid'], maxPvVoltage: 1100, mpptRangeMax: 980, mpptRangeMin: 140,
      ratedPowerAC: 10000, batteryVoltageMax: 980, batteryVoltageMin: 600, maxInputCurrentPerMppt: 11, maxShortCircuitCurrentPerMppt: 15 } },
  { id: 48, category: { slug: 'bateria' }, brand: 'LG Energy Solution', name: 'RESU10H Prime', price: '8500000', currency: 'ARS',
    specs: { capacidad_kwh: 9.6, nominalVoltage: 350, maxContinuousCurrent: 14.3 } },
  { id: 42, category: { slug: 'bateria' }, brand: 'Dyness', name: 'A48100', price: '2500000', currency: 'ARS',
    specs: { capacidad_kwh: 4.8, nominalVoltage: 48, maxContinuousCurrent: 75 } },
];
const sizer = new Sizer(buildSizerCatalog(ROWS.map((p) => toSizerProduct(p, RATE))));
const CUSTOM = { cons: '650', hsp: '4.4', goal: 'resp', cover: '80', hours: '8', days: '2', phase: 'mono', crit: '2.5',
  area: '40', est: 'e1', ori: '1', tmin: '-5', tmax: '40', pan: 'auto', inv: 'auto', bat: 'auto' };

test('producto: id del sitio, precio en USD con la cotización y alias de specs', () => {
  const p = toSizerProduct(ROWS[5], RATE);
  assert.equal(p.id, 'db-42');
  assert.equal(p.priceUSD, 1724.14);
  assert.equal(p.specs.capacityWh, 4800);
  assert.equal(toSizerProduct({ ...ROWS[5], currency: 'USD', price: '900' }, RATE).priceUSD, 900);
});

test('respaldo 650 kWh/mes mono: Growatt + 3 Dyness (más barato que Huawei + LG), 2 strings de 5', () => {
  const r: any = sizer.custom(cleanInputs(CUSTOM));
  assert.equal(r.ok, true);
  assert.equal(r.config.inv.name, 'SPH 5000TL BL-UP');
  assert.deepEqual(r.config.plan.lens, [5, 5]);
  // Voc a -5 °C: 5 × 49,9 × (1 + 0,00275 × 30) = 270 V ≤ 550; Vmp con la celda a 65 °C: 5 × 41,8 × 0,86 = 180 V ≥ 120
  assert.ok(Math.abs(r.config.v.vocCold - 270.08) < 0.01);
  assert.ok(Math.abs(r.config.v.vmpHot - 179.74) < 0.01);
  // 2,5 kW × 60 % × 8 h / 0,9 = 13,3 kWh -> 3 × 4,8 kWh; a 5 kW pide 104 A y 3 × 75 A alcanzan
  assert.equal(r.config.bat.name, 'A48100');
  assert.equal(r.config.bank.n, 3);
  assert.ok(Math.abs(r.storage - 14.4) < 1e-9);
});

test('rápido: on-grid más chico que alcanza y sistema mínimo para consumos muy bajos', () => {
  const r: any = sizer.quick(cleanInputs({ cons: '1', hsp: '4.4', goal: 'red', cover: '100' }));
  assert.equal(r.ok, true);
  assert.equal(r.config.plan.s, 1);
  assert.match(r.notes[0].text, /sistema mínimo/);
  assert.equal((sizer.quick(cleanInputs({ cons: '0', goal: 'red' })) as any).empty.length > 0, true);
});

test('respaldo sin batería compatible no sale compatible', () => {
  const r: any = sizer.custom(cleanInputs({ ...CUSTOM, phase: 'tri', inv: 'db-25' }));
  assert.equal(r.ok, false);
  assert.ok(r.checks.some((c) => c.tone === 'bad' && /Sin batería/.test(c.text)));
});

test('poca superficie: avisa que los paneles no entran', () => {
  const r: any = sizer.custom(cleanInputs({ ...CUSTOM, goal: 'red', area: '3' }));
  assert.equal(r.ok, false);
  assert.ok(r.checks.some((c) => c.tone === 'bad' && /Superficie/.test(c.text)));
});

test('entradas: solo campos conocidos, rangos acotados y valores de lista intactos', () => {
  const c = cleanInputs({ cons: '9e9', hsp: '5.0', ori: '0.95', tmin: '-100', goal: 'red', otro: 'x' });
  assert.equal(c.cons, '1000000');
  assert.equal(c.hsp, '5.0');
  assert.equal(c.ori, '0.95');
  assert.equal(c.tmin, '-60');
  assert.equal('otro' in c, false);
  assert.throws(() => cleanInputs({ cons: { $gt: 1 } }), /no es válido/);
  assert.throws(() => cleanInputs(null), /Faltan/);
});
