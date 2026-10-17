import { Module } from '@nestjs/common';
import { CustomerAuthController, GOOGLE_VERIFIER, createGoogleVerifier } from './customer-auth.controller';
import { CustomerGuard } from './customer.guard';
import { CustomersService } from './customers.service';
import { MeController } from './me.controller';

@Module({
  controllers: [CustomerAuthController, MeController],
  providers: [CustomersService, CustomerGuard, { provide: GOOGLE_VERIFIER, useFactory: createGoogleVerifier }],
  exports: [CustomersService, CustomerGuard],
})
export class CustomersModule {}
