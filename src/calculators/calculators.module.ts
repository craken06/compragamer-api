import { Module } from '@nestjs/common';
import { CalculatorsController } from './calculators.controller';

@Module({ controllers: [CalculatorsController] })
export class CalculatorsModule {}
