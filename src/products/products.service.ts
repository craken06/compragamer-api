import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  findAll(categoryId?: number) {
    return this.prisma.product.findMany({
      where: { active: true, ...(categoryId ? { categoryId } : {}) },
      include: { category: true, images: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Lectura pública: los productos desactivados (active = false) se tratan como inexistentes.
  // Las operaciones de administración (update/remove) usan includeInactive para poder tocarlos igual.
  async findOne(id: number, includeInactive = false) {
    const product = await this.prisma.product.findFirst({
      where: { id, ...(includeInactive ? {} : { active: true }) },
      include: { category: true, images: true },
    });
    if (!product) throw new NotFoundException(`Producto ${id} no encontrado`);
    return product;
  }

  create(data: Prisma.ProductCreateInput) {
    return this.prisma.product.create({ data });
  }

  async update(id: number, data: Prisma.ProductUpdateInput) {
    await this.findOne(id, true); // lanza 404 si no existe
    return this.prisma.product.update({ where: { id }, data });
  }

  async remove(id: number) {
    await this.findOne(id, true); // lanza 404 si no existe
    return this.prisma.product.delete({ where: { id } });
  }

  removeAll() {
    return this.prisma.product.deleteMany({});
  }
}
