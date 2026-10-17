import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import { CUSTOMER_TOKEN_TTL_SECONDS, issueToken, verifyToken } from '../src/auth/token';
import { AdminKeyGuard } from '../src/common/admin-key.guard';

const S = 'secreto-de-prueba';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

// Contexto mínimo de Nest con los headers dados.
const ctx = (headers: Record<string, string>) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as any;

function withEnv<T>(fn: () => T, env: { k?: string; s?: string } = { k: 'clave-admin', s: S }): T {
  const prev = { k: process.env.ADMIN_API_KEY, s: process.env.JWT_SECRET };
  const set = (name: string, v: string | undefined) => { if (v === undefined) delete process.env[name]; else process.env[name] = v; };
  set('ADMIN_API_KEY', env.k);
  set('JWT_SECRET', env.s);
  try { return fn(); } finally {
    set('ADMIN_API_KEY', prev.k);
    set('JWT_SECRET', prev.s);
  }
}

test('token de admin: role admin y 12 h', () => {
  const p: any = verifyToken(issueToken('lucas', S), S);
  assert.equal(p.role, 'admin');
  assert.equal(p.exp - p.iat, 43200);
});

test('token de cliente: role customer y 30 días', () => {
  const p: any = verifyToken(issueToken('cli-1', S, { role: 'customer', ttlSeconds: CUSTOMER_TOKEN_TTL_SECONDS }), S);
  assert.equal(p.role, 'customer');
  assert.equal(p.exp - p.iat, 2592000);
});

test('AdminKeyGuard rechaza token de cliente', () => {
  const t = issueToken('cli-1', S, { role: 'customer', ttlSeconds: CUSTOMER_TOKEN_TTL_SECONDS });
  withEnv(() => assert.throws(() => new AdminKeyGuard().canActivate(ctx({ authorization: `Bearer ${t}` })), { name: 'UnauthorizedException' }));
});

test('AdminKeyGuard rechaza token viejo sin role', () => {
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({ sub: 'lucas', iat: now, exp: now + 3600 });
  const t = `${h}.${p}.${createHmac('sha256', S).update(`${h}.${p}`).digest('base64url')}`;
  assert.ok(verifyToken(t, S)); // la firma es válida: lo que falla es el rol
  withEnv(() => assert.throws(() => new AdminKeyGuard().canActivate(ctx({ authorization: `Bearer ${t}` })), { name: 'UnauthorizedException' }));
});

test('AdminKeyGuard acepta token admin', () => {
  withEnv(() => {
    assert.equal(new AdminKeyGuard().canActivate(ctx({ authorization: `Bearer ${issueToken('lucas', S)}` })), true);
  });
});

test('AdminKeyGuard rechaza x-admin-key aunque ADMIN_API_KEY siga cargada', () => {
  withEnv(() => {
    assert.throws(() => new AdminKeyGuard().canActivate(ctx({ 'x-admin-key': 'clave-admin' })), { name: 'UnauthorizedException' });
  });
});

test('AdminKeyGuard rechaza request sin credenciales', () => {
  withEnv(() => assert.throws(() => new AdminKeyGuard().canActivate(ctx({})), { name: 'UnauthorizedException' }));
});

test('AdminKeyGuard falla cerrado sin JWT_SECRET (aunque haya ADMIN_API_KEY)', () => {
  const t = issueToken('lucas', S);
  withEnv(() => {
    const g = new AdminKeyGuard();
    assert.throws(() => g.canActivate(ctx({ authorization: `Bearer ${t}` })), { name: 'ForbiddenException' });
    assert.throws(() => g.canActivate(ctx({ 'x-admin-key': 'clave-admin' })), { name: 'ForbiddenException' });
  }, { k: 'clave-admin', s: undefined });
});

test('AdminKeyGuard rechaza token admin firmado con otro secreto', () => {
  withEnv(() => assert.throws(() => new AdminKeyGuard().canActivate(ctx({ authorization: `Bearer ${issueToken('lucas', 'otro')}` })), { name: 'UnauthorizedException' }));
});
