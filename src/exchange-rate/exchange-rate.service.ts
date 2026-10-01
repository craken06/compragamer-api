import { Injectable, Logger } from '@nestjs/common';

export interface RateInfo {
  usdArs: number;
  source: 'manual' | 'dolarapi' | 'fallback';
  casa: string | null; // tipo de dólar usado (oficial, bolsa, blue...)
  updatedAt: string | null; // fecha de la cotización de origen
  stale: boolean; // true si es el último valor bueno y la fuente no respondió
}

const CACHE_MS = 30 * 60 * 1000; // 30 minutos
const FETCH_TIMEOUT_MS = 5000;
const VALID_CASAS = ['oficial', 'bolsa', 'contadoconliqui', 'blue', 'mayorista', 'tarjeta'];

/**
 * Cotización USD→ARS que usa el frontend para mostrar precios en la otra moneda.
 *
 * Prioridad:
 *  1. USD_ARS_RATE_OVERRIDE (valor fijo que decidís vos; sirve para congelar el precio)
 *  2. Cotización en vivo de dolarapi.com (precio "venta"), cacheada 30 min.
 *     Tipo de dólar configurable con USD_ARS_CASA (por defecto "oficial").
 *  3. Último valor bueno si la fuente deja de responder
 *  4. USD_ARS_FALLBACK_RATE (por defecto 1350) si nunca se pudo consultar
 */
@Injectable()
export class ExchangeRateService {
  private readonly logger = new Logger(ExchangeRateService.name);
  private cached: RateInfo | null = null;
  private cachedAt = 0;
  private inflight: Promise<RateInfo> | null = null;

  async getRate(): Promise<RateInfo> {
    const override = Number(process.env.USD_ARS_RATE_OVERRIDE);
    if (Number.isFinite(override) && override > 0) {
      return { usdArs: override, source: 'manual', casa: null, updatedAt: null, stale: false };
    }

    if (this.cached && Date.now() - this.cachedAt < CACHE_MS) return this.cached;

    // varias requests simultáneas comparten una sola consulta a la fuente
    if (!this.inflight) {
      this.inflight = this.refresh().finally(() => { this.inflight = null; });
    }
    return this.inflight;
  }

  private async refresh(): Promise<RateInfo> {
    const casaEnv = (process.env.USD_ARS_CASA || 'oficial').toLowerCase();
    const casa = VALID_CASAS.includes(casaEnv) ? casaEnv : 'oficial';
    try {
      const res = await fetch(`https://dolarapi.com/v1/dolares/${casa}`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`dolarapi respondió ${res.status}`);
      const data: any = await res.json();
      const venta = Number(data?.venta);
      if (!Number.isFinite(venta) || venta <= 0) throw new Error('cotización inválida');

      this.cached = { usdArs: venta, source: 'dolarapi', casa, updatedAt: data.fechaActualizacion ?? null, stale: false };
      this.cachedAt = Date.now();
      return this.cached;
    } catch (err) {
      this.logger.warn(`No se pudo consultar la cotización: ${(err as Error).message}`);
      if (this.cached) {
        // se reintenta en 1 minuto, no en cada request
        this.cachedAt = Date.now() - CACHE_MS + 60 * 1000;
        return { ...this.cached, stale: true };
      }
      const fallback = Number(process.env.USD_ARS_FALLBACK_RATE);
      return {
        usdArs: Number.isFinite(fallback) && fallback > 0 ? fallback : 1350,
        source: 'fallback', casa: null, updatedAt: null, stale: true,
      };
    }
  }
}
