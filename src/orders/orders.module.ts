import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { ExchangeRateModule } from '../exchange-rate/exchange-rate.module';
import { MailModule } from '../mail/mail.module';
import { StorageModule } from '../storage/storage.module';
import { MercadoPagoClient } from './mercadopago.client';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [ExchangeRateModule, CustomersModule, MailModule, StorageModule],
  controllers: [OrdersController],
  providers: [OrdersService, MercadoPagoClient],
  exports: [OrdersService, MercadoPagoClient],
})
export class OrdersModule {}
