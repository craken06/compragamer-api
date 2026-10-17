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

// Campos que el admin puede escribir. El body nunca se esparce entero en Prisma: así no se cuelan
// id, createdAt ni escrituras anidadas (images: { create: ... }) que saltean las validaciones.
const WRITABLE = ['brand', 'name', 'sku', 'price', 'currency', 'stockStatus', 'description', 'specs', 'datasheetUrl', 'active'] as const;
const SCALAR_TYPES: Record<string, string[]> = {
  brand: ['string'], name: ['string'], sku: ['string'], price: ['number', 'string'], currency: ['string'],
  stockStatus: ['string'], description: ['string'], datasheetUrl: ['string'], active: ['boolean'],
};

/** Arma el data de Prisma solo con los campos permitidos y con el tipo esperado (null borra los opcionales). */
export function productData(dto: Record<string, any>): Record<string, any> {
  const data: Record<string, any> = {};
  for (const k of WRITABLE) {
    const v = dto?.[k];
    if (v === undefined) continue;
    if (k === 'specs') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new BadRequestException('specs tiene que ser un objeto JSON.');
    } else if (v !== null && !SCALAR_TYPES[k].includes(typeof v)) {
      throw new BadRequestException(`El campo ${k} tiene un tipo inválido.`);
    }
    data[k] = v;
  }
  // el link se muestra en la tienda: solo http(s), nada de javascript: ni data:
  if (typeof data.datasheetUrl === 'string' && data.datasheetUrl && !/^https?:\/\/\S+$/i.test(data.datasheetUrl.trim())) {
    throw new BadRequestException('datasheetUrl tiene que ser una URL http(s).');
  }
  return data;
}

function categoryIdOf(v: unknown): number {
  const id = Number(v);
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestException('categoryId inválido.');
  return id;
}

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
    return this.productsService.create({
      ...(productData(dto) as any),
      category: { connect: { id: categoryIdOf(dto?.categoryId) } },
    });
  }

  @Put(':id')
  @UseGuards(AdminKeyGuard)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, {
      ...productData(dto),
      ...(dto?.categoryId ? { category: { connect: { id: categoryIdOf(dto.categoryId) } } } : {}),
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
