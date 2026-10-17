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

function withEnv<T>(fn: () => T): T {
  const prev = { k: process.env.ADMIN_API_KEY, s: process.env.JWT_SECRET };
  process.env.ADMIN_API_KEY = 'clave-admin';
  process.env.JWT_SECRET = S;
  try { return fn(); } finally {
    if (prev.k === undefined) delete process.env.ADMIN_API_KEY; else process.env.ADMIN_API_KEY = prev.k;
    if (prev.s === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = prev.s;
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

test('AdminKeyGuard acepta token admin y x-admin-key', () => {
  withEnv(() => {
    const g = new AdminKeyGuard();
    assert.equal(g.canActivate(ctx({ authorization: `Bearer ${issueToken('lucas', S)}` })), true);
    assert.equal(g.canActivate(ctx({ 'x-admin-key': 'clave-admin' })), true);
  });
});
