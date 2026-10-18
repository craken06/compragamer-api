import { Module } from '@nestjs/common';
import { ExchangeRateModule } from '../exchange-rate/exchange-rate.module';
import { SizerController } from './sizer.controller';
import { SizerService } from './sizer.service';

@Module({
  imports: [ExchangeRateModule],
  controllers: [SizerController],
  providers: [SizerService],
})
export class SizerModule {}
