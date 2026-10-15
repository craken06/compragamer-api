/*
 * Motor de compatibilidad (funciones puras, sin base de datos ni Nest).
 *
 * El motor calcula métricas del arreglo (Voc en frío, Vmp en calor, Isc/Imp por MPPT,
 * potencia...) y las compara contra los datos del equipo usando REGLAS. Las reglas
 * son datos (tabla compatibility_rules) con la forma:
 *   { metric, op, ref | value, factor, requires, unless } -> result_type + mensaje
 * Así se puede ajustar un criterio sin tocar código. Si la tabla no está disponible
 * se usan DEFAULT_RULES (las mismas que siembra la migración).
 *
 * Criterio ✓ / ⚠ / ✕ (ver docs en DEFAULT_RULES):
 *   ✕ bad      -> puede dañar el equipo o el fabricante no lo admite (tensión, cortocircuito, potencia FV máx.)
 *   ⚠ warning  -> funciona, pero con pérdidas o al límite (recorte, MPPT fuera de rango, sobredimensionado, faltan datos)
 *   ✓ ok       -> ninguna regla aplicó
 */

export type Status = 'ok' | 'warning' | 'bad';
export type Op = '>' | '>=' | '<' | '<=' | '!=' | 'missing';

export interface RuleCondition {
  metric?: string; // clave del contexto (métrica calculada o spec del producto evaluado)
  op: Op;
  ref?: string; // clave del contexto con la que se compara
  value?: number; // constante (si no hay ref)
  factor?: number; // multiplica a ref/value (por defecto 1)
  requires?: string[]; // la regla aplica sólo si todas estas claves tienen valor
  unless?: string[]; // la regla NO aplica si alguna de estas claves tiene valor
}

export interface Rule {
  id?: number;
  sourceCategory: string; // qué se evalúa: panel | bateria | proteccion | cable
  targetCategory: string; // contra qué: inversor | microinversor | regulador | string
  checkKey: string; // grupo: dentro de un grupo gana la primera regla (por prioridad) que se cumple
  priority: number;
  condition: RuleCondition;
  resultType: 'bad' | 'warning';
  message: string; // plantilla con {claves} del contexto
  active?: boolean;
}

export interface Params {
  tMinC: number; // temperatura mínima de diseño del sitio (para Voc en frío)
  tCellMaxC: number; // temperatura de celda en verano (para Vmp en calor)
  coefVocDefault: number; // %/°C si el panel no trae coef_temp_voc
  coefVmpDefault: number; // %/°C para Vmp (≈ coef. de Pmax)
  oversizeRatio: number; // DC/AC a partir del cual se avisa
  vocMarginRatio: number; // fracción de la tensión máx. a partir de la cual se avisa
  dcSafetyFactor: number; // factor sobre Isc para cables y protecciones DC (IEC 62548: 1,25)
}

export const DEFAULT_PARAMS: Params = {
  tMinC: -10,
  tCellMaxC: 70,
  coefVocDefault: -0.3,
  coefVmpDefault: -0.35,
  oversizeRatio: 1.3,
  vocMarginRatio: 0.97,
  dcSafetyFactor: 1.25,
};

export interface Evaluation {
  status: Status;
  messages: string[];
  totals?: Record<string, number | null>;
}

type Ctx = Record<string, any>;

const num = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const has = (ctx: Ctx, k: string) => num(ctx[k]) !== null;
const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

function compare(a: number, op: Op, b: number): boolean {
  switch (op) {
    case '>': return a > b;
    case '>=': return a >= b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '!=': return a !== b;
    default: return false;
  }
}

/** ¿Se cumple la condición de la regla en este contexto? */
export function ruleMatches(c: RuleCondition, ctx: Ctx): boolean {
  if (c.requires && !c.requires.every((k) => has(ctx, k))) return false;
  if (c.unless && c.unless.some((k) => has(ctx, k))) return false;
  if (c.op === 'missing') return !has(ctx, c.ref ?? c.metric);
  const a = num(ctx[c.metric]);
  const base = c.ref !== undefined ? num(ctx[c.ref]) : num(c.value);
  if (a === null || base === null) return false; // sin datos: la regla no aplica (para eso están las reglas "missing")
  return compare(a, c.op, base * (c.factor ?? 1));
}

