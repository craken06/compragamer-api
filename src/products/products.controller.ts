import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  // Lectura pública: solo devuelve productos activos.
  // GET /products             -> todos
  // GET /products?categoryId=2 -> filtrados por categoría
  @Get()
  findAll(@Query('categoryId') categoryId?: string) {
    return this.productsService.findAll(categoryId ? Number(categoryId) : undefined);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.findOne(id);
  }

  // --- Escritura: requiere el token de admin (ver AdminKeyGuard) ---
  @Post()
  @UseGuards(AdminKeyGuard)
  create(@Body() dto: CreateProductDto) {
    const { categoryId, ...rest } = dto;
    return this.productsService.create({
      ...rest,
      category: { connect: { id: categoryId } },
    });
  }

  @Put(':id')
  @UseGuards(AdminKeyGuard)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProductDto) {
    const { categoryId, ...rest } = dto;
    return this.productsService.update(id, {
      ...rest,
      ...(categoryId ? { category: { connect: { id: categoryId } } } : {}),
    });
  }

  // --- Imágenes (tabla product_images): URL pública + texto alternativo + orden ---
  @Post(':id/images')
  @UseGuards(AdminKeyGuard)
  addImage(@Param('id', ParseIntPipe) id: number, @Body() body: { url: string; altText?: string; order?: number }) {
    const url = String(body?.url ?? '').trim();
    if (!/^https:\/\/\S+$/i.test(url)) throw new BadRequestException('La imagen tiene que ser una URL https.');
    return this.productsService.addImage(id, url, body?.altText, Number(body?.order) || 0);
  }

  @Delete(':id/images/:imageId')
  @UseGuards(AdminKeyGuard)
  removeImage(@Param('id', ParseIntPipe) id: number, @Param('imageId', ParseIntPipe) imageId: number) {
    return this.productsService.removeImage(id, imageId);
  }

  // OJO: esta ruta ('all') tiene que ir ANTES de ':id',
  // sino Nest interpreta "all" como un id y explota
  @Delete('all')
  @UseGuards(AdminKeyGuard)
  removeAll(@Query('confirm') confirm?: string) {
    if (confirm !== 'yes') {
      throw new BadRequestException('Esto borra TODOS los productos. Para confirmarlo agregá ?confirm=yes');
    }
    return this.productsService.removeAll();
  }

  @Delete(':id')
  @UseGuards(AdminKeyGuard)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.remove(id);
  }
}
