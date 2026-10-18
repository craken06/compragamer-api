/* Dimensionador FV+BESS de "Diseñá tu sistema" (automático: rápido o personalizado).
   Calcula la configuración eléctrica: strings, serie/paralelo por MPPT y armado del banco de baterías,
   y verifica la compatibilidad entre cada par de componentes. Funciones puras: el catálogo entra como dato.
   El sitio tiene una copia (src/views/sizer.js del frontend) que muestra el resultado al instante y
   queda de respaldo si la API no responde: los cambios de cálculo van en los dos lados. */

/* Producto tal como lo ve el sitio (adaptApiProduct): id "db-N", precio en USD, specs normalizados. */
export interface SizerProduct {
  id: string;
  category: string;
  brand: string;
  name: string;
  priceUSD: number;
  specs: any;
  systemTypes?: string[];
}

export interface SizerCatalog { panels: any[]; inverters: any[]; batteries: any[] }

/* ---------------------------------------------------------------------- */
/* Equipos de referencia (respaldo si el catálogo no cubre un caso)        */
/* ---------------------------------------------------------------------- */
/* Inversores: vmin/mpptMax = ventana MPPT, vmax = tensión DC máxima de entrada.
   mppts: por entrada, corriente máx. de operación (imax), de cortocircuito (isc) y strings que acepta.
   batV/batI: ventana de tensión y corriente máx. de descarga del puerto de batería. */
const SIZER_MPPT_GW = { imax: 13.5, isc: 16.9, strings: 1 };
const SIZER_MPPT_DEYE = { imax: 13, isc: 17, strings: 1 };
export const SIZER_INVERTERS = [
  { id: 'i1', brand: 'Growatt', name: 'MIN 3000TL-X', type: 'on', phase: 'mono', kw: 3, pvMax: 4.5, vmin: 80, mpptMax: 500, vmax: 550, mppts: [SIZER_MPPT_GW, SIZER_MPPT_GW], bat: null, usd: 650 },
  { id: 'i2', brand: 'Growatt', name: 'MIN 5000TL-X', type: 'on', phase: 'mono', kw: 5, pvMax: 7.5, vmin: 80, mpptMax: 500, vmax: 550, mppts: [SIZER_MPPT_GW, SIZER_MPPT_GW], bat: null, usd: 900 },
  { id: 'i3', brand: 'Fronius', name: 'Symo 10.0-3-M', type: 'on', phase: 'tri', kw: 10, pvMax: 15, vmin: 270, mpptMax: 800, vmax: 1000,
    mppts: [{ imax: 27, isc: 40.5, strings: 2 }, { imax: 16.5, isc: 24.8, strings: 1 }], bat: null, usd: 2600 },
  { id: 'i4', brand: 'Deye', name: 'SUN-5K-SG04LP1', type: 'hib', phase: 'mono', kw: 5, pvMax: 6.5, vmin: 125, mpptMax: 425, vmax: 500,
    mppts: [SIZER_MPPT_DEYE, SIZER_MPPT_DEYE], bat: '48V', batV: [40, 60], batI: 120, usd: 1400 },
  { id: 'i5', brand: 'Deye', name: 'SUN-8K-SG01HP3', type: 'hib', phase: 'tri', kw: 8, pvMax: 10.4, vmin: 160, mpptMax: 850, vmax: 1000,
    mppts: [{ imax: 26, isc: 34, strings: 2 }, SIZER_MPPT_DEYE], bat: 'HV', batV: [160, 800], batI: 25, usd: 2900 },
  { id: 'i6', brand: 'SRNE', name: 'HF4850S80 5 kW', type: 'off', phase: 'mono', kw: 5, pvMax: 5.5, vmin: 60, mpptMax: 400, vmax: 450,
    mppts: [{ imax: 18, isc: 22, strings: 1 }], bat: '48V', batV: [40, 60], batI: 100, usd: 800 },
];
/* Paneles: datos STC y coeficientes de temperatura (por °C) de Voc y de Vmp (se usa el de Pmax como aproximación). */
export const SIZER_PANELS = [
  { id: 'p1', brand: 'Trina', name: 'Vertex S 450 W', w: 450, voc: 41.5, vmp: 34.6, isc: 13.9, imp: 13.0, bVoc: -0.0025, bVmp: -0.0034, area: 2.0, usd: 110 },
  { id: 'p2', brand: 'Jinko', name: 'Tiger Neo 550 W', w: 550, voc: 49.8, vmp: 41.9, isc: 14.0, imp: 13.13, bVoc: -0.0025, bVmp: -0.0029, area: 2.6, usd: 135 },
  { id: 'p3', brand: 'Canadian Solar', name: 'BiHiKu 600 W bifacial', w: 600, voc: 41.9, vmp: 35.1, isc: 18.3, imp: 17.1, bVoc: -0.0026, bVmp: -0.0034, area: 2.8, usd: 160 },
];
/* Baterías: módulos de 48 V que se conectan en paralelo, o módulos HV que se apilan en serie en un rack con BMS. */
export const SIZER_BATTERIES = [
  { id: 'b1', brand: 'Pylontech', name: 'US5000 4,8 kWh', kwh: 4.8, vnom: 48, bus: '48V', topo: 'par', min: 1, max: 16, imax: 100, usd: 1300 },
  { id: 'b2', brand: 'Deye', name: 'SE-G5.1 Pro 5,12 kWh', kwh: 5.12, vnom: 51.2, bus: '48V', topo: 'par', min: 1, max: 32, imax: 100, usd: 1350 },
  { id: 'b3', brand: 'Deye', name: 'BOS-G 5,12 kWh (HV)', kwh: 5.12, vnom: 51.2, bus: 'HV', topo: 'series', min: 3, max: 12, imax: 50, usd: 1700 },
];

/* ---------------------------------------------------------------------- */
/* Catálogo de la tienda                                                   */
/* ---------------------------------------------------------------------- */
const SIZER_BVMP_DEFAULT = -0.0035;  // coef. de Pmax típico si el panel no lo trae: el más exigente para la Vmp en caliente
const SIZER_PANEL_WM2 = 210;         // W por m², para estimar la superficie de un panel sin medidas cargadas

