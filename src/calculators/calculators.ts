/*
 * Calculadoras (funciones puras). Mismas fórmulas que muestra el frontend, más un
 * campo `warnings` con lo que conviene revisar. Los valores fuera de rango se
 * acotan (y se avisa) en vez de devolver un error, para que el resultado siempre se vea.
 */

export interface CalcResult<T> { result: T; warnings: string[] }

const n = (v: any, def = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : def;
};
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export interface Appliance { name?: string; power: number; qty: number; hours: number }

/** Consumo: Σ potencia (W) × cantidad × horas/día. */
export function consumption(items: Appliance[]): CalcResult<{ dailyKwh: number; monthlyKwh: number; yearlyKwh: number; items: number }> {
  const warnings: string[] = [];
  const list = Array.isArray(items) ? items.slice(0, 200) : [];
  if (!list.length) warnings.push('No hay equipos cargados.');
  let dailyWh = 0;
  list.forEach((it, i) => {
    // name viene del cliente: si no es texto (número, objeto) se usa el genérico en vez de romper con un 500
    const label = (typeof it?.name === 'string' && it.name.trim().slice(0, 80)) || `el equipo ${i + 1}`;
    let power = n(it?.power), qty = n(it?.qty), hours = n(it?.hours);
    if (power < 0 || qty < 0 || hours < 0) warnings.push(`Hay valores negativos en ${label}: se tomaron como 0.`);
    power = Math.max(0, power); qty = Math.max(0, qty); hours = Math.max(0, hours);
    if (hours > 24) { warnings.push(`${label}: un día tiene 24 horas; se tomaron 24.`); hours = 24; }
    if (power > 15000) warnings.push(`${label}: ${power} W es una potencia muy alta para un equipo doméstico. ¿Está en W y no en mW o kW?`);
    dailyWh += power * qty * hours;
  });
  const daily = dailyWh / 1000;
  if (daily > 200) warnings.push('El consumo diario supera 200 kWh: es más propio de un comercio o industria. Conviene revisar los datos o pedirnos un estudio a medida.');
  return { result: { dailyKwh: round(daily, 3), monthlyKwh: round(daily * 30, 1), yearlyKwh: round(daily * 365, 0), items: list.length }, warnings };
}

/** Costo: consumo (kWh) × precio del kWh. No incluye impuestos ni cargos fijos (lo aclara la página). */
export function cost(kwh: number, pricePerKwh: number): CalcResult<{ cost: number }> {
  const warnings: string[] = [];
  let k = n(kwh), p = n(pricePerKwh);
  if (k < 0) { warnings.push('El consumo no puede ser negativo: se tomó 0.'); k = 0; }
  if (p <= 0) warnings.push('Cargá el precio del kWh: lo encontrás en la factura como cargo variable.');
  p = Math.max(0, p);
  return { result: { cost: round(k * p, 2) }, warnings };
}

/** Ahorro: producción solar (kWh/mes) × precio del kWh; % = producción / consumo. */
export function savings(currentKwh: number, solarKwh: number, energyPrice: number): CalcResult<{
  monthly: number; yearly: number; coveredPct: number; selfConsumedKwh: number; excessKwh: number;
}> {
  const warnings: string[] = [];
  const cur = Math.max(0, n(currentKwh));
  const sol = Math.max(0, n(solarKwh));
  const price = Math.max(0, n(energyPrice));
  if (n(solarKwh) < 0 || n(currentKwh) < 0) warnings.push('Hay valores negativos: se tomaron como 0.');
  if (price <= 0) warnings.push('Cargá el precio del kWh para calcular el ahorro.');
  if (cur <= 0) warnings.push('Cargá tu consumo mensual para calcular el porcentaje cubierto.');
  const saved = sol * price;
  const selfConsumed = Math.min(sol, cur);
  const excess = Math.max(0, sol - cur);
  if (excess > 0) {
    warnings.push(`La producción supera tu consumo en ${round(excess, 1)} kWh/mes. Ese excedente se inyecta a la red y, con la ley de generación distribuida, suele pagarse a un precio menor que el que pagás vos: el ahorro real puede ser menor al estimado.`);
  }
  return {
    result: {
      monthly: round(saved, 2), yearly: round(saved * 12, 2),
      coveredPct: cur > 0 ? round(Math.min(100, (sol / cur) * 100), 1) : 0,
      selfConsumedKwh: round(selfConsumed, 1), excessKwh: round(excess, 1),
    },
    warnings,
  };
}

/** Orientación: inclinación ≈ |latitud|; en el hemisferio sur, mirando al Norte. */
export function orientation(lat: number): CalcResult<{ angle: number; azimuth: string; azimuthDeg: number }> {
  const warnings: string[] = [];
  let l = n(lat);
  if (l < -90 || l > 90) { warnings.push('La latitud va de -90 a 90: se acotó.'); l = Math.max(-90, Math.min(90, l)); }
  let angle = Math.round(Math.abs(l));
  if (angle < 10) {
    warnings.push('Cerca del ecuador conviene igual un mínimo de 10° de inclinación para que la lluvia limpie los paneles.');
    angle = 10;
  }
  if (Math.abs(l) > 60) warnings.push('En latitudes tan altas la regla "inclinación = latitud" es poco precisa: conviene un estudio con datos del sitio.');
  const south = l < 0;
  return { result: { angle, azimuth: south ? 'Norte (0°)' : 'Sur (180°)', azimuthDeg: south ? 0 : 180 }, warnings };
}
