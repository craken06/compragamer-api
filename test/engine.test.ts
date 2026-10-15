import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PARAMS, DEFAULT_RULES, arrayMetrics, evaluateBatteryToConverter, evaluateDcItem,
  evaluatePanelToConverter, paramsFromRules, ruleMatches,
} from '../src/compatibility/engine';

// Datos reales cargados en Neon (Jinko 585 W y Huawei SUN2000-5KTL-L1)
const jinko = { category: 'panel', specs: { potencia_wp: 585, voc: 52.47, isc: 14.07, vmp: 43.73, imp: 13.38, coef_temp_voc: -0.25 } };
const huawei = {
  category: 'inversor',
  specs: { maxPvVoltage: 600, mpptRangeMin: 90, mpptRangeMax: 560, maxInputCurrentPerMppt: 12.5, maxShortCircuitCurrentPerMppt: 18, maxPvPower: 7500, ratedPowerAC: 5000, batteryVoltageMin: 350, batteryVoltageMax: 560 },
};
const P = DEFAULT_PARAMS, R = DEFAULT_RULES;

test('Voc en frío: corrección por temperatura calculada a mano', () => {
  // 10 × 52,47 × (1 + (-0,25/100) × (-10 - 25)) = 524,7 × 1,0875 = 570,6
  const m = arrayMetrics(jinko.specs, 10, 'series', P);
  assert.equal(m.vocCold, 570.6);
  assert.equal(m.vocStc, 524.7);
  // Vmp en calor: 437,3 × (1 - 0,0035 × 45) = 368,4
  assert.equal(m.vmpHot, 368.4);
});

test('10 Jinko en serie en Huawei 5 kW: ⚠ por margen de tensión y por recorte, no ✕', () => {
  const ev = evaluatePanelToConverter(R, P, jinko, 10, 'series', huawei)!;
  // 570,6 V > 0,97 × 600 = 582? no -> no avisa margen; Imp 13,4 > 12,5 -> recorte
  assert.equal(ev.status, 'warning');
  assert.ok(ev.messages.some((m) => m.includes('recorta')));
  assert.ok(!ev.messages.some((m) => m.includes('muy cerca')));
});

test('11 en serie: 627,7 V en frío supera 600 V -> ✕ aunque en STC (577 V) entraba', () => {
  const ev = evaluatePanelToConverter(R, P, jinko, 11, 'series', huawei)!;
  assert.equal(ev.totals!.totalVoc, 577.2);
  assert.equal(ev.status, 'bad');
  assert.match(ev.messages[0], /en frío/);
});

test('margen de tensión: entre 97 % y 100 % del máximo -> ⚠', () => {
  const inv = { ...huawei, specs: { ...huawei.specs, maxPvVoltage: 580 } }; // 570,6 > 562,6
  const ev = evaluatePanelToConverter(R, P, jinko, 10, 'series', inv)!;
  assert.ok(ev.messages.some((m) => m.includes('muy cerca')));
  assert.equal(ev.status, 'warning');
});

test('2 strings en paralelo en un MPPT: Isc 28,1 A > 18 A -> ✕', () => {
  const ev = evaluatePanelToConverter(R, P, jinko, 10, 'parallel', huawei)!;
  assert.equal(ev.status, 'bad');
  assert.ok(ev.messages.some((m) => m.includes('cortocircuito')));
});

test('sin dato de cortocircuito: se compara Isc con la corriente de operación (regla anterior)', () => {
  const { maxShortCircuitCurrentPerMppt, ...rest } = huawei.specs;
  const ev = evaluatePanelToConverter(R, P, jinko, 10, 'series', { category: 'inversor', specs: rest })!;
  assert.equal(ev.status, 'bad');
});

test('potencia sobre el máximo FV -> ✕; sobredimensionado (> 1,3 × AC) -> ⚠', () => {
  const big = { ...huawei, specs: { ...huawei.specs, maxPvVoltage: 1000, maxInputCurrentPerMppt: 20 } };
  assert.equal(evaluatePanelToConverter(R, P, jinko, 13, 'series', big)!.status, 'bad'); // 7605 W > 7500
  const ev = evaluatePanelToConverter(R, P, jinko, 12, 'series', big)!; // 7020 W > 6500
  assert.equal(ev.status, 'warning');
  assert.ok(ev.messages.some((m) => m.includes('sobredimensionado')));
});

test('equipo sin datos -> ⚠ "faltan datos", nunca ✓', () => {
  const ev = evaluatePanelToConverter(R, P, jinko, 10, 'series', { category: 'inversor', specs: {} })!;
  assert.equal(ev.status, 'warning');
  assert.match(ev.messages[0], /Faltan datos/);
});

test('cantidad 0 o sin equipo -> null', () => {
  assert.equal(evaluatePanelToConverter(R, P, jinko, 0, 'series', huawei), null);
  assert.equal(evaluatePanelToConverter(R, P, jinko, 5, 'series', null as any), null);
});

