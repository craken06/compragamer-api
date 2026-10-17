import { Body, Controller, HttpCode, Ip, Post } from '@nestjs/common';
import { RateLimiter } from '../common/rate-limit';
import { Appliance, consumption, cost, orientation, savings } from './calculators';

// Las calculadoras no tocan la base: son funciones puras expuestas por HTTP.
@Controller('calculators')
export class CalculatorsController {
  // son baratas, pero igual consumen horas del servidor: un tope amplio por IP frena una inundación
  private limiter = new RateLimiter(300, 60 * 1000, 'Demasiadas consultas seguidas. Probá de nuevo en un minuto.');

  @Post('consumption')
  @HttpCode(200)
  consumption(@Body() body: { items: Appliance[] }, @Ip() ip?: string) {
    this.limiter.check(ip ?? '');
    return consumption(body?.items);
  }

  @Post('cost')
  @HttpCode(200)
  cost(@Body() body: { kwh: number; pricePerKwh: number }, @Ip() ip?: string) {
    this.limiter.check(ip ?? '');
    return cost(body?.kwh, body?.pricePerKwh);
  }

  @Post('savings')
  @HttpCode(200)
  savings(@Body() body: { currentKwh: number; solarKwh: number; energyPrice: number }, @Ip() ip?: string) {
    this.limiter.check(ip ?? '');
    return savings(body?.currentKwh, body?.solarKwh, body?.energyPrice);
  }

  @Post('orientation')
  @HttpCode(200)
  orientation(@Body() body: { lat: number }, @Ip() ip?: string) {
    this.limiter.check(ip ?? '');
    return orientation(body?.lat);
  }
}