export function renderMessage(template: string, ctx: Ctx): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    const v = ctx[k];
    if (typeof v === 'number') return String(Math.round(v * 10) / 10).replace('.', ',');
    return v === undefined || v === null ? '?' : String(v);
  });
}

/** Aplica las reglas de un par source→target y devuelve el veredicto. */
export function applyRules(rules: Rule[], source: string, target: string, ctx: Ctx): Evaluation {
  const relevant = rules
    .filter((r) => r.active !== false && r.sourceCategory === source && r.targetCategory === target)
    .sort((a, b) => a.priority - b.priority);
  const decided = new Set<string>();
  const hits: { type: 'bad' | 'warning'; msg: string }[] = [];
  for (const rule of relevant) {
    if (decided.has(rule.checkKey)) continue;
    if (ruleMatches(rule.condition, ctx)) {
      decided.add(rule.checkKey);
      hits.push({ type: rule.resultType, msg: renderMessage(rule.message, ctx) });
    }
  }
  const status: Status = hits.some((h) => h.type === 'bad') ? 'bad' : hits.length ? 'warning' : 'ok';
  // primero los ✕, después los ⚠
  const messages = [...hits.filter((h) => h.type === 'bad'), ...hits.filter((h) => h.type === 'warning')].map((h) => h.msg);
  return { status, messages };
}

/* ------------------------------------------------------------------ métricas */

export interface PanelSpecs { [k: string]: any }
export interface ProductLike { id?: number | string; name?: string; category: string; specs: Record<string, any> }

export function panelPower(specs: PanelSpecs): number | null {
  return num(specs.pmax) ?? num(specs.potencia_wp);
}

/**
 * Métricas del arreglo. wiring "series" = un string con todos los paneles;
 * "parallel" = dos strings iguales en paralelo sobre el mismo MPPT (como el configurador).
 * Para microinversores se evalúa un panel por equipo.
 */
export function arrayMetrics(panel: PanelSpecs, qty: number, wiring: 'series' | 'parallel', params: Params, micro = false) {
  const seriesCount = micro ? 1 : wiring === 'parallel' ? Math.ceil(qty / 2) : qty;
  const stringCount = micro ? 1 : wiring === 'parallel' ? 2 : 1;
  const voc = num(panel.voc), isc = num(panel.isc), vmp = num(panel.vmp), imp = num(panel.imp);
  const coefVoc = num(panel.coef_temp_voc) ?? num(panel.coefTempVoc) ?? params.coefVocDefault;
  const pmax = panelPower(panel);
  const vocCold = voc === null ? null : voc * seriesCount * (1 + (coefVoc / 100) * (params.tMinC - 25));
  const vmpHot = vmp === null ? null : vmp * seriesCount * (1 + (params.coefVmpDefault / 100) * (params.tCellMaxC - 25));
  return {
    seriesCount,
    stringCount,
    panelQty: qty,
    vocStc: voc === null ? null : r1(voc * seriesCount),
    vocCold: r1(vocCold),
    vmpStc: vmp === null ? null : r1(vmp * seriesCount),
    vmpHot: r1(vmpHot),
    iscArray: isc === null ? null : r1(isc * stringCount),
    impArray: imp === null ? null : r1(imp * stringCount),
    iscDesign: isc === null ? null : r1(isc * stringCount * params.dcSafetyFactor),
    panelPower: pmax,
    arrayPower: pmax === null ? null : pmax * (micro ? 1 : qty),
    tMinC: params.tMinC,
    tCellMaxC: params.tCellMaxC,
  };
}

function converterKind(converter: ProductLike): 'inversor' | 'microinversor' | 'regulador' {
  if (converter.category === 'regulador') return 'regulador';
  return converter.specs?.es_microinversor === true ? 'microinversor' : 'inversor';
}

