import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { MailModule } from '../mail/mail.module';
import { OrdersModule } from '../orders/orders.module';
import { StorageModule } from '../storage/storage.module';
import { CoursesAdminController } from './courses-admin.controller';
import { CoursesAdminService } from './courses-admin.service';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';
import { VideoService } from './video';

@Module({
  // OrdersModule exporta MercadoPagoClient y PaymentRouter (el webhook de MP es uno solo)
  imports: [CustomersModule, MailModule, OrdersModule, StorageModule],
  controllers: [CoursesController, CoursesAdminController],
  providers: [CoursesService, CoursesAdminService, VideoService],
})
export class CoursesModule {}
