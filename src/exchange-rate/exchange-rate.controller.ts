import { Controller, Get } from '@nestjs/common';
import { ExchangeRateService } from './exchange-rate.service';

@Controller('exchange-rate')
export class ExchangeRateController {
  constructor(private readonly exchangeRate: ExchangeRateService) {}

  // GET /exchange-rate -> { usdArs, source, casa, updatedAt, stale }
  @Get()
  get() {
    return this.exchangeRate.getRate();
  }
}