export function evaluatePanelToConverter(
  rules: Rule[], params: Params,
  panel: ProductLike, qty: number, wiring: 'series' | 'parallel',
  converter: ProductLike, systemVoltage?: number,
): Evaluation | null {
  if (!panel || !qty || !converter) return null;
  const kind = converterKind(converter);
  const m = arrayMetrics(panel.specs, qty, wiring, params, kind === 'microinversor');
  const s = converter.specs || {};
  const ctx: Ctx = { ...s, ...m };
  if (kind === 'regulador') {
    const byV = s.maxPvPowerBySystemVoltage || {};
    ctx.systemVoltage = systemVoltage ?? null;
    ctx.regulatorMaxPvPower = systemVoltage ? num(byV[systemVoltage] ?? byV[String(systemVoltage)]) : null;
    ctx.chargeCurrent = m.arrayPower !== null && systemVoltage ? r1(m.arrayPower / systemVoltage) : null;
  }
  ctx.oversizeLimit = num(s.ratedPowerAC) !== null ? num(s.ratedPowerAC) * params.oversizeRatio : null;
  ctx.vocMarginLimit = num(s.maxPvVoltage) !== null ? num(s.maxPvVoltage) * params.vocMarginRatio : null;
  const ev = applyRules(rules, 'panel', kind, ctx);
  if (ev.status === 'ok') {
    ev.messages.push(
      kind === 'microinversor'
        ? `Compatible: cada panel (${fmt(m.vocCold)} V en frío, ${fmt(m.iscArray)} A, ${fmt(m.panelPower)} W) entra en un microinversor.`
        : `Compatible: ${fmt(m.vocCold)} V en frío (${params.tMinC} °C) / ${fmt(m.iscArray)} A / ${fmt(m.arrayPower)} W dentro de los rangos admitidos.`,
    );
  }
  ev.totals = {
    totalVoc: m.vocStc, vocCold: m.vocCold, vmpHot: m.vmpHot, totalIsc: m.iscArray, totalImp: m.impArray,
    totalPower: m.arrayPower !== null && kind === 'microinversor' ? m.arrayPower * qty : m.arrayPower,
    seriesCount: m.seriesCount, stringCount: m.stringCount, converterQty: kind === 'microinversor' ? qty : 1,
  };
  return ev;
}

export function evaluateBatteryToConverter(
  rules: Rule[], params: Params,
  battery: ProductLike, qty: number, converter: ProductLike, systemVoltage?: number,
): Evaluation | null {
  if (!battery || !qty || !converter) return null;
  const kind = converterKind(converter) === 'regulador' ? 'regulador' : 'inversor';
  const b = battery.specs || {};
  const s = converter.specs || {};
  const nominalVoltage = num(b.nominalVoltage);
  const dischargeA = num(b.maxContinuousCurrent) ?? num(b.maxDischargeCurrent);
  const ctx: Ctx = {
    ...s,
    nominalVoltage,
    nominalVoltageRounded: nominalVoltage === null ? null : Math.round(nominalVoltage),
    systemVoltage: systemVoltage ?? null,
    batteryQty: qty,
    dischargePower: nominalVoltage !== null && dischargeA !== null ? Math.round(nominalVoltage * dischargeA * qty) : null,
  };
  const ev = applyRules(rules, 'bateria', kind, ctx);
  if (ev.status === 'ok') ev.messages.push('Compatible con la configuración elegida.');
  return ev;
}

/** Cables, conectores y protecciones del lado DC contra el string. */
export function evaluateDcItem(rules: Rule[], params: Params, item: ProductLike, panel: ProductLike, qty: number, wiring: 'series' | 'parallel'): Evaluation | null {
  if (!item || !panel || !qty) return null;
  const s = item.specs || {};
  const isDc = s.lado === 'dc' || s.tipo === 'cable_dc' || s.tipo === 'conector';
  if (!isDc) return null;
  const m = arrayMetrics(panel.specs, qty, wiring, params);
  const ctx: Ctx = { ...s, ...m, itemCurrent: num(s.corriente_max_a) ?? num(s.corriente_nominal_a), itemVoltage: num(s.tension_max_v) };
  const ev = applyRules(rules, item.category, 'string', ctx);
  if (ev.status === 'ok') ev.messages.push(`Adecuado para el string (${fmt(m.vocCold)} V / ${fmt(m.iscDesign)} A de diseño).`);
  return ev;
}

function fmt(v: number | null): string {
  return v === null ? '?' : String(Math.round(v * 10) / 10).replace('.', ',');
}

/* ------------------------------------------------------------------ reglas por defecto */

const R = (sourceCategory: string, targetCategory: string, checkKey: string, priority: number, condition: RuleCondition, resultType: 'bad' | 'warning', message: string): Rule =>
  ({ sourceCategory, targetCategory, checkKey, priority, condition, resultType, message, active: true });

