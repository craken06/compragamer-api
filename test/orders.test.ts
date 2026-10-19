/*
 * Pedidos y webhook de Mercado Pago con base y MP SIMULADOS (sin red ni Neon).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import { OrdersService } from '../src/orders/orders.service';
import { OrdersController } from '../src/orders/orders.controller';
import { MercadoPagoClient } from '../src/orders/mercadopago.client';
import { ORDER_CODE_RE } from '../src/orders/order-code';
import { CustomerGuard } from '../src/customers/customer.guard';
import { issueToken } from '../src/auth/token';

// Evalúa el subconjunto de `where` que usa el servicio: igualdad, { not }, { contains, mode }.
function matches(o: any, where: any = {}): boolean {
  return Object.entries(where).every(([k, cond]: [string, any]) => {
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('not' in cond) return o[k] !== cond.not;
      if ('contains' in cond) {
        const v = String(o[k] ?? ''), c = String(cond.contains);
        return cond.mode === 'insensitive' ? v.toLowerCase().includes(c.toLowerCase()) : v.includes(c);
      }
      if ('in' in cond) return cond.in.includes(o[k]);
    }
    return o[k] === cond;
  });
}

function fakePrisma(products: any[], customers: any[] = []) {
  const orders: any[] = [];
  return {
    orders, customers,
    lastFindMany: null as any,
    product: { findMany: async ({ where: { id, ...rest } }: any) => products.filter((p) => id.in.includes(p.id) && Object.entries(rest).every(([k, v]) => p[k] === v)) },
    customer: { findUnique: async ({ where }: any) => customers.find((c) => c.id === where.id) ?? null },
    order: {
      create: async ({ data }: any) => {
        const o = { id: orders.length + 1, customerId: null, fulfillmentStatus: 'pendiente', trackingNumber: null, paymentUrl: null, createdAt: new Date(Date.now() + orders.length), ...data, items: data.items.create };
        orders.push(o); return o;
      },
      update: async ({ where, data }: any) => Object.assign(orders.find((o) => o.id === where.id), data),
      findUnique: async ({ where }: any) => orders.find((o) => matches(o, where)) ?? null,
      findMany: async function (this: any, args: any) {
        (this as any).last = args;
        let r = orders.filter((o) => matches(o, args?.where));
        if (args?.orderBy?.createdAt === 'desc') r = [...r].sort((a, b) => b.createdAt - a.createdAt);
        return r.slice(0, args?.take ?? r.length);
      },
    },
  };
}
const rates: any = { getRate: async () => ({ usdArs: 1000 }) };
const products = [
  { id: 1, brand: 'Jinko', name: 'Panel', price: '100000', currency: 'ARS', stockStatus: 'disponible', active: true, showInStore: true },
  { id: 2, brand: 'Huawei', name: 'Inversor', price: '800', currency: 'USD', stockStatus: 'disponible', active: true, showInStore: true },
  { id: 3, brand: 'X', name: 'Agotado', price: '10', currency: 'ARS', stockStatus: 'sin_stock', active: true, showInStore: true },
  { id: 4, brand: 'Y', name: 'Oculto en la tienda', price: '10', currency: 'ARS', stockStatus: 'disponible', active: true, showInStore: false },
  { id: 5, brand: 'Z', name: 'Desactivado', price: '10', currency: 'ARS', stockStatus: 'disponible', active: false, showInStore: true },
];
const ana = { id: 7, name: 'Ana Pérez', email: 'ana@example.com' };
const address = { street: 'Av. Siempreviva 742', floor: '3B', city: 'Rosario', province: 'Santa Fe', zip: '2000' };
const base = { phone: '+54 9 341 555-1234', delivery: { method: 'retiro' as const } };

function fakeMp(payment?: any) {
  const calls: any[] = [];
  const mp: any = {
    enabled: true, calls,
    createPreference: async (o: any) => { calls.push(o); return { id: 'pref-1', init_point: 'https://mp.test/checkout' }; },
    getPayment: async () => payment,
  };
  return mp;
}
function fakeCustomers() {
  const calls: any[] = [];
  return { calls, updateMe: async (id: number, body: any) => { calls.push({ id, body }); return {}; } };
}
const svcOf = (db: any, mp = fakeMp(), customers: any = fakeCustomers()) => new OrdersService(db, rates, mp, customers);

test('pedido: precios del servidor (USD × cotización), ignora precios del cliente, agrupa cantidades', async () => {
  const db = fakePrisma(products), mp = fakeMp();
  const r = await svcOf(db, mp).create(ana, { ...base, items: [{ productId: 1, qty: 2 }, { productId: 2, qty: 1 }, { productId: 1, qty: 1, price: 1 } as any] });
  assert.equal(r.totalArs, 3 * 100000 + 800 * 1000);
  assert.equal(r.paymentUrl, 'https://mp.test/checkout');
  assert.equal(db.orders[0].status, 'pendiente_pago');
  assert.equal(mp.calls[0].items.find((i: any) => i.id === '2').unit_price, 800000);
  assert.equal(db.orders[0].mpPreferenceId, 'pref-1');
});

test('pedido: código AX-, cliente, envío con dirección normalizada, paymentUrl y referencia a MP', async () => {
  const prev = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = 'https://auryx.test/';
  try {
    const db = fakePrisma(products), mp = fakeMp();
    const r = await svcOf(db, mp).create(ana, {
      items: [{ productId: 1, qty: 1 }], phone: '(0341) 555-1234',
      delivery: { method: 'envio', address: { ...address, street: '  Av. Siempreviva 742 ', zip: '2000' } },
      billing: { doc: '20-12345678-6', name: 'Ana Pérez' },
    });
    const o = db.orders[0];
    assert.match(r.code, ORDER_CODE_RE);
    assert.equal(o.code, r.code);
    assert.equal(o.customerId, 7);
    assert.equal(o.deliveryMethod, 'envio');
    assert.deepEqual(o.shippingAddress, { street: 'Av. Siempreviva 742', floor: '3B', city: 'Rosario', province: 'Santa Fe', zip: '2000' });
    assert.equal(o.customerPhone, '03415551234');
    assert.equal(o.billingDoc, '20123456786');
    assert.equal(o.billingName, 'Ana Pérez');
    assert.equal(o.paymentUrl, 'https://mp.test/checkout');
    assert.equal(mp.calls[0].externalReference, r.code);
    assert.equal(mp.calls[0].backUrl, `https://auryx.test/pedido/${r.code}/`);
    assert.ok(mp.calls[0].backUrl.endsWith(`/pedido/${r.code}/`));
    assert.deepEqual(Object.keys(r).sort(), ['code', 'paymentUrl', 'status', 'totalArs']);
  } finally {
    if (prev === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = prev;
  }
});

test('pedido: nombre y email salen de la cuenta aunque el cuerpo traiga otros', async () => {
  const db = fakePrisma(products), mp = fakeMp();
  await svcOf(db, mp).create(ana, { ...base, items: [{ productId: 1, qty: 1 }], customer: { name: 'Otro', email: 'otro@x.com' } } as any);
  assert.equal(db.orders[0].customerName, 'Ana Pérez');
  assert.equal(db.orders[0].customerEmail, 'ana@example.com');
  assert.equal(mp.calls[0].payerEmail, 'ana@example.com');
});

test('pedido: retiro sin dirección OK; envío sin dirección 400; teléfono inválido 400; método inválido 400', async () => {
  const db = fakePrisma(products);
  const svc = svcOf(db);
  await svc.create(ana, { ...base, items: [{ productId: 1, qty: 1 }] });
  assert.equal(db.orders[0].deliveryMethod, 'retiro');
  assert.equal(db.orders[0].shippingAddress, undefined);
  await assert.rejects(svc.create(ana, { ...base, delivery: { method: 'envio' }, items: [{ productId: 1, qty: 1 }] }), { name: 'BadRequestException' });
  await assert.rejects(svc.create(ana, { ...base, phone: '123', items: [{ productId: 1, qty: 1 }] }), { name: 'BadRequestException', message: /teléfono/ });
  await assert.rejects(svc.create(ana, { ...base, phone: undefined as any, items: [{ productId: 1, qty: 1 }] }), { name: 'BadRequestException' });
  await assert.rejects(svc.create(ana, { ...base, delivery: { method: 'moto' } as any, items: [{ productId: 1, qty: 1 }] }), { name: 'BadRequestException' });
  await assert.rejects(svc.create(ana, { ...base, delivery: undefined as any, items: [{ productId: 1, qty: 1 }] }), { name: 'BadRequestException' });
  await assert.rejects(svc.create(ana, { ...base, billing: { doc: '20-12345678-0', name: 'Ana' }, items: [{ productId: 1, qty: 1 }] }), /CUIT/);
  assert.equal(db.orders.length, 1);
});

test('pedido: saveDetails true actualiza al cliente; false no', async () => {
  const customers = fakeCustomers();
  const svc = svcOf(fakePrisma(products), fakeMp(), customers);
  await svc.create(ana, { ...base, items: [{ productId: 1, qty: 1 }], saveDetails: false });
  assert.equal(customers.calls.length, 0);
  await svc.create(ana, {
    items: [{ productId: 1, qty: 1 }], phone: '341 555 1234', saveDetails: true,
    delivery: { method: 'envio', address }, billing: { doc: '12.345.678', name: 'Ana Pérez' },
  });
  assert.equal(customers.calls.length, 1);
  assert.equal(customers.calls[0].id, 7);
  assert.equal(customers.calls[0].body.phone, '3415551234');
  assert.deepEqual(customers.calls[0].body.defaultAddress, address);
  assert.deepEqual(customers.calls[0].body.billing, { doc: '12345678', name: 'Ana Pérez' });
  // retiro: guarda teléfono, no toca la dirección; sin facturación, no la toca
  await svc.create(ana, { ...base, items: [{ productId: 1, qty: 1 }], saveDetails: true });
  assert.equal(customers.calls.length, 2);
  assert.ok(!('defaultAddress' in customers.calls[1].body));
  assert.ok(!('billing' in customers.calls[1].body));
});

test('pedido: si guardar los datos en la cuenta falla, igual devuelve paymentUrl y el pedido lo conserva', async () => {
  const db = fakePrisma(products);
  const customers: any = { updateMe: async () => { throw new Error('falla la base'); } };
  const r = await svcOf(db, fakeMp(), customers).create(ana, { ...base, items: [{ productId: 1, qty: 1 }], saveDetails: true });
  assert.equal(r.paymentUrl, 'https://mp.test/checkout');
  assert.equal(db.orders[0].paymentUrl, 'https://mp.test/checkout');
  assert.equal(db.orders[0].status, 'pendiente_pago');
  // en cotización también
  const mp = fakeMp(); mp.enabled = false;
  const r2 = await svcOf(fakePrisma(products), mp, customers).create(ana, { ...base, items: [{ productId: 1, qty: 1 }], saveDetails: true });
  assert.equal(r2.status, 'cotizacion');
});

test('pedido: validaciones de ítems', async () => {
  const svc = svcOf(fakePrisma(products));
  await assert.rejects(svc.create(ana, { ...base, items: [] }));
  await assert.rejects(svc.create(ana, { ...base, items: [{ productId: 1, qty: 0 }] }));
  await assert.rejects(svc.create(ana, { ...base, items: [{ productId: 99, qty: 1 }] }), /ya no está disponible/);
  // oculto en la tienda (solo lo usa el dimensionador) o desactivado: no se puede comprar
  await assert.rejects(svc.create(ana, { ...base, items: [{ productId: 4, qty: 1 }] }), /ya no está disponible/);
  await assert.rejects(svc.create(ana, { ...base, items: [{ productId: 5, qty: 1 }] }), /ya no está disponible/);
  await assert.rejects(svc.create(ana, { ...base, items: [{ productId: 3, qty: 1 }] }), /Sin stock/);
});

test('sin MP configurado o modo cotización: se guarda como cotización, sin link de pago', async () => {
  const db = fakePrisma(products), mp = fakeMp(); mp.enabled = false;
  const r = await svcOf(db, mp).create(ana, { ...base, items: [{ productId: 1, qty: 1 }] });
  assert.equal(r.paymentUrl, null);
  assert.equal(db.orders[0].status, 'cotizacion');
  const mp2 = fakeMp();
  const r2 = await svcOf(db, mp2).create(ana, { ...base, items: [{ productId: 1, qty: 1 }], mode: 'cotizacion' });
  assert.equal(r2.paymentUrl, null);
  assert.equal(r2.status, 'cotizacion');
  assert.equal(mp2.calls.length, 0);
});

test('webhook: aprobado por el total -> pagado; monto menor -> queda pendiente; pagado no retrocede', async () => {
  const db = fakePrisma(products);
  const { code } = await svcOf(db).create(ana, { ...base, items: [{ productId: 1, qty: 1 }] });

  const low = svcOf(db, fakeMp({ id: 5, status: 'approved', external_reference: code, transaction_amount: 10, currency_id: 'ARS' }));
  assert.equal((await low.handlePaymentNotification('5')).status, 'pendiente_pago');

  const ok = svcOf(db, fakeMp({ id: 6, status: 'approved', external_reference: code, transaction_amount: 100000, currency_id: 'ARS' }));
  assert.equal((await ok.handlePaymentNotification('6')).status, 'pagado');
  assert.equal(db.orders[0].status, 'pagado');

  const late = svcOf(db, fakeMp({ id: 7, status: 'pending', external_reference: code, transaction_amount: 100000, currency_id: 'ARS' }));
  assert.equal((await late.handlePaymentNotification('7')).status, 'pagado');

  const unknown = svcOf(db, fakeMp({ id: 8, status: 'approved', external_reference: 'no-existe' }));
  assert.deepEqual(await unknown.handlePaymentNotification('8'), { ignored: 'pedido inexistente' });
});

test('webhook: pedido viejo con external_reference = publicId (sin código coincidente) -> pagado', async () => {
  const db = fakePrisma(products);
  const publicId = '3f1c2a4e-9b7d-4c1e-8a2b-5d6e7f809a1b';
  db.orders.push({ id: 1, publicId, code: 'AX-ZZZZZZ', customerId: null, status: 'pendiente_pago', totalArs: '50000', items: [] });
  const svc = svcOf(db, fakeMp({ id: 9, status: 'approved', external_reference: publicId, transaction_amount: 50000, currency_id: 'ARS' }));
  const r = await svc.handlePaymentNotification('9');
  assert.equal(r.status, 'pagado');
  assert.equal(db.orders[0].status, 'pagado');
  assert.equal(db.orders[0].mpPaymentId, '9');
});

test('acceso: findForCustomer de otro cliente -> 404; findLegacyPublic de pedido con cliente -> 404', async () => {
  const db = fakePrisma(products);
  const svc = svcOf(db);
  const { code } = await svc.create(ana, { ...base, items: [{ productId: 1, qty: 1 }] });
  const mine = await svc.findForCustomer(7, code);
  assert.equal(mine.code, code);
  await assert.rejects(svc.findForCustomer(8, code), { name: 'NotFoundException', message: 'Pedido no encontrado' });
  await assert.rejects(svc.findForCustomer(7, 'AX-ZZZZZZ'), { name: 'NotFoundException', message: 'Pedido no encontrado' });
  await assert.rejects(svc.findLegacyPublic(db.orders[0].publicId), { name: 'NotFoundException' });

  const legacyId = '3f1c2a4e-9b7d-4c1e-8a2b-5d6e7f809a1b';
  db.orders.push({ id: 99, publicId: legacyId, code: 'AX-ZZZZZZ', customerId: null, status: 'pagado', totalArs: '10', createdAt: new Date(), items: [{ productName: 'P', quantity: 1, unitPriceArs: '10' }] });
  const legacy = await svc.findLegacyPublic(legacyId);
  assert.deepEqual(Object.keys(legacy).sort(), ['createdAt', 'items', 'publicId', 'status', 'totalArs']);
  assert.equal(legacy.totalArs, 10);
});

test('listForCustomer: solo los suyos, más nuevo primero, paymentUrl solo en pendiente_pago', async () => {
  const db = fakePrisma(products);
  const svc = svcOf(db);
  const a = await svc.create(ana, { ...base, items: [{ productId: 1, qty: 1 }] });
  const b = await svc.create(ana, { ...base, items: [{ productId: 1, qty: 2 }] });
  await svc.create({ id: 8, name: 'Beto', email: 'b@x.com' }, { ...base, items: [{ productId: 1, qty: 1 }] });
  db.orders[1].status = 'pagado';
  const list = await svc.listForCustomer(7);
  assert.deepEqual(list.map((o: any) => o.code), [b.code, a.code]);
  assert.equal(list[0].paymentUrl, null);
  assert.equal(list[1].paymentUrl, 'https://mp.test/checkout');
  assert.equal(list[1].totalArs, 100000);
  assert.equal(list[1].fulfillmentStatus, 'pendiente');
  assert.equal(list[1].deliveryMethod, 'retiro');
  assert.equal(list[1].items[0].quantity, 1);
  assert.ok(!('customerId' in list[0]));
});

test('adminList: para_preparar = pagados no entregados; otros filtros y búsqueda por código', async () => {
  const db = fakePrisma(products);
  const mk = (id: number, code: string, status: string, fulfillmentStatus: string) =>
    db.orders.push({ id, code, status, fulfillmentStatus, createdAt: new Date(1000 + id), items: [] });
  mk(1, 'AX-AAAAAA', 'pagado', 'pendiente');
  mk(2, 'AX-BBBBBB', 'pagado', 'entregado');
  mk(3, 'AX-CCCCCC', 'pendiente_pago', 'pendiente');
  mk(4, 'AX-DDDDDD', 'pagado', 'enviado');
  const svc = svcOf(db);
  assert.deepEqual((await svc.adminList('para_preparar')).map((o: any) => o.id), [4, 1]);
  assert.deepEqual((await svc.adminList(undefined as any)).map((o: any) => o.id), [4, 1]);
  assert.deepEqual((await svc.adminList('todos')).map((o: any) => o.id), [4, 3, 2, 1]);
  assert.deepEqual((await svc.adminList('pendientes_pago')).map((o: any) => o.id), [3]);
  assert.deepEqual((await svc.adminList('entregados')).map((o: any) => o.id), [2]);
  assert.deepEqual((await svc.adminList('todos', ' ccc ')).map((o: any) => o.id), [3]);
  const args = (db.order as any).last;
  assert.equal(args.take, 200);
  assert.deepEqual(args.include, { items: true, customer: { select: { id: true, name: true } } });
  await assert.rejects(svc.adminList('raro' as any), { name: 'BadRequestException' });
});

test('setFulfillment: 404 si no existe; aplica reglas; tracking solo con enviado', async () => {
  const db = fakePrisma(products);
  db.orders.push({ id: 1, code: 'AX-AAAAAA', status: 'pagado', deliveryMethod: 'envio', fulfillmentStatus: 'pendiente', trackingNumber: null, items: [] });
  db.orders.push({ id: 2, code: 'AX-BBBBBB', status: 'pendiente_pago', deliveryMethod: 'envio', fulfillmentStatus: 'pendiente', trackingNumber: null, items: [] });
  const svc = svcOf(db);
  await assert.rejects(svc.setFulfillment(99, 'preparando'), { name: 'NotFoundException' });
  await assert.rejects(svc.setFulfillment(2, 'preparando'), { message: 'Solo se puede cambiar la entrega de un pedido pagado.' });
  await assert.rejects(svc.setFulfillment(1, 'listo_para_retirar'), { message: 'Ese estado no corresponde al tipo de entrega.' });
  const sent: any = await svc.setFulfillment(1, 'enviado', ' OCA-123 ');
  assert.equal(sent.fulfillmentStatus, 'enviado');
  assert.equal(sent.trackingNumber, 'OCA-123');
  const back: any = await svc.setFulfillment(1, 'preparando', 'OCA-123');
  assert.equal(back.trackingNumber, null);
});

test('GET /orders/:id: UUID -> legado; código -> sesión y dueño; otro formato -> 404', async () => {
  const prevSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-secret';
  try {
    const db = fakePrisma(products, [{ id: 7, email: 'ana@example.com', name: 'Ana Pérez', blocked: false }, { id: 8, email: 'b@x.com', name: 'Beto', blocked: false }]);
    const svc = svcOf(db);
    const { code } = await svc.create(ana, { ...base, items: [{ productId: 1, qty: 1 }] });
    const legacyId = '3f1c2a4e-9b7d-4c1e-8a2b-5d6e7f809a1b';
    db.orders.push({ id: 99, publicId: legacyId, code: 'AX-ZZZZZZ', customerId: null, status: 'pagado', totalArs: '10', createdAt: new Date(), items: [] });
    const ctrl = new OrdersController(svc, fakeMp(), new CustomerGuard(db as any));
    const req = (sub?: string) => ({ headers: sub ? { authorization: `Bearer ${issueToken(sub, 'test-secret', { role: 'customer', ttlSeconds: 3600 })}` } : {} });

    assert.equal((await ctrl.findOne(legacyId, req() as any) as any).publicId, legacyId);
    assert.equal((await ctrl.findOne(code.toLowerCase(), req('7') as any) as any).code, code);
    await assert.rejects(ctrl.findOne(code, req() as any), { name: 'UnauthorizedException' });
    await assert.rejects(ctrl.findOne(code, req('8') as any), { name: 'NotFoundException', message: 'Pedido no encontrado' });
    // un token de admin no sirve para ver pedidos de clientes
    await assert.rejects(ctrl.findOne(code, { headers: { authorization: `Bearer ${issueToken('7', 'test-secret')}` } } as any), { name: 'UnauthorizedException' });
    await assert.rejects(ctrl.findOne('cualquier-cosa', req('7') as any), { name: 'NotFoundException', message: 'Pedido no encontrado' });
  } finally {
    if (prevSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = prevSecret;
  }
});

test('firma del webhook de Mercado Pago', () => {
  const mp = new MercadoPagoClient();
  const prev = process.env.MP_WEBHOOK_SECRET;
  process.env.MP_WEBHOOK_SECRET = 'secreto';
  const ts = '1700000000';
  const v1 = createHmac('sha256', 'secreto').update(`id:123;request-id:req-1;ts:${ts};`).digest('hex');
  const now = Number(ts) * 1000 + 5000; // 5 s después de firmada
  assert.equal(mp.verifySignature(`ts=${ts},v1=${v1}`, 'req-1', '123', now), true);
  assert.equal(mp.verifySignature(`ts=${ts},v1=${v1}`, 'req-2', '123', now), false);
  assert.equal(mp.verifySignature(undefined, 'req-1', '123', now), false);
  delete process.env.MP_WEBHOOK_SECRET;
  assert.equal(mp.verifySignature(undefined, undefined, '123'), true);
  if (prev) process.env.MP_WEBHOOK_SECRET = prev;
});

test('firma del webhook: ts de más de 3 días (o futuro) se rechaza; un reintento de horas vale; ts en ms también vale', () => {
  const mp = new MercadoPagoClient();
  const prev = process.env.MP_WEBHOOK_SECRET;
  process.env.MP_WEBHOOK_SECRET = 'secreto';
  try {
    const sig = (ts: string) => `ts=${ts},v1=${createHmac('sha256', 'secreto').update(`id:123;request-id:req-1;ts:${ts};`).digest('hex')}`;
    const now = 1_700_000_000_000;
    const DAY = 24 * 60 * 60_000;
    assert.equal(mp.verifySignature(sig('1700000000'), 'req-1', '123', now + 9 * 60_000), true);
    assert.equal(mp.verifySignature(sig('1700000000'), 'req-1', '123', now + 6 * 60 * 60_000), true); // reintento de MP horas después
    assert.equal(mp.verifySignature(sig('1700000000'), 'req-1', '123', now + 3 * DAY + 60_000), false);
    assert.equal(mp.verifySignature(sig('1700000000'), 'req-1', '123', now - 3 * DAY - 60_000), false);
    assert.equal(mp.verifySignature(sig('1700000000000'), 'req-1', '123', now + 60_000), true);
    assert.equal(mp.verifySignature(sig('abc'), 'req-1', '123', now), false);
  } finally {
    if (prev === undefined) delete process.env.MP_WEBHOOK_SECRET; else process.env.MP_WEBHOOK_SECRET = prev;
  }
});

test('webhook: sin MP_WEBHOOK_SECRET sigue aceptando notificaciones sin firma (el pago se consulta a MP)', async () => {
  const prev = process.env.MP_WEBHOOK_SECRET;
  delete process.env.MP_WEBHOOK_SECRET;
  try {
    const db = fakePrisma(products);
    const { code } = await svcOf(db).create(ana, { ...base, items: [{ productId: 1, qty: 1 }] });
    const mp = fakeMp({ id: 11, status: 'approved', external_reference: code, transaction_amount: 100000, currency_id: 'ARS' });
    const ctrl = new OrdersController(svcOf(db, mp), new MercadoPagoClient(), {} as any);
    assert.equal((await ctrl.webhook({ type: 'payment', data: { id: '11' } }, {}, undefined, undefined, '1.1.1.1') as any).status, 'pagado');
  } finally {
    if (prev !== undefined) process.env.MP_WEBHOOK_SECRET = prev;
  }
});

test('webhook: límite de 120 por minuto por IP (otra IP no se ve afectada)', async () => {
  const ctrl = new OrdersController(svcOf(fakePrisma(products)), new MercadoPagoClient(), {} as any);
  for (let i = 0; i < 120; i++) await ctrl.webhook({ type: 'merchant_order' }, {}, undefined, undefined, '6.6.6.6');
  await assert.rejects(ctrl.webhook({ type: 'merchant_order' }, {}, undefined, undefined, '6.6.6.6'), (e: any) => e.getStatus() === 429);
  assert.deepEqual(await ctrl.webhook({ type: 'merchant_order' }, {}, undefined, undefined, '7.7.7.7'), { ignored: 'merchant_order' });
});

test('webhook: pago aprobado sin monto o con monto no numérico -> no se marca pagado', async () => {
  const db = fakePrisma(products);
  const { code } = await svcOf(db).create(ana, { ...base, items: [{ productId: 1, qty: 1 }] });
  for (const transaction_amount of [undefined, null, 'abc', Infinity]) {
    const svc = svcOf(db, fakeMp({ id: 12, status: 'approved', external_reference: code, transaction_amount, currency_id: 'ARS' }));
    assert.equal((await svc.handlePaymentNotification('12')).status, 'pendiente_pago');
  }
  assert.equal(db.orders[0].status, 'pendiente_pago');
});

test('pedido: el tope de 999 unidades va sobre el total por producto (líneas repetidas se suman)', async () => {
  const svc = svcOf(fakePrisma(products));
  await assert.rejects(svc.create(ana, { ...base, items: [{ productId: 1, qty: 999 }, { productId: 1, qty: 1 }] }), /hasta 999 unidades/);
  const r = await svc.create(ana, { ...base, items: [{ productId: 1, qty: 500 }, { productId: 1, qty: 499 }] });
  assert.ok(r.code);
});

test('POST /orders: límite de 20 pedidos por día por cliente aunque cambie la IP', async () => {
  const db = fakePrisma(products);
  const ctrl = new OrdersController(svcOf(db), fakeMp(), {} as any);
  const req = { customer: ana };
  for (let i = 0; i < 20; i++) await ctrl.create(req, { ...base, items: [{ productId: 1, qty: 1 }] }, `10.0.0.${i}`);
  // create no es async: el 429 sale al llamarlo, por eso va dentro de una función
  await assert.rejects(async () => ctrl.create(req, { ...base, items: [{ productId: 1, qty: 1 }] }, '10.0.1.1'), (e: any) => e.getStatus() === 429);
  // otro cliente no comparte el contador
  await ctrl.create({ customer: { id: 8, name: 'Beto', email: 'b@x.com' } }, { ...base, items: [{ productId: 1, qty: 1 }] }, '10.0.1.2');
});

test('pedido con instalación: 25 % de los equipos que cubre, con precios del servidor; va a MP como "instalacion"', async () => {
  const db = fakePrisma(products), mp = fakeMp();
  // instalación sobre 2 paneles y el inversor (USD); el tercer panel queda suelto, sin instalación
  const r = await svcOf(db, mp).create(ana, {
    ...base,
    items: [{ productId: 1, qty: 3 }, { productId: 2, qty: 1 }],
    installation: [{ productId: 1, qty: 2 }, { productId: 2, qty: 1 }],
  });
  const equipos = 3 * 100000 + 800 * 1000;
  const instalacion = 0.25 * (2 * 100000 + 800 * 1000);
  assert.equal(r.totalArs, equipos + instalacion);
  const line = db.orders[0].items.find((i: any) => i.productId === 0);
  assert.equal(Number(line.unitPriceArs), instalacion);
  assert.equal(line.quantity, 1);
  assert.match(line.productName, /Instalación y asesoría/);
  assert.deepEqual(mp.calls[0].items.find((i: any) => i.id === 'instalacion'), { id: 'instalacion', title: line.productName, quantity: 1, unit_price: instalacion });
});

test('pedido con instalación: equipos fuera del pedido, más unidades que las pedidas o formato inválido -> 400', async () => {
  const svc = svcOf(fakePrisma(products));
  const items = [{ productId: 1, qty: 2 }];
  await assert.rejects(svc.create(ana, { ...base, items, installation: [{ productId: 2, qty: 1 }] }), /no están en el pedido/);
  await assert.rejects(svc.create(ana, { ...base, items, installation: [{ productId: 1, qty: 3 }] }), /no están en el pedido/);
  await assert.rejects(svc.create(ana, { ...base, items, installation: [{ productId: 1, qty: 1 }, { productId: 1, qty: 2 }] }), /no están en el pedido/);
  await assert.rejects(svc.create(ana, { ...base, items, installation: 'sí' as any }), /no es válida/);
  await assert.rejects(svc.create(ana, { ...base, items, installation: [{ productId: 0, qty: 1 }] }), /no es válida/);
});

test('pedido sin instalación (o con lista vacía): no agrega la línea del servicio', async () => {
  const db = fakePrisma(products);
  const svc = svcOf(db);
  await svc.create(ana, { ...base, items: [{ productId: 1, qty: 1 }] });
  await svc.create(ana, { ...base, items: [{ productId: 1, qty: 1 }], installation: [] });
  assert.equal(db.orders.flatMap((o: any) => o.items).filter((i: any) => i.productId === 0).length, 0);
  assert.equal(db.orders[1].totalArs.toString(), '100000');
});