test('microinversor: se evalúa un panel por equipo', () => {
  const iq8 = { category: 'inversor', specs: { es_microinversor: true, maxPvVoltage: 60, mpptRangeMin: 25, mpptRangeMax: 45, maxInputCurrentPerMppt: 14, maxShortCircuitCurrentPerMppt: 20, maxPvPower: 460 } };
  const ev = evaluatePanelToConverter(R, P, jinko, 8, 'series', iq8)!;
  // Voc frío 57,1 V < 60; Isc 14,07 < 20; 585 W > 460 -> ⚠ recorte
  assert.equal(ev.status, 'warning');
  assert.equal(ev.totals!.converterQty, 8);
  assert.equal(ev.totals!.totalPower, 4680);
  const sunpower = { category: 'panel', specs: { potencia_wp: 440, voc: 69.5, isc: 6.5, vmp: 58, imp: 6.1, coef_temp_voc: -0.29 } };
  assert.equal(evaluatePanelToConverter(R, P, sunpower, 4, 'series', iq8)!.status, 'bad'); // 69,5 V > 60
});

test('regulador: potencia por tensión de batería y corriente de carga', () => {
  const reg = { category: 'regulador', specs: { maxPvVoltage: 100, ratedChargeCurrent: 40, maxPvPowerBySystemVoltage: { 12: 520, 24: 1040 } } };
  const small = { category: 'panel', specs: { potencia_wp: 200, voc: 24, isc: 10, vmp: 20, imp: 9.5, coef_temp_voc: -0.3 } };
  assert.equal(evaluatePanelToConverter(R, P, small, 2, 'series', reg, 24)!.status, 'ok'); // 400 W, 52 V
  assert.equal(evaluatePanelToConverter(R, P, small, 3, 'series', reg, 12)!.status, 'bad'); // 600 W > 520
  assert.equal(evaluatePanelToConverter(R, P, small, 4, 'series', reg, 24)!.status, 'bad'); // 4×24×1,105 = 106 V > 100
});

test('batería: 1 × 48 V × 100 A = 4800 W < 5000 W -> ⚠; 2 unidades -> ✓', () => {
  const hyb = { category: 'inversor', specs: { batteryVoltageMin: 42, batteryVoltageMax: 59, ratedPowerAC: 5000 } };
  const pylon = { category: 'bateria', specs: { nominalVoltage: 48, maxContinuousCurrent: 100 } };
  assert.equal(evaluateBatteryToConverter(R, P, pylon, 1, hyb)!.status, 'warning');
  assert.equal(evaluateBatteryToConverter(R, P, pylon, 2, hyb)!.status, 'ok');
  assert.equal(evaluateBatteryToConverter(R, P, pylon, 1, huawei)!.status, 'bad'); // 48 V fuera de 350-560
  assert.equal(evaluateBatteryToConverter(R, P, { category: 'bateria', specs: {} }, 1, hyb)!.status, 'warning');
});

test('cable DC: tensión vs Voc en frío y corriente vs 1,25 × Isc', () => {
  const cable = { category: 'cable', specs: { tipo: 'cable_dc', tension_max_v: 1500, corriente_max_a: 30 } };
  assert.equal(evaluateDcItem(R, P, cable, jinko, 10, 'series')!.status, 'ok'); // 17,6 A < 30
  assert.equal(evaluateDcItem(R, P, cable, jinko, 10, 'parallel')!.status, 'warning'); // 35,2 A > 30
  const breaker500 = { category: 'proteccion', specs: { lado: 'dc', tension_max_v: 500, corriente_nominal_a: 32 } };
  assert.equal(evaluateDcItem(R, P, breaker500, jinko, 10, 'series')!.status, 'bad'); // 570,6 V > 500
  assert.equal(evaluateDcItem(R, P, { category: 'proteccion', specs: { lado: 'ac' } }, jinko, 10, 'series'), null);
});

test('parámetros desde la tabla y override de temperatura', () => {
  const p = paramsFromRules([{ sourceCategory: '_param', targetCategory: '-', checkKey: 'tMinC', priority: 0, condition: { op: '>', value: -5 }, resultType: 'warning', message: '' }], {});
  assert.equal(p.tMinC, -5);
  assert.equal(paramsFromRules([], { tMinC: -20 }).tMinC, -20);
});

test('ruleMatches: requires / unless / missing', () => {
  assert.equal(ruleMatches({ op: 'missing', ref: 'x' }, {}), true);
  assert.equal(ruleMatches({ op: 'missing', ref: 'x' }, { x: 0 }), false);
  assert.equal(ruleMatches({ metric: 'a', op: '>', ref: 'b', unless: ['c'] }, { a: 2, b: 1, c: 5 }), false);
  assert.equal(ruleMatches({ metric: 'a', op: '>', value: 1, requires: ['z'] }, { a: 2 }), false);
  assert.equal(ruleMatches({ metric: 'a', op: '>', ref: 'b' }, { a: 2 }), false); // sin ref no aplica
});