/** Reglas para inversor de string e híbrido (también se reutilizan en microinversor). */
function stringInverterRules(target: 'inversor' | 'microinversor'): Rule[] {
  const unit = target === 'microinversor' ? 'de cada panel' : 'del string';
  return [
    R('panel', target, 'datos', 1, { op: 'missing', ref: 'maxPvVoltage' }, 'warning', 'Faltan datos del equipo (tensión FV máxima): no se pudo verificar la compatibilidad. Consultanos.'),
    R('panel', target, 'tension', 10, { metric: 'vocCold', op: '>', ref: 'maxPvVoltage' }, 'bad', `La tensión ${unit} en frío ({vocCold} V a {tMinC} °C) supera la máxima admitida ({maxPvVoltage} V). Riesgo de daño al equipo.`),
    R('panel', target, 'tension', 11, { metric: 'vocCold', op: '>', ref: 'vocMarginLimit' }, 'warning', `La tensión ${unit} en frío ({vocCold} V) queda muy cerca de la máxima ({maxPvVoltage} V). Conviene un panel menos en serie.`),
    R('panel', target, 'mppt_min', 20, { metric: 'vmpHot', op: '<', ref: 'mpptRangeMin' }, 'warning', 'Con calor la tensión de trabajo (~{vmpHot} V) baja del mínimo del MPPT ({mpptRangeMin} V): el equipo rinde menos en verano.'),
    R('panel', target, 'mppt_max', 21, { metric: 'vmpStc', op: '>', ref: 'mpptRangeMax' }, 'warning', 'La tensión de trabajo ({vmpStc} V) supera el máximo del MPPT ({mpptRangeMax} V): el equipo no sigue el punto de máxima potencia.'),
    R('panel', target, 'corriente', 30, { metric: 'iscArray', op: '>', ref: 'maxShortCircuitCurrentPerMppt' }, 'bad', 'La corriente de cortocircuito ({iscArray} A) supera la máxima admitida por entrada ({maxShortCircuitCurrentPerMppt} A).'),
    R('panel', target, 'corriente', 31, { metric: 'iscArray', op: '>', ref: 'maxInputCurrentPerMppt', unless: ['maxShortCircuitCurrentPerMppt'] }, 'bad', 'La corriente ({iscArray} A) supera la corriente máxima de entrada ({maxInputCurrentPerMppt} A) y el equipo no informa su límite de cortocircuito.'),
    R('panel', target, 'corriente', 32, { metric: 'impArray', op: '>', ref: 'maxInputCurrentPerMppt' }, 'warning', 'La corriente de trabajo ({impArray} A) supera la máxima de entrada ({maxInputCurrentPerMppt} A): el equipo recorta algo de potencia en horas pico.'),
    R('panel', target, 'potencia', 40, { metric: target === 'microinversor' ? 'panelPower' : 'arrayPower', op: '>', ref: 'maxPvPower' }, target === 'microinversor' ? 'warning' : 'bad',
      target === 'microinversor'
        ? 'El panel ({panelPower} W) supera la potencia recomendada para este microinversor ({maxPvPower} W): habrá recorte.'
        : 'La potencia del arreglo ({arrayPower} W) supera la potencia FV máxima admitida ({maxPvPower} W).'),
    ...(target === 'inversor'
      ? [R('panel', target, 'potencia', 41, { metric: 'arrayPower', op: '>', ref: 'oversizeLimit' }, 'warning', 'El arreglo ({arrayPower} W) está sobredimensionado respecto a la potencia nominal ({ratedPowerAC} W). Es práctica común, pero conviene revisarlo.')]
      : []),
  ];
}

