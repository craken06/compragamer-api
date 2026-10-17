/*
 * Clientes: ingreso, guard y /me con base y Google SIMULADOS (sin red ni Neon).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { CustomersService } from '../src/customers/customers.service';
import { CustomerGuard } from '../src/customers/customer.guard';
import { CustomerAuthController } from '../src/customers/customer-auth.controller';
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
      update: async ({ where, data }: any) => Object.assign(customers.find((c) => c.id === where.id), data),
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

  const b = await svc.updateMe(customer.id, { defaultAddress: null });
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
