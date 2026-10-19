import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { ProductsController, productData } from '../src/products/products.controller';

// Servicio falso: guarda lo que le llegaría a Prisma.
function fakeService() {
  const calls: any[] = [];
  return { calls, create: async (data: any) => { calls.push(data); return data; }, update: async (id: number, data: any) => { calls.push({ id, data }); return data; } };
}
const body = { categoryId: 1, brand: 'Canadian Solar', name: 'CS6R-550MS', price: 185000, specs: { voc: 49.5 }, datasheetUrl: 'https://x.com/d.pdf' };

test('crear producto: solo pasan los campos permitidos (sin id, createdAt ni escrituras anidadas)', async () => {
  const svc = fakeService();
  await new ProductsController(svc as any).create({
    ...body, id: 999, createdAt: '2000-01-01', images: { create: [{ url: 'javascript:alert(1)' }] }, category: { create: { name: 'x' } },
  } as any);
  assert.deepEqual(svc.calls[0], {
    brand: 'Canadian Solar', name: 'CS6R-550MS', price: 185000, specs: { voc: 49.5 }, datasheetUrl: 'https://x.com/d.pdf',
    category: { connect: { id: 1 } },
  });
});

test('editar producto: whitelist, active y categoryId opcional; null borra un opcional', async () => {
  const svc = fakeService();
  const ctrl = new ProductsController(svc as any);
  await ctrl.update(5, { active: false, showInStore: false, sku: null, images: { deleteMany: {} }, updatedAt: 'x' } as any);
  assert.deepEqual(svc.calls[0], { id: 5, data: { active: false, showInStore: false, sku: null } });
  await ctrl.update(5, { categoryId: 3, price: '100.50' } as any);
  assert.deepEqual(svc.calls[1].data, { price: '100.50', category: { connect: { id: 3 } } });
});

test('producto: tipos inválidos, datasheetUrl no http(s) y categoryId inválido -> 400', async () => {
  const ctrl = new ProductsController(fakeService() as any);
  assert.throws(() => productData({ name: { set: 'x' } }), BadRequestException);
  assert.throws(() => productData({ specs: [1, 2] }), BadRequestException);
  assert.throws(() => productData({ specs: 'texto' }), BadRequestException);
  assert.throws(() => productData({ active: 'false' }), BadRequestException);
  assert.throws(() => productData({ showInStore: 'false' }), BadRequestException);
  assert.throws(() => productData({ datasheetUrl: 'javascript:alert(1)' }), BadRequestException);
  assert.equal(productData({ datasheetUrl: 'http://viejo.com/d.pdf' }).datasheetUrl, 'http://viejo.com/d.pdf');
  assert.throws(() => ctrl.create({ ...body, categoryId: 'abc' } as any), BadRequestException);
  assert.throws(() => ctrl.create({ ...body, categoryId: { connect: { id: 1 } } } as any), BadRequestException);
});