export const DEFAULT_RULES: Rule[] = [
  ...stringInverterRules('inversor'),
  ...stringInverterRules('microinversor'),

  // Regulador de carga (off-grid DC)
  R('panel', 'regulador', 'datos', 1, { op: 'missing', ref: 'regulatorMaxPvPower' }, 'warning', 'El regulador no informa potencia FV máxima para {systemVoltage} V: elegí otra tensión de sistema o consultanos.'),
  R('panel', 'regulador', 'tension', 10, { metric: 'vocCold', op: '>', ref: 'maxPvVoltage' }, 'bad', 'La tensión del arreglo en frío ({vocCold} V a {tMinC} °C) supera la máxima del regulador ({maxPvVoltage} V). Riesgo de daño.'),
  R('panel', 'regulador', 'tension', 11, { metric: 'vocCold', op: '>', ref: 'vocMarginLimit' }, 'warning', 'La tensión en frío ({vocCold} V) queda muy cerca de la máxima del regulador ({maxPvVoltage} V).'),
  R('panel', 'regulador', 'potencia', 40, { metric: 'arrayPower', op: '>', ref: 'regulatorMaxPvPower' }, 'bad', 'La potencia del arreglo ({arrayPower} W) supera la máxima del regulador a {systemVoltage} V ({regulatorMaxPvPower} W).'),
  R('panel', 'regulador', 'corriente', 30, { metric: 'chargeCurrent', op: '>', ref: 'ratedChargeCurrent' }, 'warning', 'La corriente de carga (~{chargeCurrent} A) supera la nominal del regulador ({ratedChargeCurrent} A): va a limitar la carga en horas pico.'),

  // Batería
  R('bateria', 'inversor', 'datos', 1, { op: 'missing', ref: 'nominalVoltage' }, 'warning', 'Falta la tensión nominal de la batería en el catálogo: no se pudo verificar la compatibilidad. Consultanos antes de comprar.'),
  R('bateria', 'inversor', 'datos', 2, { op: 'missing', ref: 'batteryVoltageMin' }, 'warning', 'El inversor no informa el rango de tensión de batería: no se pudo verificar la compatibilidad.'),
  R('bateria', 'inversor', 'tension', 10, { metric: 'nominalVoltage', op: '<', ref: 'batteryVoltageMin' }, 'bad', 'La tensión de la batería ({nominalVoltage} V) está por debajo del rango del inversor ({batteryVoltageMin}-{batteryVoltageMax} V).'),
  R('bateria', 'inversor', 'tension', 11, { metric: 'nominalVoltage', op: '>', ref: 'batteryVoltageMax' }, 'bad', 'La tensión de la batería ({nominalVoltage} V) está por encima del rango del inversor ({batteryVoltageMin}-{batteryVoltageMax} V).'),
  R('bateria', 'inversor', 'descarga', 20, { metric: 'dischargePower', op: '<', ref: 'ratedPowerAC' }, 'warning', 'La descarga continua del banco (~{dischargePower} W) queda por debajo de la potencia del inversor ({ratedPowerAC} W). Se recomienda sumar otra unidad.'),
  R('bateria', 'regulador', 'datos', 1, { op: 'missing', ref: 'nominalVoltage' }, 'warning', 'Falta la tensión nominal de la batería en el catálogo: no se pudo verificar la compatibilidad.'),
  R('bateria', 'regulador', 'tension', 10, { metric: 'nominalVoltageRounded', op: '!=', ref: 'systemVoltage' }, 'bad', 'La tensión de la batería ({nominalVoltage} V) no coincide con la tensión de sistema elegida ({systemVoltage} V).'),

  // Cables y protecciones DC contra el string (Iz e In >= 1,25 x Isc; tensión >= Voc en frío)
  ...['cable', 'proteccion'].flatMap((src) => [
    R(src, 'string', 'datos', 1, { op: 'missing', ref: 'itemVoltage' }, 'warning', 'El producto no informa tensión máxima: verificá que soporte el string.'),
    R(src, 'string', 'tension', 10, { metric: 'vocCold', op: '>', ref: 'itemVoltage' }, 'bad', 'La tensión del string en frío ({vocCold} V) supera la admitida por el producto ({itemVoltage} V).'),
    R(src, 'string', 'corriente', 20, { metric: 'iscDesign', op: '>', ref: 'itemCurrent' }, 'warning', 'La corriente de diseño del string (1,25 × Isc = {iscDesign} A) supera la del producto ({itemCurrent} A).'),
  ]),
];

/** Construye los parámetros a partir de filas de la tabla (checkKey = "param", condition.value). */
export function paramsFromRules(rules: Rule[], overrides: Partial<Params> = {}): Params {
  const p: Params = { ...DEFAULT_PARAMS };
  for (const r of rules) {
    if (r.active === false || r.sourceCategory !== '_param') continue;
    const v = num(r.condition?.value);
    if (v !== null && r.checkKey in p) (p as any)[r.checkKey] = v;
  }
  for (const [k, v] of Object.entries(overrides)) if (num(v) !== null) (p as any)[k] = Number(v);
  return p;
}
