import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_RULES, Evaluation, Params, ProductLike, Rule,
  evaluateBatteryToConverter, evaluateDcItem, evaluatePanelToConverter, paramsFromRules,
} from './engine';

export interface EvaluateRequest {
  panel: { productId: number; qty: number; wiring?: 'series' | 'parallel' };
  converterIds?: number[]; // opciones a evaluar en el paso de inversor/regulador
  converterId?: number; // el elegido (para evaluar baterías)
  batteryIds?: number[];
  batteryQty?: number;
  extraIds?: number[]; // cables / protecciones
  systemVoltage?: number;
  tMinC?: number; // temperatura mínima del sitio, si el usuario la indica
}

const RULES_CACHE_MS = 60 * 1000;
const PRODUCTS_CACHE_MS = 60 * 1000; // el configurador pide en cada paso: sin esto, cada pedido iba a la base (~0,5 s)
const MAX_IDS = 100;

@Injectable()
export class CompatibilityService implements OnModuleInit {
  private readonly logger = new Logger(CompatibilityService.name);
  private cache: { rules: Rule[]; at: number } | null = null;
  private productsCache: { byId: Map<number, ProductLike>; at: number } | null = null;
  private rulesRefresh: Promise<Rule[]> | null = null;
  private productsRefresh: Promise<Map<number, ProductLike>> | null = null;

  constructor(private prisma: PrismaService) {}

  /** Al arrancar se cargan reglas y catálogo, así el primer visitante no espera a la base. */
  onModuleInit() {
    void this.refreshRules();
    this.refreshProducts().catch((err) => this.logger.warn(`No se pudo precargar el catálogo: ${(err as Error).message}`));
  }

  /** Reglas activas de la tabla; si la tabla no existe o está vacía, las reglas por defecto.
      Si la copia en memoria venció se devuelve igual y se renueva en segundo plano: solo
      se espera a la base la primera vez (o después de editar una regla). */
  async getRules(): Promise<Rule[]> {
    if (this.cache && Date.now() - this.cache.at < RULES_CACHE_MS) return this.cache.rules;
    if (this.cache) { void this.refreshRules(); return this.cache.rules; }
    return this.refreshRules();
  }

  private refreshRules(): Promise<Rule[]> {
    if (!this.rulesRefresh) this.rulesRefresh = this.loadRules().finally(() => { this.rulesRefresh = null; });
    return this.rulesRefresh;
  }

  private async loadRules(): Promise<Rule[]> {
    let rules: Rule[] = DEFAULT_RULES;
    try {
      const rows = await this.prisma.compatibilityRule.findMany({ where: { active: true }, orderBy: { priority: 'asc' } });
      if (rows.length) {
        rules = rows.map((r) => ({
          id: r.id, sourceCategory: r.sourceCategory, targetCategory: r.targetCategory, checkKey: r.checkKey,
          priority: r.priority, condition: r.condition as any, resultType: r.resultType as any, message: r.message, active: r.active,
        }));
      }
    } catch (err) {
      // típico antes de correr scripts/migrate.js: se avisa una línea y se reintenta cada 10 min
      const msg = (err as Error).message.split('\n').filter(Boolean).pop();
      this.logger.warn(`No se pudieron leer compatibility_rules (${msg}); se usan las reglas por defecto.`);
      this.cache = { rules, at: Date.now() + 9 * RULES_CACHE_MS };
      return rules;
    }
    this.cache = { rules, at: Date.now() };
    return rules;
  }

  // --- Administración de reglas ---
  listAll() {
    return this.prisma.compatibilityRule.findMany({ orderBy: [{ sourceCategory: 'asc' }, { targetCategory: 'asc' }, { priority: 'asc' }] });
  }

