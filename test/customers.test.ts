/*
 * Clientes: ingreso, guard y /me con base y Google SIMULADOS (sin red ni Neon).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { CustomersService } from '../src/customers/customers.service';
import { CustomerGuard } from '../src/customers/customer.guard';
import { CustomerAuthController } from '../src/customers/customer-auth.controller';
import { Prisma } from '@prisma/client';
import { issueToken, verifyToken } from '../src/auth/token';

process.env.JWT_SECRET = 'test-secret';
const SECRET = 'test-secret';

function fakePrisma() {
  const customers: any[] = [];
  const identities: any[] = [];
  const db: any = {
    customers, identities,
    $transaction: async (fn: any) => fn(db),
    customerIdentity: {
      findUnique: async ({ where }: any) => {
        const k = where.provider_subject;
        const i = identities.find((x) => x.provider === k.provider && x.subject === k.subject);
        return i ? { ...i, customer: customers.find((c) => c.id === i.customerId) } : null;
      },
      create: async ({ data }: any) => { const i = { id: identities.length + 1, ...data }; identities.push(i); return i; },
    },
    customer: {
      findUnique: async ({ where }: any) =>
        customers.find((c) => (where.id !== undefined ? c.id === where.id : c.email === where.email)) ?? null,
      create: async ({ data }: any) => {
        const { identities: nested, ...rest } = data;
        const c = { id: customers.length + 1, phone: null, defaultAddress: null, billingDoc: null, billingName: null, blocked: false, ...rest };
        customers.push(c);
        if (nested?.create) identities.push({ id: identities.length + 1, customerId: c.id, ...nested.create });
        return c;
      },
      update: async ({ where, data }: any) => {
        // como la base real: DbNull se guarda como NULL
        const d = { ...data };
        if (d.defaultAddress === Prisma.DbNull) d.defaultAddress = null;
        return Object.assign(customers.find((c) => c.id === where.id), d);
      },
    },
  };
  return db;
}
const profile = { sub: 'g-1', email: 'ana@example.com', name: 'Ana', picture: 'https://pic/a.png' };

test('alta nueva: crea cliente + identidad y el token es de cliente', async () => {
  const db = fakePrisma();
  const svc = new CustomersService(db);
  const { token, customer } = await svc.loginWithIdentity('google', profile);
  assert.equal(db.customers.length, 1);
  assert.equal(db.identities.length, 1);
  assert.equal(db.identities[0].customerId, customer.id);
  assert.equal(customer.email, 'ana@example.com');
  const p = verifyToken(token, SECRET)!;
  assert.equal(p.role, 'customer');
  assert.equal(p.sub, String(customer.id));
  const raw = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  assert.equal(raw.exp - raw.iat, 2592000);
});

test('el email se normaliza (trim + minúsculas) al ingresar', async () => {
  const db = fakePrisma();
  const { customer } = await new CustomersService(db).loginWithIdentity('google', { ...profile, email: '  Ana@Example.COM ' });
  assert.equal(customer.email, 'ana@example.com');
  assert.equal(db.identities[0].email, 'ana@example.com');
});

test('segundo ingreso con el mismo sub: no crea nada y actualiza nombre, foto y último ingreso', async () => {
  const db = fakePrisma();
  const svc = new CustomersService(db);
  await svc.loginWithIdentity('google', profile);
  const before = db.customers[0].lastLoginAt;
  await new Promise((r) => setTimeout(r, 5));
  const { customer } = await svc.loginWithIdentity('google', { ...profile, name: 'Ana María', picture: 'https://pic/b.png' });
  assert.equal(db.customers.length, 1);
  assert.equal(db.identities.length, 1);
  assert.equal(customer.name, 'Ana María');
  assert.equal(customer.avatarUrl, 'https://pic/b.png');
  assert.ok(db.customers[0].lastLoginAt > before);
});

test('mismo email con otro sub o proveedor: agrega identidad al cliente existente', async () => {
  const db = fakePrisma();
  const svc = new CustomersService(db);
  const a = await svc.loginWithIdentity('google', profile);
  const b = await svc.loginWithIdentity('microsoft', { ...profile, sub: 'ms-9' });
  assert.equal(db.customers.length, 1);
  assert.equal(db.identities.length, 2);
  assert.equal(b.customer.id, a.customer.id);
});

test('cliente bloqueado: ForbiddenException', async () => {
  const db = fakePrisma();
  const svc = new CustomersService(db);
  await svc.loginWithIdentity('google', profile);
  db.customers[0].blocked = true;
  await assert.rejects(() => svc.loginWithIdentity('google', profile), (e: any) =>
    e instanceof ForbiddenException && e.message === 'Tu cuenta está suspendida. Escribinos por WhatsApp.');
  // también si entra por otra identidad con el mismo email
  await assert.rejects(() => svc.loginWithIdentity('microsoft', { ...profile, sub: 'ms-1' }), ForbiddenException);
  assert.equal(db.identities.length, 1);
});

test('perfil sin foto y sin nombre: avatarUrl null y nombre = parte local del email', async () => {
  const db = fakePrisma();
  const svc = new CustomersService(db);
  const { customer } = await svc.loginWithIdentity('google', { sub: 'g-2', email: 'pepe.lopez@example.com', name: '', picture: null });
  assert.equal(customer.avatarUrl, null);
  assert.equal(customer.name, 'pepe.lopez');
});

function ctx(authorization?: string) {
  const req: any = { headers: authorization ? { authorization } : {} };
  return { req, context: { switchToHttp: () => ({ getRequest: () => req }) } as any };
}

test('guard: token de admin, sin token, o sub inválido -> 401', async () => {
  const db = fakePrisma();
  const guard = new CustomerGuard(db);
  // el cliente 1 existe: el 401 del token de admin tiene que venir del rol, no de un cliente faltante
  const { customer } = await new CustomersService(db).loginWithIdentity('google', profile);
  assert.equal(customer.id, 1);
  const msg = 'Tu sesión venció. Ingresá de nuevo.';
  const bad = (e: any) => e instanceof UnauthorizedException && e.message === msg;
  await assert.rejects(() => guard.canActivate(ctx(`Bearer ${issueToken('1', SECRET)}`).context), bad);
  await assert.rejects(() => guard.canActivate(ctx().context), bad);
  await assert.rejects(() => guard.canActivate(ctx('Bearer basura').context), bad);
  await assert.rejects(() => guard.canActivate(ctx(`Bearer ${issueToken('abc', SECRET, { role: 'customer' })}`).context), bad);
});

test('guard: cliente borrado o bloqueado después de emitir el token -> 401; válido deja req.customer', async () => {
  const db = fakePrisma();
  const svc = new CustomersService(db);
  const guard = new CustomerGuard(db);
  const { token, customer } = await svc.loginWithIdentity('google', profile);

  const ok = ctx(`Bearer ${token}`);
  assert.equal(await guard.canActivate(ok.context), true);
  assert.equal(ok.req.customer.id, customer.id);
  assert.equal(ok.req.customer.email, 'ana@example.com');

  db.customers[0].blocked = true;
  await assert.rejects(() => guard.canActivate(ctx(`Bearer ${token}`).context), UnauthorizedException);

  db.customers.length = 0;
  await assert.rejects(() => guard.canActivate(ctx(`Bearer ${token}`).context), UnauthorizedException);
});

test('updateMe: teléfono inválido -> 400; defaultAddress null la borra; omitidos no cambian', async () => {
  const db = fakePrisma();
  const svc = new CustomersService(db);
  const { customer } = await svc.loginWithIdentity('google', profile);
  await assert.rejects(() => svc.updateMe(customer.id, { phone: '123' }), BadRequestException);

  const addr = { street: 'Av. Siempreviva 742', city: 'Rosario', province: 'Santa Fe', zip: '2000' };
  const a = await svc.updateMe(customer.id, { phone: '+54 341 555-1234', defaultAddress: addr, billing: { doc: '20123456', name: 'Ana SA' } });
  assert.equal(a.phone, '+543415551234');
  assert.equal(a.defaultAddress?.street, 'Av. Siempreviva 742');
  assert.equal(a.billingDoc, '20123456');

  let sent: any;
  const origUpdate = db.customer.update;
  db.customer.update = async (args: any) => { sent = args.data; return origUpdate(args); };
  const b = await svc.updateMe(customer.id, { defaultAddress: null });
  assert.equal(sent.defaultAddress, Prisma.DbNull);
  db.customer.update = origUpdate;
  assert.equal(b.defaultAddress, null);
  assert.equal(b.phone, '+543415551234');
  assert.equal(b.billingName, 'Ana SA');

  const c = await svc.updateMe(customer.id, { billing: null, phone: null });
  assert.equal(c.billingDoc, null);
  assert.equal(c.billingName, null);
  assert.equal(c.phone, null);
  assert.equal((await svc.getMe(customer.id)).email, 'ana@example.com');
});

test('POST /customer-auth/google: sin GOOGLE_CLIENT_ID -> 403; con él, verifica y devuelve token', async () => {
  const db = fakePrisma();
  const svc = new CustomersService(db);
  const calls: any[] = [];
  const verify = async (cred: string, clientId: string) => { calls.push([cred, clientId]); return profile; };
  const ctrl = new CustomerAuthController(svc, verify);
  delete process.env.GOOGLE_CLIENT_ID;
  await assert.rejects(() => ctrl.google({ credential: 'x' }, '1.1.1.1'), (e: any) =>
    e instanceof ForbiddenException && e.message === 'Ingreso con Google deshabilitado');
  process.env.GOOGLE_CLIENT_ID = 'cid';
  await assert.rejects(() => ctrl.google({}, '1.1.1.1'), BadRequestException);
  const r = await ctrl.google({ credential: 'cred' }, '1.1.1.1');
  assert.deepEqual(calls, [['cred', 'cid']]);
  assert.equal(r.customer.email, 'ana@example.com');
  assert.equal(verifyToken(r.token, SECRET)!.role, 'customer');
});

// ---- Administración de clientes (spec 4.8) ----
import { NotFoundException } from '@nestjs/common';
import { AdminCustomersController } from '../src/customers/admin-customers.controller';
import { corsOptions } from '../src/cors';

function adminDb() {
  const t0 = new Date('2026-01-01');
  const customers: any[] = [
    { id: 1, email: 'ana@example.com', name: 'Ana Pérez', avatarUrl: null, phone: '3415551234', defaultAddress: null, billingDoc: null, billingName: null, blocked: false, createdAt: t0, lastLoginAt: new Date('2026-03-01') },
    { id: 2, email: 'beto@example.com', name: 'Beto', avatarUrl: null, phone: null, defaultAddress: null, billingDoc: null, billingName: null, blocked: false, createdAt: t0, lastLoginAt: new Date('2026-05-01') },
  ];
  const identities = [
    { customerId: 1, provider: 'google' }, { customerId: 1, provider: 'google' }, { customerId: 1, provider: 'microsoft' },
    { customerId: 2, provider: 'google' },
  ];
  const orders = [
    { id: 1, customerId: 1, status: 'pagado', totalArs: '1000.50', createdAt: new Date('2026-02-01'), items: [] },
    { id: 2, customerId: 1, status: 'pagado', totalArs: '2000', createdAt: new Date('2026-02-02'), items: [] },
    { id: 3, customerId: 1, status: 'pendiente_pago', totalArs: '9999', createdAt: new Date('2026-02-03'), items: [] },
  ];
  const has = (v: any, c: any) => String(v ?? '').toLowerCase().includes(String(c.contains).toLowerCase());
  const db: any = {
    customer: {
      findMany: async (args: any) => {
        let r = customers.filter((c) => !args.where?.OR || args.where.OR.some((o: any) => Object.entries(o).every(([k, cond]) => has(c[k], cond))));
        r = [...r].sort((a, b) => b.lastLoginAt - a.lastLoginAt).slice(0, args.take);
        return r.map((c) => ({
          ...c,
          identities: identities.filter((i) => i.customerId === c.id),
          orders: orders.filter((o) => o.customerId === c.id && o.status === args.include.orders.where.status).map((o) => ({ totalArs: o.totalArs })),
        }));
      },
      findUnique: async ({ where }: any) => {
        const c = customers.find((x) => x.id === where.id);
        return c ? { ...c, identities: identities.filter((i) => i.customerId === c.id), orders: orders.filter((o) => o.customerId === c.id && o.status === 'pagado').map((o) => ({ totalArs: o.totalArs })) } : null;
      },
      update: async ({ where, data }: any) => {
        const c = customers.find((x) => x.id === where.id)!;
        Object.assign(c, data);
        return { ...c, identities: identities.filter((i) => i.customerId === c.id), orders: orders.filter((o) => o.customerId === c.id && o.status === 'pagado').map((o) => ({ totalArs: o.totalArs })) };
      },
    },
    order: {
      findMany: async ({ where }: any) => orders.filter((o) => o.customerId === where.customerId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    },
  };
  return db;
}

test('adminList: sin filtro, por lastLoginAt desc; cuenta solo pagados y providers sin duplicados', async () => {
  const rows = await new CustomersService(adminDb()).adminList();
  assert.deepEqual(rows.map((r) => r.id), [2, 1]);
  const ana = rows[1];
  assert.equal(ana.paidOrders, 2);
  assert.equal(ana.paidTotalArs, 3000.5);
  assert.deepEqual(ana.providers, ['google', 'microsoft']);
  assert.equal(rows[0].paidOrders, 0);
  assert.equal(rows[0].paidTotalArs, 0);
  assert.equal(typeof ana.paidTotalArs, 'number');
});

test('adminList: q filtra por nombre, email o teléfono sin distinguir mayúsculas', async () => {
  const svc = new CustomersService(adminDb());
  assert.deepEqual((await svc.adminList('ANA')).map((r) => r.id), [1]);
  assert.deepEqual((await svc.adminList('beto@EXAMPLE')).map((r) => r.id), [2]);
  assert.deepEqual((await svc.adminList('341 555')).map((r) => r.id), [1]);
  assert.deepEqual((await svc.adminList('nadie')).map((r) => r.id), []);
  assert.equal((await svc.adminList('   ')).length, 2);
});

test('adminDetail: datos, bloqueo, providers y pedidos más nuevos primero; 404 si no existe', async () => {
  const svc = new CustomersService(adminDb());
  const d = await svc.adminDetail(1);
  assert.equal(d.email, 'ana@example.com');
  assert.equal(d.blocked, false);
  assert.deepEqual(d.providers, ['google', 'microsoft']);
  assert.deepEqual(d.orders.map((o: any) => o.id), [3, 2, 1]);
  await assert.rejects(svc.adminDetail(99), NotFoundException);
});

test('setBlocked: cambia el campo y devuelve la fila; 404 si no existe', async () => {
  const db = adminDb();
  const svc = new CustomersService(db);
  const row = await svc.setBlocked(1, true);
  assert.equal(row.blocked, true);
  assert.equal(row.paidOrders, 2);
  assert.equal((await svc.setBlocked(1, false)).blocked, false);
  await assert.rejects(svc.setBlocked(99, true), NotFoundException);
});

test('AdminCustomersController: blocked debe ser booleano e id entero positivo', async () => {
  const c = new AdminCustomersController(new CustomersService(adminDb()));
  await assert.rejects(async () => c.setBlocked('1', { blocked: 'si' } as any), BadRequestException);
  await assert.rejects(async () => c.setBlocked('1', undefined as any), BadRequestException);
  assert.throws(() => c.detail('abc'), BadRequestException);
  assert.throws(() => c.detail('0'), BadRequestException);
  assert.equal((await c.setBlocked('2', { blocked: true })).blocked, true);
});

test('CORS: permite Authorization, PATCH, PUT y DELETE', () => {
  const o = corsOptions();
  assert.ok(o.allowedHeaders.includes('Authorization'));
  assert.ok(o.allowedHeaders.includes('Content-Type'));
  assert.ok(o.allowedHeaders.includes('ngrok-skip-browser-warning'));
  assert.deepEqual(o.methods, ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']); // PUT y DELETE: el panel de admin publicado llama directo
});
