import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { ProductsService } from './products.service';

@Controller('admin/products')
@UseGuards(AdminKeyGuard)
export class AdminProductsController {
  constructor(private readonly productsService: ProductsService) {}

  // GET /admin/products -> todos, incluidos los inactivos
  @Get()
  findAll() {
    return this.productsService.findAllAdmin();
  }

  // GET /admin/products/incomplete -> productos con specs faltantes (para completar desde el admin)
  @Get('incomplete')
  incomplete() {
    return this.productsService.findIncomplete();
  }
}
