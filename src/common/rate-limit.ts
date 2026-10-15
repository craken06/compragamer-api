import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Límite simple de requests por clave (IP) en una ventana de tiempo, en memoria.
 * Alcanza para una sola instancia del servidor; frena el spam de formularios públicos.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private readonly max: number, private readonly windowMs: number, private readonly message: string) {}

  check(key: string) {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) throw new HttpException(this.message, HttpStatus.TOO_MANY_REQUESTS);
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10000) this.hits.clear(); // tope de memoria
  }
}
