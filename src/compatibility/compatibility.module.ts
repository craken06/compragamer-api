import { Module } from '@nestjs/common';
import { CompatibilityController } from './compatibility.controller';
import { CompatibilityService } from './compatibility.service';

@Module({
  controllers: [CompatibilityController],
  providers: [CompatibilityService],
})
export class CompatibilityModule {}
