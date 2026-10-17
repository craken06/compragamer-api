import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { CategoriesModule } from './categories/categories.module';
import { ProductsModule } from './products/products.module';
import { ExchangeRateModule } from './exchange-rate/exchange-rate.module';
import { CompatibilityModule } from './compatibility/compatibility.module';
import { CalculatorsModule } from './calculators/calculators.module';
import { AuthModule } from './auth/auth.module';
import { OrdersModule } from './orders/orders.module';
import { ContactModule } from './contact/contact.module';
import { CustomersModule } from './customers/customers.module';

@Module({
  imports: [
    PrismaModule, CategoriesModule, ProductsModule, ExchangeRateModule,
    CompatibilityModule, CalculatorsModule, AuthModule, OrdersModule, ContactModule, CustomersModule,
  ],
})
export class AppModule {}