const sizerPos = (v: any) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
/* Coeficiente de temperatura por °C: el catálogo lo guarda en %/°C (-0,25); se acepta también la fracción. */
const sizerCoef = (v: any) => { const n = Number(v); if (!Number.isFinite(n) || n === 0) return null; return Math.abs(n) > 0.05 ? n / 100 : n; };

function sizerPanelFromProduct(p: SizerProduct) {
  const s = p.specs || {};
  const w = sizerPos(s.potencia_wp ?? s.pmax);
  const voc = sizerPos(s.voc), vmp = sizerPos(s.vmp), isc = sizerPos(s.isc), imp = sizerPos(s.imp);
  const bVoc = sizerCoef(s.coef_temp_voc);
  if (!w || !voc || !vmp || !isc || !imp || bVoc == null) return null;
  const bVmp = sizerCoef(s.coef_temp_pmax ?? s.coef_temp_vmp);
  const dims = sizerPos(s.largo_mm) && sizerPos(s.ancho_mm) ? (s.largo_mm * s.ancho_mm) / 1e6 : null;
  const area = sizerPos(s.area_m2) || dims;
  return { id: p.id, brand: p.brand, name: p.name, w, voc, vmp, isc, imp, bVoc, bVmp: bVmp ?? SIZER_BVMP_DEFAULT,
    area: area || w / SIZER_PANEL_WM2, guessBVmp: bVmp == null, guessArea: !area, usd: p.priceUSD, real: true };
}

/* Un mismo inversor puede servir para varios objetivos (roles): on-grid, híbrido u off-grid.
   Los microinversores no entran: el cálculo arma strings. */
function sizerInverterFromProduct(p: SizerProduct) {
  const s = p.specs || {};
  if (s.es_microinversor) return null;
  const types: string[] = s.systemTypes || p.systemTypes || [];
  const ac = sizerPos(s.ratedPowerAC ?? s.potencia_nominal_w), pv = sizerPos(s.maxPvPower), n = sizerPos(s.mpptCount);
  const vmin = sizerPos(s.mpptRangeMin ?? s.vmpp_min), mpptMax = sizerPos(s.mpptRangeMax ?? s.vmpp_max), vmax = sizerPos(s.maxPvVoltage);
  const imax = sizerPos(s.maxInputCurrentPerMppt), isc = sizerPos(s.maxShortCircuitCurrentPerMppt);
  const phase = s.tipo === 'trifasico' ? 'tri' : s.tipo === 'monofasico' ? 'mono' : null;
  if (!ac || !pv || !n || !vmin || !mpptMax || !vmax || !imax || !isc || !phase) return null;
  const bmin = sizerPos(s.batteryVoltageMin), bmax = sizerPos(s.batteryVoltageMax);
  const batV = bmin && bmax ? [bmin, bmax] : null;
  const roles: string[] = [];
  if (types.includes('ongrid')) roles.push('on');
  if (types.includes('hybrid') && batV) roles.push('hib');
  if (types.includes('offgrid') && batV) roles.push('off');
  if (!roles.length) return null;
  const mppt = { imax, isc, strings: sizerPos(s.stringsPerMppt) || 1 };
  return { id: p.id, brand: p.brand, name: p.name, roles, phase, kw: ac / 1000, pvMax: pv / 1000, vmin, mpptMax, vmax,
    mppts: Array.from({ length: Math.round(n) }, () => mppt), bat: batV ? (bmax <= 60 ? '48V' : 'HV') : null, batV,
    batI: sizerPos(s.maxBatteryCurrent), usd: p.priceUSD, real: true };
}

/* Las de 48 V van en paralelo sobre el bus; las de alta tensión son unidades armadas (rack con su BMS).
   Las de 12 y 24 V son para reguladores, no para estos inversores. */
function sizerBatteryFromProduct(p: SizerProduct) {
  const s = p.specs || {};
  const kwh = sizerPos(s.capacidad_kwh) || (sizerPos(s.capacityWh) ? s.capacityWh / 1000 : null);
  const vnom = sizerPos(s.nominalVoltage), imax = sizerPos(s.maxContinuousCurrent);
  if (!kwh || !vnom || !imax) return null;
  const lv = vnom >= 40 && vnom <= 60;
  if (!lv && vnom < 100) return null;
  return { id: p.id, brand: p.brand, name: p.name, kwh, vnom, bus: lv ? '48V' : 'HV', topo: lv ? 'par' : 'unit',
    min: 1, max: sizerPos(s.maxParallel), imax, usd: p.priceUSD, real: true };
}

export function buildSizerCatalog(products: SizerProduct[]): SizerCatalog {
  const pick = (cat: string, adapt: (p: SizerProduct) => any) => products.filter((p) => p.category === cat).map(adapt).filter(Boolean);
  const panels = pick('panel', sizerPanelFromProduct);
  const batteries = pick('bateria', sizerBatteryFromProduct);
  return {
    panels: panels.length ? panels : SIZER_PANELS,
    inverters: pick('inversor', sizerInverterFromProduct),
    batteries: batteries.length ? batteries : SIZER_BATTERIES,
  };
}

const SIZER_STRUCTURES = [
  { id: 'e1', brand: 'Estructura', name: 'Techo de chapa', usd: 28 },
  { id: 'e2', brand: 'Estructura', name: 'Losa (triángulo 15°)', usd: 40 },
  { id: 'e3', brand: 'Estructura', name: 'Suelo', usd: 55 },
];
/* Horas de sol pico y temperaturas extremas de referencia (para la tensión de los strings). */
const SIZER_LOCATIONS = [
  { value: '4.4', label: 'AMBA (4,4 h de sol pico)', tmin: -2, tmax: 38 },
  { value: '5.0', label: 'Córdoba (5,0 h)', tmin: -5, tmax: 40 },
  { value: '5.8', label: 'Mendoza / San Juan (5,8 h)', tmin: -8, tmax: 40 },
  { value: '5.6', label: 'Salta / Jujuy (5,6 h)', tmin: -5, tmax: 37 },
  { value: '4.6', label: 'Neuquén (4,6 h)', tmin: -10, tmax: 40 },
  { value: '4.2', label: 'Mar del Plata (4,2 h)', tmin: -4, tmax: 34 },
];
const SIZER_GOAL_TYPE: Record<string, string> = { red: 'on', resp: 'hib', aut: 'off' };
const SIZER_PR = 0.8;          // rendimiento global del sistema
const SIZER_DOD = 0.9;         // profundidad de descarga de la batería
const SIZER_CELL_RISE = 25;    // °C que la celda supera al ambiente a pleno sol
// ahorro por kWh generado sin batería: 50 % se consume en el momento y el resto se inyecta a ~33 % de la tarifa
// (los mismos supuestos que el retorno estimado del sitio)
const SIZER_SAVE_PER_KWH = 0.5 + 0.5 * 0.33;

