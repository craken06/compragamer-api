import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Appliance, consumption, cost, orientation, savings } from './calculators';

// Las calculadoras no tocan la base: son funciones puras expuestas por HTTP.
@Controller('calculators')
export class CalculatorsController {
  @Post('consumption')
  @HttpCode(200)
  consumption(@Body() body: { items: Appliance[] }) {
    return consumption(body?.items);
  }

  @Post('cost')
  @HttpCode(200)
  cost(@Body() body: { kwh: number; pricePerKwh: number }) {
    return cost(body?.kwh, body?.pricePerKwh);
  }

  @Post('savings')
  @HttpCode(200)
  savings(@Body() body: { currentKwh: number; solarKwh: number; energyPrice: number }) {
    return savings(body?.currentKwh, body?.solarKwh, body?.energyPrice);
  }

  @Post('orientation')
  @HttpCode(200)
  orientation(@Body() body: { lat: number }) {
    return orientation(body?.lat);
  }
}
