import { HttpException, HttpStatus } from '@nestjs/common';

const MAX_KEYS = 10000;

/**
 * Límite simple de requests por clave (IP) en una ventana de tiempo, en memoria.
 * Alcanza para una sola instancia del servidor; frena el spam de formularios públicos.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private lastPrune = 0;

  constructor(private readonly max: number, private readonly windowMs: number, private readonly message: string) {}

  check(key: string, now = Date.now()) {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) throw new HttpException(this.message, HttpStatus.TOO_MANY_REQUESTS);
    recent.push(now);
    this.hits.set(key, recent);
    // tope de memoria: se borran solo las claves sin requests en la ventana. Un clear() total
    // reseteaba los límites de todos y dejaba pasar el spam de nuevo llenando el mapa con IPs.
    // Como mucho una vez por segundo, para no recorrer el mapa en cada request durante un ataque.
    if (this.hits.size > MAX_KEYS && now - this.lastPrune >= 1000) {
      this.lastPrune = now;
      for (const [k, ts] of this.hits) if (!ts.some((t) => now - t < this.windowMs)) this.hits.delete(k);
    }
  }
}