/* ---------------------------------------------------------------------- */
/* Utilidades                                                              */
/* ---------------------------------------------------------------------- */
const nfCache: Record<number, Intl.NumberFormat> = {};
function fmtNum(n: any, decimals = 0) {
  if (!nfCache[decimals]) nfCache[decimals] = new Intl.NumberFormat('es-AR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return nfCache[decimals].format(Number(n) || 0);
}
const sizerNum = (v: any) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const sizerById = (list: any[], id: any) => list.find((x) => x.id === id) || null;
const sizerLine = (qty: number, item: any, note = '') => ({ qty, item, note });
const sizerTotal = (lines: any[]) => lines.reduce((s, l) => s + l.qty * l.item.usd, 0);
const sizerPlural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const sizerLocation = (hsp: any) => SIZER_LOCATIONS.find((l) => l.value === String(hsp)) || SIZER_LOCATIONS[0];
const sizerItemName = (it: any) => `${it.brand} ${it.name}`;

/* Todo lo que depende del catálogo va en una clase: cada pedido trae el suyo. */
export class Sizer {
  constructor(private readonly cat: SizerCatalog) {}

  /* Panel sugerido: el de mejor precio por watt. */
  defaultPanel() {
    return this.cat.panels.reduce((best, p) => (!best || p.usd / p.w < best.usd / best.w ? p : best), null);
  }
  panelFor(id: any) {
    return (id && id !== 'auto' && sizerById(this.cat.panels, id)) || this.defaultPanel();
  }

  /* Inversores que sirven para el objetivo y la conexión (el off-grid no depende de la fase), del más chico
     al más grande. Si el catálogo no tiene ninguno para ese caso, se usan los de referencia. */
  invertersFor(goal: string, phase: string) {
    const type = SIZER_GOAL_TYPE[goal];
    const fits = (i: any) => (i.roles || [i.type]).includes(type) && (i.phase === phase || type === 'off');
    const real = this.cat.inverters.filter(fits);
    return (real.length ? real : SIZER_INVERTERS.filter(fits))
      .map((i) => ({ ...i, type }))
      .sort((a, b) => a.pvMax - b.pvMax || a.usd - b.usd);
  }
  /* Baterías del bus que pide el inversor; las que no se apilan en serie tienen que entrar en su ventana de tensión. */
  batteriesFor(inv: any) {
    if (!inv || !inv.bat) return [];
    return this.cat.batteries.filter((b) => b.bus === inv.bat
      && (b.topo === 'series' || !inv.batV || (b.vnom >= inv.batV[0] && b.vnom <= inv.batV[1])));
  }

  /* Batería y cantidad más baratas que cubren `kwh` (si ninguna llega, la que más se acerca). */
  bestBattery(bats: any[], inv: any, kwh: number) {
    let best = null;
    bats.forEach((bat) => {
      const n = sizerBankAuto(bat, inv, kwh);
      const cand = { bat, n, short: n * bat.kwh + 1e-9 < kwh ? 1 : 0, cost: n * bat.usd };
      if (!best || cand.short < best.short || (cand.short === best.short && cand.cost < best.cost)) best = cand;
    });
    return best;
  }

  /* Costo de inversores + banco para cubrir `kwh` en total: sirve para comparar inversores que piden
     baterías distintas (48 V o alta tensión). Primero los que llegan a la energía, después el más barato. */
  systemCost(inv: any, nInv: number, kwh: number) {
    const bank = kwh > 0 ? this.bestBattery(this.batteriesFor(inv), inv, kwh / nInv) : null;
    return { short: bank ? bank.short : 0, cost: nInv * (inv.usd + (bank ? bank.cost : 0)) };
  }

  /* 1A · Rápido: el panel de mejor precio por watt, techo de chapa e inversor monofásico más chico que alcance. */
  quick(q: any) {
    const cons = sizerNum(q.cons);
    const hsp = sizerNum(q.hsp);
    if (cons <= 0) return { empty: 'Ingresá tu consumo mensual para ver el sistema sugerido.' };
    const frac = sizerGoalFraction(q, 0.8);
    if (frac <= 0) return { empty: 'Indicá qué porcentaje de tu factura querés ahorrar.' };

    const loc = sizerLocation(q.hsp);
    const env = sizerEnv(loc.tmin, loc.tmax);
    const pan = this.defaultPanel();
    const kwpReq = (cons * frac) / (30 * hsp * SIZER_PR);
    const kwh = q.goal === 'resp' ? ((cons / 30 / 24) * sizerNum(q.hours) * 1.5) / SIZER_DOD
      : q.goal === 'aut' ? ((cons / 30) * sizerNum(q.days)) / SIZER_DOD : 0;
    // con batería, solo los inversores que tienen alguna compatible en el catálogo (si hay)
    let cands = this.invertersFor(q.goal, 'mono');
    if (kwh > 0 && cands.some((i) => this.batteriesFor(i).length)) cands = cands.filter((i) => this.batteriesFor(i).length);
    if (!cands.length) return { empty: 'No hay inversores monofásicos para ese objetivo. Probá el modo personalizado.' };
    const planFor = (i: any) => sizerArrayPlan(Math.max(1, Math.min(Math.ceil((kwpReq * 1000) / pan.w), Math.floor((i.pvMax * 1000) / pan.w))), pan, i, env);
    const compatible = (i: any) => { const p = planFor(i); return !p.impossible && !sizerArrayChecks(p, pan, i, env).checks.some((c) => c.tone === 'bad'); };
    // el más chico que alcanza y es compatible con el panel (con batería, el que deja el sistema más barato);
    // si ninguno alcanza, el más grande compatible
    const fitting = cands.filter((i) => i.pvMax >= kwpReq);
    const fitOk = fitting.filter(compatible);
    const cheapest = fitOk.reduce((b, i) => (!b || sizerCheaper(this.systemCost(i, 1, kwh), this.systemCost(b, 1, kwh)) ? i : b), null);
    const inv = (kwh > 0 ? cheapest : fitOk[0]) || cands.filter(compatible).pop() || fitting[0] || cands[cands.length - 1];
    const plan = planFor(inv);

    const best = kwh > 0 ? this.bestBattery(this.batteriesFor(inv), inv, kwh) : null;
    const bat = best ? best.bat : null;
    const nb = best ? best.n : 0;
    const est = SIZER_STRUCTURES[0];

    const notes: any[] = [{ tone: 'info', text: `Temperaturas de referencia de ${loc.label.split(' (')[0]}: ${fmtNum(loc.tmin)} °C mínima y ${fmtNum(loc.tmax)} °C máxima.` }];
    const guess = sizerPanelGuessNote(pan, false);
    if (guess) notes.push(guess);
    if (plan.limited || (plan.n * pan.w) / 1000 + 0.01 < kwpReq) notes.unshift({ tone: 'warn', text: 'La potencia quedó limitada por el inversor monofásico más grande del catálogo. Para más potencia, usá el modo personalizado.' });
    const r: any = sizerAssemble({ pan, inv, nInv: 1, plan, env, bat, nbPerInv: nb, est, notes });
    r.gen = r.kwp * hsp * 30 * SIZER_PR;
    r.coverage = (r.gen / cons) * 100;
    sizerMinimumNote(r);
    return r;
  }

  /* Inversor efectivo del personalizado: el elegido o, en automático, el que resuelve con menos equipos
     (y, a igual cantidad, el que deja inversores y baterías más baratos). */
  customSizing(cu: any) {
    const invs = this.invertersFor(cu.goal, cu.phase);
    const pan = this.panelFor(cu.pan);
    const env = sizerEnv(sizerNum(cu.tmin), sizerNum(cu.tmax));
    const backup = cu.goal !== 'red';
    const crit = sizerNum(cu.crit);
    const t = sizerCustomTargets(cu, pan);
    let pool = cu.inv === 'auto' ? invs : invs.filter((i) => i.id === cu.inv);
    // en automático con batería, primero los que tienen alguna compatible en el catálogo
    if (cu.inv === 'auto' && backup && pool.some((i) => this.batteriesFor(i).length)) pool = pool.filter((i) => this.batteriesFor(i).length);
    const kwh = sizerCustomKwh(cu);
    let best = null;
    // primero los compatibles con el panel; a igual cantidad de inversores, el que deja la relación DC/AC
    // entre 0,8 y 1,3 y después el sistema (inversores y baterías) más barato
    const offRatio = (f: any) => { const r = (f.plan.n * pan.w) / 1000 / f.inv.kw; return r < 0.8 || r > 1.3 ? 1 : 0; };
    const bad = (f: any) => (f.plan.impossible || sizerArrayChecks(f.plan, pan, f.inv, env, f.nInv).checks.some((c) => c.tone === 'bad') ? 1 : 0);
    pool.forEach((inv) => {
      const fit: any = sizerInverterFit(inv, pan, env, Math.max(1, t.nTarget), Math.max(1, t.nArea), crit, backup);
      fit.bad = bad(fit);
      fit.cost = this.systemCost(inv, fit.nInv, kwh);
      if (!best || fit.bad < best.bad) { best = fit; return; }
      if (fit.bad > best.bad) return;
      if (fit.nInv < best.nInv
        || (fit.nInv === best.nInv && (offRatio(fit) < offRatio(best)
          || (offRatio(fit) === offRatio(best) && sizerCheaper(fit.cost, best.cost))))) best = fit;
    });
    return { ...(best || { inv: null }), pan, env, t, crit, backup };
  }

  /* 1B · Personalizado: el usuario elige el panel (y, si quiere, inversor y batería); se calculan
     inversores, strings y módulos. */
  custom(cu: any) {
    const cons = sizerNum(cu.cons);
    const hsp = sizerNum(cu.hsp);
    if (cons <= 0) return { empty: 'Ingresá tu consumo mensual para calcular las cantidades.' };
    if (sizerGoalFraction(cu, 0.85) <= 0) return { empty: 'Indicá qué porcentaje de tu factura querés ahorrar.' };
    const { inv, nInv, plan, pan, env, t, crit, backup } = this.customSizing(cu);
    if (!inv) return { empty: 'No hay inversores en el catálogo para esa combinación. Cambiá el objetivo o la conexión.' };
    if (t.nArea < 1) return { empty: 'Con esa superficie no entra ni un panel. Revisá los m² libres.' };

    // la batería sigue al inversor efectivo (en automático puede cambiar con el consumo o la superficie)
    const bats = this.batteriesFor(inv);
    const est = sizerById(SIZER_STRUCTURES, cu.est);
    const ori = sizerNum(cu.ori) || 1;
    const n = plan.n * nInv;
    const kwh = sizerCustomKwh(cu);
    const chosen = bats.find((b) => b.id === cu.bat);
    const bat = chosen || (kwh > 0 ? (this.bestBattery(bats, inv, kwh / nInv) || {}).bat : null) || null;
    const nbPerInv = bat && kwh > 0 ? sizerBankAuto(bat, inv, kwh / nInv) : 0;
    const acKw = nInv * inv.kw;

    const extra: any[] = [];
    if (plan.impossible) extra.push({ tone: 'bad', text: `Con ${fmtNum(env.tmin)} °C y ${fmtNum(env.tmax)} °C no hay una cantidad de paneles en serie que entre en la ventana de tensión del ${inv.brand} ${inv.name}.` });
    extra.push({ tone: n <= t.nArea ? 'ok' : 'bad', text: `Superficie: ${n} paneles ocupan ${fmtNum(n * pan.area, 1)} m² de ${fmtNum(sizerNum(cu.area))} m² libres.` });
    if (t.nReq > t.nArea) extra.push({ tone: 'warn', text: `El techo limita: para el objetivo harían falta ${t.nReq} paneles (${fmtNum(t.nReq * pan.area)} m²).` });
    if (n < t.nTarget && !plan.impossible) extra.push({ tone: 'warn', text: nInv > 1
      ? `Se usan ${n} de los ${t.nTarget} paneles posibles, para que los ${nInv} inversores queden iguales y sin sumar uno más.`
      : `Se usan ${n} de los ${t.nTarget} paneles posibles: es lo que admite un ${inv.brand} ${inv.name} y evita sumar otro inversor.` });
    if (backup) extra.push({ tone: acKw >= crit ? 'ok' : 'bad', text: `Potencia AC de ${fmtNum(acKw)} kW para ${fmtNum(crit, 1)} kW de cargas críticas.` });
    if (inv.type !== 'off' && cu.phase !== inv.phase) extra.push({ tone: 'bad', text: 'La fase del inversor no coincide con la conexión.' });
    if (cu.phase === 'mono' && acKw > 10) extra.push({ tone: 'warn', text: `${fmtNum(acKw)} kW de inversores en una conexión monofásica: lo habitual es no pasar de 10 kW. Consultá con tu distribuidora o pasá a trifásica.` });
    if (nInv > 4) extra.push({ tone: 'warn', text: `Son ${nInv} inversores de ${fmtNum(inv.kw)} kW. ${cu.inv === 'auto' ? 'Es el modelo más grande del catálogo para esta conexión' : 'Conviene un modelo más grande'}${cu.phase === 'mono' ? ' o pasar a trifásica' : ''}.` });

    const notes: any[] = [];
    if (cu.goal === 'resp') notes.push({ tone: 'info', text: 'Respaldo calculado con el 60 % de las cargas críticas en promedio.' });
    if (nInv > 1) notes.push({ tone: 'info', text: `Cada inversor lleva su propio arreglo de strings${nbPerInv ? ' y su propio banco de baterías' : ''}. Las verificaciones de tensión, corriente y potencia son por inversor.` });
    if (backup && !bats.length) notes.push({ tone: 'warn', text: `En el catálogo no hay baterías compatibles con el ${sizerItemName(inv)}. Elegí otro inversor o consultanos.` });
    const guess = sizerPanelGuessNote(pan, true);
    if (guess) notes.push(guess);
    const r: any = sizerAssemble({ pan, inv, nInv, plan, env, bat, nbPerInv, est, extraChecks: extra, notes });
    r.gen = r.kwp * hsp * 30 * SIZER_PR * ori;
    r.coverage = (r.gen / cons) * 100;
    sizerMinimumNote(r);
    return r;
  }
}

const sizerCheaper = (a: any, b: any) => a.short < b.short || (a.short === b.short && a.cost < b.cost);

/* Fracción del consumo que tiene que generar el sistema. Para bajar la factura el usuario elige qué parte
   de la factura quiere ahorrar ("save", %): cada kWh generado ahorra SIZER_SAVE_PER_KWH de factura (lo que se
   consume en el momento vale entero, lo inyectado a precio mayorista), así que se genera ahorro / SIZER_SAVE_PER_KWH.
   Sin "save" se toma "cover" (% de cobertura del consumo), el campo del formulario anterior. */
function sizerGoalFraction(st: any, backupFraction: number) {
  if (st.goal === 'red') {
    if (st.save === undefined) return Math.min(100, Math.max(0, sizerNum(st.cover))) / 100;
    return Math.min(100, Math.max(0, sizerNum(st.save))) / 100 / SIZER_SAVE_PER_KWH;
  }
  return st.goal === 'resp' ? backupFraction : 1.2;
}

/* ---------------------------------------------------------------------- */
/* Arreglo FV: strings y reparto por MPPT                                  */
/* ---------------------------------------------------------------------- */
function sizerEnv(tmin: number, tmax: number) {
  return { tmin, tmax, tcell: tmax + SIZER_CELL_RISE };
}

/* Tensiones de un string de `ps` paneles en serie en los extremos de temperatura. */
function sizerStringVoltages(pan: any, ps: number, env: any) {
  return {
    vocCold: ps * pan.voc * (1 + pan.bVoc * (env.tmin - 25)),
    vmpHot: ps * pan.vmp * (1 + pan.bVmp * (env.tcell - 25)),
    vmpCold: ps * pan.vmp * (1 + pan.bVmp * (env.tmin - 25)),
  };
}

/* Paneles en serie admitidos: el mínimo para arrancar el MPPT en caliente y el máximo por Voc en frío. */
function sizerSeriesLimits(pan: any, inv: any, env: any) {
  const one = sizerStringVoltages(pan, 1, env);
  return { minPS: Math.max(1, Math.ceil(inv.vmin / one.vmpHot)), maxPS: Math.max(1, Math.floor(inv.vmax / one.vocCold)) };
}

/* Reparte `s` strings entre los MPPT: primero uno por entrada y, si hace falta, en paralelo dentro de una
   misma entrada, sin superar la corriente de cortocircuito. Lo que no entra físicamente queda en overflow. */
function sizerAllocate(s: number, pan: any, inv: any) {
  const safe = inv.mppts.map((m) => Math.min(m.strings, Math.floor(m.isc / pan.isc)));
  const alloc = inv.mppts.map(() => 0);
  let left = s;
  const fill = (limits: number[]) => {
    for (let level = 1; left > 0 && level <= Math.max(...limits); level++) {
      for (let i = 0; left > 0 && i < limits.length; i++) if (alloc[i] < Math.min(level, limits[i])) { alloc[i]++; left--; }
    }
  };
  fill(safe);                              // sin pasarse de corriente
  fill(inv.mppts.map((m) => m.strings));   // lo que queda, aunque la corriente no dé (se marca en las verificaciones)
  return { alloc, overflow: left };
}

/* Largo de string de cada MPPT para repartir `goal` paneles en los strings ya asignados (`alloc`).
   Cada MPPT es independiente, así que puede tener su propio largo; los strings en paralelo dentro de un
   mismo MPPT llevan el mismo. Se parte del largo parejo y se suma un panel por MPPT mientras alcance. */
function sizerStringLengths(goal: number, alloc: number[], minPS: number, maxPS: number) {
  const s = alloc.reduce((n, k) => n + k, 0);
  const base = Math.max(minPS, Math.floor(goal / s));
  const lens = alloc.map((k) => (k ? base : 0));
  let rem = goal - base * s;
  alloc.map((k, i) => ({ k, i })).filter((x) => x.k > 0).sort((x, y) => x.k - y.k).forEach(({ k, i }) => {
    if (rem >= k && lens[i] + 1 <= maxPS) { lens[i]++; rem -= k; }
  });
  return lens;
}

const sizerPlanPanels = (alloc: number[], lens: number[]) => alloc.reduce((n, k, i) => n + k * lens[i], 0);

function sizerPlanShape(alloc: number[], lens: number[], extra: any) {
  const used = lens.filter((L, i) => alloc[i] > 0);
  return { ...extra, alloc, lens, s: alloc.reduce((n, k) => n + k, 0), n: sizerPlanPanels(alloc, lens),
    psMin: Math.min(...used), psMax: Math.max(...used), overflow: 0 };
}

/* Arma los strings de un inversor para llegar a `target` paneles sin pasar `maxPanels` (potencia FV máxima
   o lo que entra en el techo). Criterio, en orden: que cada string entre en la ventana de tensión; quedar
   lo más cerca posible del objetivo; usar todos los MPPT antes de dejar alguno libre; menos strings. */
function sizerArrayPlan(target: number, pan: any, inv: any, env: any, maxPanels = Infinity) {
  const { minPS, maxPS } = sizerSeriesLimits(pan, inv, env);
  const caps = inv.mppts.map((m) => Math.min(m.strings, Math.floor(m.isc / pan.isc)));
  const usable = caps.filter((c) => c > 0).length || inv.mppts.length;   // MPPT que aceptan al menos un string
  const slots = caps.reduce((n, c) => n + c, 0) || inv.mppts.length;
  const pvCap = Math.floor((inv.pvMax * 1000) / pan.w);
  const cap = Math.min(pvCap, maxPanels);
  if (minPS > maxPS) {
    // con estas temperaturas ninguna cantidad en serie entra en la ventana del inversor
    const { alloc } = sizerAllocate(1, pan, inv);
    return sizerPlanShape(alloc, alloc.map((k) => (k ? maxPS : 0)), { limited: true, impossible: true });
  }
  const goal = Math.max(minPS, Math.min(target, cap));   // como mínimo, un string que arranque el MPPT
  let best = null;
  for (let s = 1; s <= slots; s++) {
    if (s * minPS > Math.max(goal, minPS)) break;          // más strings ya no entran ni con el largo mínimo
    const { alloc } = sizerAllocate(s, pan, inv);
    const lens = sizerStringLengths(goal, alloc, minPS, maxPS);
    if (lens.some((L, i) => alloc[i] && L > maxPS)) continue;
    const n = sizerPlanPanels(alloc, lens);
    const cand = { s, alloc, lens, diff: Math.abs(goal - n), unused: Math.max(0, usable - alloc.filter((k) => k > 0).length) };
    if (!best || cand.diff < best.diff || (cand.diff === best.diff && (cand.unused < best.unused || (cand.unused === best.unused && s < best.s)))) best = cand;
  }
  if (best && best.diff >= minPS) best = null;              // no llega al objetivo: faltan entradas o tensión
  if (!best) {
    const { alloc } = sizerAllocate(slots, pan, inv);
    const lens = alloc.map((k) => (k ? maxPS : 0));
    // con todas las entradas al máximo de tensión, sin pasar la potencia FV
    while (sizerPlanPanels(alloc, lens) > cap && lens.some((L) => L > minPS)) {
      const i = lens.indexOf(Math.max(...lens));
      lens[i]--;
    }
    return sizerPlanShape(alloc, lens, { limited: true, impossible: false });
  }
  return sizerPlanShape(best.alloc, best.lens, { limited: false, impossible: false });
}

/* "de 5" o "de 4 y 5" paneles. */
const sizerLensText = (plan: any) => (plan.psMin === plan.psMax ? `de ${plan.psMax}` : `de ${plan.psMin} y ${plan.psMax}`);

/* Verificaciones panel ↔ inversor de un arreglo ya armado. */
function sizerArrayChecks(plan: any, pan: any, inv: any, env: any, nInv = 1) {
  const long = sizerStringVoltages(pan, plan.psMax, env);
  const short = sizerStringVoltages(pan, plan.psMin, env);
  const v = { vocCold: long.vocCold, vmpHot: short.vmpHot, vmpCold: long.vmpCold };
  const which = (ps: number) => (plan.psMin === plan.psMax ? 'del string' : `del string de ${ps}`);
  const kwp = (plan.n * pan.w) / 1000;
  const checks: any[] = [];
  checks.push({ tone: v.vocCold <= inv.vmax ? 'ok' : 'bad', text: `Voc ${which(plan.psMax)} a ${fmtNum(env.tmin)} °C: ${fmtNum(v.vocCold)} V ${v.vocCold <= inv.vmax ? '≤' : '>'} ${inv.vmax} V máximos del inversor.` });
  checks.push({ tone: v.vmpHot >= inv.vmin ? 'ok' : 'bad', text: `Vmp ${which(plan.psMin)} con la celda a ${fmtNum(env.tcell)} °C: ${fmtNum(v.vmpHot)} V ${v.vmpHot >= inv.vmin ? '≥' : '<'} ${inv.vmin} V mínimos del MPPT.` });
  if (v.vmpCold > inv.mpptMax) checks.push({ tone: 'warn', text: `Vmp en frío de ${fmtNum(v.vmpCold)} V, arriba del rango MPPT (hasta ${inv.mpptMax} V): en invierno puede perder rendimiento.` });
  plan.alloc.forEach((k: number, i: number) => {
    if (!k) return;
    const m = inv.mppts[i];
    const isc = k * pan.isc;
    const imp = k * pan.imp;
    const label = `MPPT ${i + 1} (${sizerPlural(k, 'string', 'strings')} de ${plan.lens[i]}${k > 1 ? ' en paralelo' : ''})`;
    if (isc > m.isc) checks.push({ tone: 'bad', text: `${label}: Isc de ${fmtNum(isc, 1)} A > ${fmtNum(m.isc, 1)} A que admite la entrada.` });
    else if (imp > m.imax) checks.push({ tone: 'warn', text: `${label}: Imp de ${fmtNum(imp, 1)} A > ${fmtNum(m.imax, 1)} A de operación. El inversor recorta corriente.` });
    else checks.push({ tone: 'ok', text: `${label}: Isc de ${fmtNum(isc, 1)} A ≤ ${fmtNum(m.isc, 1)} A de la entrada.` });
  });
  const each = nInv > 1 ? ' por inversor' : '';
  checks.push({ tone: kwp <= inv.pvMax ? 'ok' : 'bad', text: `Potencia FV${each} de ${fmtNum(kwp, 2)} kWp ${kwp <= inv.pvMax ? '≤' : '>'} ${fmtNum(inv.pvMax, 1)} kWp que admite el inversor.` });
  // la relación DC/AC es una guía: el límite duro es la potencia FV máxima (arriba)
  const ratio = kwp / inv.kw;
  if (ratio > 1.3) checks.push({ tone: 'warn', text: `Relación DC/AC de ${fmtNum(ratio, 2)}: en las horas de más sol el inversor recorta potencia.` });
  else if (ratio < 0.8) checks.push({ tone: 'warn', text: `Relación DC/AC de ${fmtNum(ratio, 2)}: el inversor queda grande para el arreglo${inv.type === 'on' ? '' : ', algo esperable si se eligió por cargas críticas o batería'}.` });
  else checks.push({ tone: 'ok', text: `Relación DC/AC de ${fmtNum(ratio, 2)} (conviene entre 0,8 y 1,3).` });
  return { checks, v };
}

/* ---------------------------------------------------------------------- */
/* Banco de baterías                                                       */
/* ---------------------------------------------------------------------- */
function sizerBankPlan(bat: any, n: number) {
  const series = bat.topo === 'series';
  return { n, series, vbus: series ? n * bat.vnom : bat.vnom, kwh: n * bat.kwh, imax: series ? bat.imax : n * bat.imax };
}

/* Rango de módulos que acepta el par batería ↔ inversor (max Infinity: el catálogo no trae el límite). */
function sizerBankRange(bat: any, inv: any) {
  const max = bat.max || Infinity;
  if (bat.topo !== 'series' || !inv.batV) return { min: bat.min, max };
  return { min: Math.max(bat.min, Math.ceil(inv.batV[0] / bat.vnom)), max: Math.min(max, Math.floor(inv.batV[1] / bat.vnom)) };
}

/* Corriente que pide el inversor a su potencia nominal, sin pasar su máximo de batería (si se conoce). */
const sizerInverterBatCurrent = (inv: any, vbus: number) => Math.min(inv.batI || Infinity, (inv.kw * 1000) / vbus);

/* Módulos para cubrir la energía pedida, la tensión mínima del inversor y la corriente a plena potencia. */
function sizerBankAuto(bat: any, inv: any, kwh: number) {
  const range = sizerBankRange(bat, inv);
  let n = Math.max(range.min, Math.ceil(kwh / bat.kwh));
  if (bat.topo === 'par') n = Math.max(n, Math.ceil(sizerInverterBatCurrent(inv, bat.vnom) / bat.imax));
  return Math.min(n, range.max);
}

/* Verificaciones batería ↔ inversor. */
function sizerBankChecks(bat: any, n: number, inv: any) {
  if (inv.type === 'on') return bat && n ? [{ tone: 'bad', text: 'Un inversor on-grid no admite batería.' }] : [];
  if (!bat || !n) return [inv.type === 'off' ? { tone: 'bad', text: 'Un sistema off-grid necesita batería.' } : { tone: 'bad', text: 'Sin batería no hay respaldo ante cortes: hace falta una compatible con este inversor.' }];
  const bank = sizerBankPlan(bat, n);
  const range = sizerBankRange(bat, inv);
  const checks: any[] = [];
  if (bat.bus !== inv.bat) {
    checks.push({ tone: 'bad', text: `La batería es de ${bat.bus === 'HV' ? 'alta tensión' : '48 V'} y el inversor pide ${inv.bat === 'HV' ? 'alta tensión' : '48 V'}.` });
    return checks;
  }
  const inWindow = bank.vbus >= inv.batV[0] && bank.vbus <= inv.batV[1];
  checks.push({ tone: inWindow ? 'ok' : 'bad', text: `Tensión del banco: ${fmtNum(bank.vbus, 1)} V ${inWindow ? 'dentro de' : 'fuera de'} la ventana de batería del inversor (${inv.batV[0]} a ${inv.batV[1]} V).` });
  const inRange = n >= range.min && n <= range.max;
  if (Number.isFinite(range.max)) checks.push({ tone: inRange ? 'ok' : 'bad', text: `${sizerPlural(n, 'módulo', 'módulos')} en ${bank.series ? 'serie' : 'paralelo'}: con este inversor se admiten de ${range.min} a ${range.max}.` });
  else if (bat.topo === 'unit' && n > 1) checks.push({ tone: 'warn', text: `${n} unidades en paralelo: confirmá con el fabricante que el modelo y el inversor lo admiten.` });
  else if (n > 16) checks.push({ tone: 'warn', text: `${n} módulos en paralelo es mucho para un solo bus: confirmá el máximo del fabricante o pasá a un módulo más grande.` });
  const need = sizerInverterBatCurrent(inv, bank.vbus);
  if (bank.imax >= need) checks.push({ tone: 'ok', text: `El banco entrega hasta ${fmtNum(bank.imax)} A y el inversor pide ${fmtNum(need)} A a plena potencia.` });
  else checks.push({ tone: 'warn', text: `El banco entrega ${fmtNum(bank.imax)} A y el inversor pide ${fmtNum(need)} A: desde batería queda limitado a ${fmtNum((bank.imax * bank.vbus) / 1000, 1)} kW.` });
  return checks;
}

/* ---------------------------------------------------------------------- */
/* Modos                                                                   */
/* ---------------------------------------------------------------------- */
/* Resultado común: configuración, verificaciones y lista de materiales. */
function sizerAssemble({ pan, inv, nInv, plan, env, bat, nbPerInv, est, extraChecks = [], notes = [] }: any) {
  const array = sizerArrayChecks(plan, pan, inv, env, nInv);
  const bankChecks = sizerBankChecks(bat, nbPerInv, inv);
  const checks = [...array.checks, ...bankChecks, ...extraChecks];
  const n = plan.n * nInv;
  const nb = bat ? nbPerInv * nInv : 0;
  const kwp = (n * pan.w) / 1000;
  const lines = [
    sizerLine(n, pan, `${nInv > 1 ? `${nInv} × ` : ''}${sizerPlural(plan.s, 'string', 'strings')} ${sizerLensText(plan)} en serie`),
    sizerLine(nInv, inv),
    ...(nb ? [sizerLine(nb, bat, bat.topo === 'series' ? `rack de ${nbPerInv} en serie${nInv > 1 ? ' por inversor' : ''}`
      : nbPerInv > 1 ? `${nbPerInv} en paralelo${nInv > 1 ? ' por inversor' : ''}` : nInv > 1 ? 'una por inversor' : '')] : []),
    sizerLine(n, est),
  ];
  return {
    kwp, storage: nb ? nb * bat.kwh : 0, ratio: kwp / (nInv * inv.kw), lines, total: sizerTotal(lines), checks,
    ok: !checks.some((c) => c.tone === 'bad'), notes,
    config: { pan, inv, nInv, plan, v: array.v, env, bat: nb ? bat : null, bank: nb ? sizerBankPlan(bat, nbPerInv) : null },
  };
}

/* Aclara qué datos del panel se estimaron porque el catálogo no los trae. */
function sizerPanelGuessNote(pan: any, withArea: boolean) {
  const guess: string[] = [];
  if (pan.guessBVmp) guess.push(`coeficiente de temperatura de Pmax de ${fmtNum(SIZER_BVMP_DEFAULT * 100, 2)} %/°C`);
  if (withArea && pan.guessArea) guess.push(`superficie de ${fmtNum(pan.area, 2)} m² por panel (${SIZER_PANEL_WM2} W/m²)`);
  return guess.length ? { tone: 'info', text: `Del ${sizerItemName(pan)} se estimó: ${guess.join(' y ')}.` } : null;
}

/* Si el string más chico que arranca el MPPT ya genera mucho más que el consumo, se aclara. */
function sizerMinimumNote(r: any) {
  if (r.coverage > 150 && r.config.nInv === 1 && r.config.plan.s === 1) {
    r.notes.unshift({ tone: 'info', text: `Es el sistema mínimo para este inversor: un string de ${r.config.plan.psMax} paneles es lo menos que arranca su MPPT, y genera más de lo que consumís.` });
  }
}

/* Paneles objetivo del personalizado: lo que pide el consumo, recortado por la superficie. */
function sizerCustomTargets(cu: any, pan: any) {
  const cons = sizerNum(cu.cons);
  const frac = sizerGoalFraction(cu, 0.85);
  const ori = sizerNum(cu.ori) || 1;
  const hsp = sizerNum(cu.hsp) || 1;
  const kwpReq = (cons * frac) / (30 * hsp * SIZER_PR * ori);
  const nReq = Math.max(0, Math.ceil((kwpReq * 1000) / pan.w));
  const nArea = Math.max(0, Math.floor(sizerNum(cu.area) / pan.area));
  return { kwpReq, nReq, nArea, nTarget: Math.min(nReq, nArea) };
}

/* Cuántos inversores de un modelo hacen falta y cómo queda el arreglo de cada uno. Se suma un inversor
   mientras el arreglo de cada uno no llegue a su parte (por tensión, entradas o potencia FV). */
function sizerInverterFit(inv: any, pan: any, env: any, nTarget: number, nArea: number, crit: number, backup: boolean) {
  let nInv = Math.max(1, Math.ceil((nTarget * pan.w) / 1000 / inv.pvMax));
  if (backup) nInv = Math.max(nInv, Math.ceil(crit / inv.kw));
  // todos los inversores llevan el mismo arreglo: cada uno, su parte sin pasar lo que entra en el techo
  const planFor = (k: number) => sizerArrayPlan(Math.ceil(nTarget / k), pan, inv, env, Math.max(1, Math.floor(nArea / k)));
  let plan = planFor(nInv);
  while (plan.limited && !plan.impossible && nInv < 500) plan = planFor(++nInv);
  // un inversor menos si solo se pierden hasta 2 paneles o el 5 % del objetivo (y alcanza para las cargas críticas)
  const minInv = backup ? Math.max(1, Math.ceil(crit / inv.kw)) : 1;
  if (nInv - 1 >= minInv) {
    const fewer = planFor(nInv - 1);
    const tolerance = Math.max(2, Math.floor(nTarget * 0.05));
    if (!fewer.impossible && fewer.n * (nInv - 1) >= nTarget - tolerance) return { inv, nInv: nInv - 1, plan: fewer };
  }
  return { inv, nInv, plan };
}

/* Energía del banco del personalizado (kWh útiles / profundidad de descarga). */
function sizerCustomKwh(cu: any) {
  if (cu.goal === 'resp') return (sizerNum(cu.crit) * 0.6 * sizerNum(cu.hours)) / SIZER_DOD;
  return cu.goal === 'aut' ? ((sizerNum(cu.cons) / 30) * sizerNum(cu.days)) / SIZER_DOD : 0;
}
