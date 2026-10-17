import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { ExchangeRateModule } from '../exchange-rate/exchange-rate.module';
import { MercadoPagoClient } from './mercadopago.client';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [ExchangeRateModule, CustomersModule],
  controllers: [OrdersController],
  providers: [OrdersService, MercadoPagoClient],
})
export class OrdersModule {}
