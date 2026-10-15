/*
 * Pedidos y webhook de Mercado Pago con base y MP SIMULADOS (sin red ni Neon).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import { OrdersService } from '../src/orders/orders.service';
import { MercadoPagoClient } from '../src/orders/mercadopago.client';

function fakePrisma(products: any[]) {
  const orders: any[] = [];
  return {
    orders,
    product: { findMany: async ({ where }: any) => products.filter((p) => where.id.in.includes(p.id) && p.active) },
    order: {
      create: async ({ data }: any) => { const o = { id: orders.length + 1, ...data, items: data.items.create }; orders.push(o); return o; },
      update: async ({ where, data }: any) => Object.assign(orders.find((o) => o.id === where.id), data),
      findUnique: async ({ where }: any) => orders.find((o) => o.publicId === where.publicId) ?? null,
    },
  };
}
const rates: any = { getRate: async () => ({ usdArs: 1000 }) };
const products = [
  { id: 1, brand: 'Jinko', name: 'Panel', price: '100000', currency: 'ARS', stockStatus: 'disponible', active: true },
  { id: 2, brand: 'Huawei', name: 'Inversor', price: '800', currency: 'USD', stockStatus: 'disponible', active: true },
  { id: 3, brand: 'X', name: 'Agotado', price: '10', currency: 'ARS', stockStatus: 'sin_stock', active: true },
];
const customer = { name: 'Ana', email: 'ana@example.com' };

function fakeMp(payment?: any) {
  const calls: any[] = [];
  const mp: any = {
    enabled: true, calls,
    createPreference: async (o: any) => { calls.push(o); return { id: 'pref-1', init_point: 'https://mp.test/checkout' }; },
    getPayment: async () => payment,
  };
  return mp;
}

test('pedido: precios del servidor (USD × cotización), ignora precios del cliente, agrupa cantidades', async () => {
  const db = fakePrisma(products), mp = fakeMp();
  const svc = new OrdersService(db as any, rates, mp);
  const r = await svc.create({ customer, items: [{ productId: 1, qty: 2 }, { productId: 2, qty: 1 }, { productId: 1, qty: 1, price: 1 } as any] });
  assert.equal(r.totalArs, 3 * 100000 + 800 * 1000);
  assert.equal(r.paymentUrl, 'https://mp.test/checkout');
  assert.equal(db.orders[0].status, 'pendiente_pago');
  assert.equal(mp.calls[0].items.find((i: any) => i.id === '2').unit_price, 800000);
  assert.equal(db.orders[0].mpPreferenceId, 'pref-1');
});

test('pedido: validaciones', async () => {
  const svc = new OrdersService(fakePrisma(products) as any, rates, fakeMp());
  await assert.rejects(svc.create({ customer: { name: 'A', email: 'x' }, items: [{ productId: 1, qty: 1 }] }));
  await assert.rejects(svc.create({ customer, items: [] }));
  await assert.rejects(svc.create({ customer, items: [{ productId: 1, qty: 0 }] }));
  await assert.rejects(svc.create({ customer, items: [{ productId: 99, qty: 1 }] }), /ya no está disponible/);
  await assert.rejects(svc.create({ customer, items: [{ productId: 3, qty: 1 }] }), /Sin stock/);
});

test('sin MP configurado o modo cotización: se guarda como cotización, sin link de pago', async () => {
  const db = fakePrisma(products), mp = fakeMp(); mp.enabled = false;
  const r = await new OrdersService(db as any, rates, mp).create({ customer, items: [{ productId: 1, qty: 1 }] });
  assert.equal(r.paymentUrl, null);
  assert.equal(db.orders[0].status, 'cotizacion');
});

test('webhook: aprobado por el total -> pagado; monto menor -> queda pendiente; pagado no retrocede', async () => {
  const db = fakePrisma(products);
  const svc0 = new OrdersService(db as any, rates, fakeMp());
  const { publicId } = await svc0.create({ customer, items: [{ productId: 1, qty: 1 }] });

  const low = new OrdersService(db as any, rates, fakeMp({ id: 5, status: 'approved', external_reference: publicId, transaction_amount: 10, currency_id: 'ARS' }));
  assert.equal((await low.handlePaymentNotification('5')).status, 'pendiente_pago');

  const ok = new OrdersService(db as any, rates, fakeMp({ id: 6, status: 'approved', external_reference: publicId, transaction_amount: 100000, currency_id: 'ARS' }));
  assert.equal((await ok.handlePaymentNotification('6')).status, 'pagado');

  const late = new OrdersService(db as any, rates, fakeMp({ id: 7, status: 'pending', external_reference: publicId, transaction_amount: 100000, currency_id: 'ARS' }));
  assert.equal((await late.handlePaymentNotification('7')).status, 'pagado');

  const unknown = new OrdersService(db as any, rates, fakeMp({ id: 8, status: 'approved', external_reference: 'no-existe' }));
  assert.deepEqual(await unknown.handlePaymentNotification('8'), { ignored: 'pedido inexistente' });
});

test('firma del webhook de Mercado Pago', () => {
  const mp = new MercadoPagoClient();
  const prev = process.env.MP_WEBHOOK_SECRET;
  process.env.MP_WEBHOOK_SECRET = 'secreto';
  const ts = '1700000000';
  const v1 = createHmac('sha256', 'secreto').update(`id:123;request-id:req-1;ts:${ts};`).digest('hex');
  assert.equal(mp.verifySignature(`ts=${ts},v1=${v1}`, 'req-1', '123'), true);
  assert.equal(mp.verifySignature(`ts=${ts},v1=${v1}`, 'req-2', '123'), false);
  assert.equal(mp.verifySignature(undefined, 'req-1', '123'), false);
  delete process.env.MP_WEBHOOK_SECRET;
  assert.equal(mp.verifySignature(undefined, undefined, '123'), true);
  if (prev) process.env.MP_WEBHOOK_SECRET = prev;
});
