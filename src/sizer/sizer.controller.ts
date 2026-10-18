import { Body, Controller, HttpCode, Ip, Post } from '@nestjs/common';
import { RateLimiter } from '../common/rate-limit';
import { SizerRequest, SizerService } from './sizer.service';

@Controller('sizer')
export class SizerController {
  // el formulario consulta al dejar de tipear: un tope amplio por IP frena una inundación
  private limiter = new RateLimiter(120, 60 * 1000, 'Demasiadas consultas seguidas. Probá de nuevo en un minuto.');

  constructor(private readonly sizer: SizerService) {}

  // POST /sizer -> sistema dimensionado con el catálogo de la base (rápido o personalizado)
  @Post()
  @HttpCode(200)
  evaluate(@Body() body: SizerRequest, @Ip() ip?: string) {
    this.limiter.check(ip ?? '');
    return this.sizer.evaluate(body);
  }
}