  async upsert(id: number | null, body: Partial<Rule>) {
    const data: any = {};
    if (body.sourceCategory !== undefined) data.sourceCategory = String(body.sourceCategory);
    if (body.targetCategory !== undefined) data.targetCategory = String(body.targetCategory);
    if (body.checkKey !== undefined) data.checkKey = String(body.checkKey);
    if (body.priority !== undefined) data.priority = Math.round(Number(body.priority));
    if (body.message !== undefined) data.message = String(body.message).slice(0, 500);
    if (body.active !== undefined) data.active = !!body.active;
    if (body.resultType !== undefined) {
      if (!['bad', 'warning', 'param'].includes(String(body.resultType))) throw new BadRequestException('result_type tiene que ser bad, warning o param.');
      data.resultType = body.resultType;
    }
    if (body.condition !== undefined) {
      const c: any = body.condition;
      const ops = ['>', '>=', '<', '<=', '!=', 'missing'];
      if (!c || typeof c !== 'object' || (c.op !== undefined && !ops.includes(c.op))) throw new BadRequestException(`condition.op tiene que ser uno de ${ops.join(' ')}.`);
      data.condition = c;
    }
    if (!id) {
      for (const k of ['sourceCategory', 'targetCategory', 'checkKey', 'condition', 'resultType']) {
        if (data[k] === undefined) throw new BadRequestException(`Falta ${k}.`);
      }
    }
    const saved = id
      ? await this.prisma.compatibilityRule.update({ where: { id }, data })
      : await this.prisma.compatibilityRule.create({ data });
    this.cache = null; // después de guardar: si no, una lectura en el medio volvía a cachear la regla vieja
    return saved;
  }

  /** Productos activos por id (con la categoría como slug), en memoria por PRODUCTS_CACHE_MS;
      vencida, se usa igual y se renueva en segundo plano (como las reglas). */
  private async getProductsById(): Promise<Map<number, ProductLike>> {
    const c = this.productsCache;
    if (c && Date.now() - c.at < PRODUCTS_CACHE_MS) return c.byId;
    if (c) {
      this.refreshProducts().catch((err) => this.logger.warn(`No se pudo renovar el catálogo en memoria: ${(err as Error).message}`));
      return c.byId;
    }
    return this.refreshProducts();
  }

  private refreshProducts(): Promise<Map<number, ProductLike>> {
    if (!this.productsRefresh) this.productsRefresh = this.loadProducts().finally(() => { this.productsRefresh = null; });
    return this.productsRefresh;
  }

  private async loadProducts(): Promise<Map<number, ProductLike>> {
    const rows = await this.prisma.product.findMany({ where: { active: true }, include: { category: true } });
    const byId = new Map<number, ProductLike>(rows.map((p) => [p.id, { id: p.id, name: p.name, category: p.category.slug, specs: (p.specs as any) || {} }]));
    this.productsCache = { byId, at: Date.now() };
    return byId;
  }

  async getPublicRules() {
    const rules = await this.getRules();
    return { params: paramsFromRules(rules), rules: rules.filter((r) => r.sourceCategory !== '_param') };
  }

  async evaluate(req: EvaluateRequest) {
    const qty = Math.round(Number(req?.panel?.qty));
    if (!req?.panel?.productId || !Number.isFinite(qty) || qty < 1 || qty > 500) {
      throw new BadRequestException('Falta el panel o la cantidad (1 a 500).');
    }
    const ids = (a?: number[]) => (Array.isArray(a) ? a.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, MAX_IDS) : []);
    const converterIds = ids(req.converterIds);
    const batteryIds = ids(req.batteryIds);
    const extraIds = ids(req.extraIds);
    const selected = Number(req.converterId) || null;
    const wiring = req.panel.wiring === 'parallel' ? 'parallel' : 'series';

    const [rules, byId] = await Promise.all([this.getRules(), this.getProductsById()]);
    const tMin = Number(req.tMinC);
    const params: Params = paramsFromRules(rules, Number.isFinite(tMin) && tMin >= -50 && tMin <= 30 ? { tMinC: tMin } : {});

    const panel = byId.get(Number(req.panel.productId));
    if (!panel || panel.category !== 'panel') throw new BadRequestException('El producto elegido como panel no existe o no es un panel.');

    const sv = Number(req.systemVoltage) || undefined;
    const converters: Record<number, Evaluation | null> = {};
    for (const id of converterIds) {
      const c = byId.get(id);
      if (c) converters[id] = evaluatePanelToConverter(rules, params, panel, qty, wiring, c, sv);
    }
    const batteries: Record<number, Evaluation | null> = {};
    const selectedConverter = selected ? byId.get(selected) : null;
    if (selectedConverter) {
      const bq = Math.max(1, Math.round(Number(req.batteryQty) || 1));
      for (const id of batteryIds) {
        const b = byId.get(id);
        if (b && b.category === 'bateria') batteries[id] = evaluateBatteryToConverter(rules, params, b, bq, selectedConverter, sv);
      }
    }
    const extras: Record<number, Evaluation | null> = {};
    for (const id of extraIds) {
      const x = byId.get(id);
      if (x) extras[id] = evaluateDcItem(rules, params, x, panel, qty, wiring);
    }
    return { params, converters, batteries, extras };
  }
}
