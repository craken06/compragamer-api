import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExchangeRateService } from '../exchange-rate/exchange-rate.service';
import { Sizer, SizerProduct, buildSizerCatalog } from './sizer';

const CATALOG_CACHE_MS = 60 * 1000;
// los campos que carga el formulario; cualquier otro se descarta
const FIELDS = ['cons', 'hsp', 'goal', 'cover', 'hours', 'days', 'phase', 'crit', 'area', 'est', 'ori', 'tmin', 'tmax', 'pan', 'inv', 'bat'];
// topes amplios: alcanzan para cualquier caso real y evitan cálculos sin sentido
const LIMITS: Record<string, [number, number]> = {
  cons: [0, 1_000_000], cover: [0, 100], hours: [0, 240], days: [0, 30], crit: [0, 10_000],
  area: [0, 1_000_000], tmin: [-60, 40], tmax: [-20, 70],
};

export interface SizerRequest { mode: 'quick' | 'custom'; inputs: Record<string, unknown> }

/* Producto de la base con el formato del sitio (adaptApiProduct de src/lib/api.js). */
export function toSizerProduct(p: any, usdArs: number): SizerProduct {
  const price = Number(p.price);
  const slug = p.category ? p.category.slug : 'otro';
  const specs = { ...(p.specs || {}) };
  if (slug === 'panel' && specs.pmax == null && specs.potencia_wp != null) specs.pmax = specs.potencia_wp;
  if (slug === 'bateria' && specs.capacityWh == null && specs.capacidad_kwh != null) specs.capacityWh = specs.capacidad_kwh * 1000;
  return {
    id: `db-${p.id}`, category: slug, brand: p.brand, name: p.name,
    priceUSD: p.currency === 'USD' ? price : +(price / usdArs).toFixed(2),
    specs, systemTypes: specs.systemTypes || [],
  };
}

/* Deja solo los campos conocidos, como texto corto, con los números dentro de un rango razonable.
   Un valor dentro del rango no se toca: la ubicación y la orientación se buscan por su texto ("5.0"). */
export function cleanInputs(raw: any): Record<string, string> {
  if (!raw || typeof raw !== 'object') throw new BadRequestException('Faltan los datos del dimensionador.');
  const out: Record<string, string> = {};
  for (const k of FIELDS) {
    const v = raw[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' && typeof v !== 'number') throw new BadRequestException(`El campo ${k} no es válido.`);
    let s = String(v).slice(0, 40);
    const lim = LIMITS[k];
    if (lim) {
      const n = parseFloat(s.replace(',', '.'));
      if (Number.isFinite(n) && (n < lim[0] || n > lim[1])) s = String(Math.min(lim[1], Math.max(lim[0], n)));
    }
    out[k] = s;
  }
  return out;
}

@Injectable()
export class SizerService {
  private cache: { sizer: Sizer; at: number; rate: number } | null = null;

  constructor(private prisma: PrismaService, private exchange: ExchangeRateService) {}

  private async sizer(): Promise<Sizer> {
    const { usdArs } = await this.exchange.getRate();
    if (this.cache && this.cache.rate === usdArs && Date.now() - this.cache.at < CATALOG_CACHE_MS) return this.cache.sizer;
    const rows = await this.prisma.product.findMany({ where: { active: true }, include: { category: true } });
    const sizer = new Sizer(buildSizerCatalog(rows.map((p) => toSizerProduct(p, usdArs))));
    this.cache = { sizer, at: Date.now(), rate: usdArs };
    return sizer;
  }

  async evaluate(req: SizerRequest) {
    if (req?.mode !== 'quick' && req?.mode !== 'custom') throw new BadRequestException('mode tiene que ser quick o custom.');
    const inputs = cleanInputs(req.inputs);
    const sizer = await this.sizer();
    return req.mode === 'quick' ? sizer.quick(inputs) : sizer.custom(inputs);
  }
}
