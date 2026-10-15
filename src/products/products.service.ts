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

  // Administración: incluye inactivos.
  findAllAdmin() {
    return this.prisma.product.findMany({
      include: { category: true, images: { orderBy: { order: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addImage(productId: number, url: string, altText: string | undefined, order: number) {
    await this.findOne(productId, true);
    return this.prisma.productImage.create({ data: { productId, url, altText: altText?.slice(0, 200) || null, order } });
  }

  async removeImage(productId: number, imageId: number) {
    const img = await this.prisma.productImage.findFirst({ where: { id: imageId, productId } });
    if (!img) throw new NotFoundException(`Imagen ${imageId} no encontrada en el producto ${productId}`);
    return this.prisma.productImage.delete({ where: { id: imageId } });
  }

  /**
   * Productos con specs incompletos: faltan campos "required" del spec_schema de su
   * categoría o, para lo que entra al configurador, los campos que usa el motor de compatibilidad.
   */
  async findIncomplete() {
    const products = await this.prisma.product.findMany({ where: { active: true }, include: { category: true }, orderBy: { id: 'asc' } });
    const ENGINE_FIELDS: Record<string, string[]> = {
      panel: ['voc', 'isc', 'vmp', 'imp', 'coef_temp_voc'],
      inversor: ['systemTypes', 'maxPvVoltage', 'mpptRangeMin', 'mpptRangeMax', 'maxInputCurrentPerMppt', 'maxShortCircuitCurrentPerMppt', 'maxPvPower', 'ratedPowerAC'],
      regulador: ['systemTypes', 'maxPvVoltage', 'ratedChargeCurrent', 'systemVoltageOptions', 'maxPvPowerBySystemVoltage'],
      bateria: ['nominalVoltage', 'maxContinuousCurrent'],
      cable: ['tipo'],
    };
    const empty = (v: any) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    return products
      .map((p) => {
        const specs: any = p.specs || {};
        const schema: any = p.category.specSchema || {};
        const required: string[] = Array.isArray(schema.required) ? schema.required : [];
        const engine = ENGINE_FIELDS[p.category.slug] ?? [];
        // un microinversor o un equipo excluido a propósito (systemTypes vacío) no necesita los campos de string
        const isMicro = specs.es_microinversor === true;
        const missingRequired = required.filter((k) => empty(specs[k]));
        const missingEngine = engine.filter((k) => empty(specs[k]) && !(isMicro && k === 'mpptRangeMin'));
        return {
          id: p.id, brand: p.brand, name: p.name, category: p.category.slug,
          missingRequired, missingEngine,
        };
      })
      .filter((r) => r.missingRequired.length || r.missingEngine.length);
  }

  removeAll() {
    return this.prisma.product.deleteMany({});
  }
}
