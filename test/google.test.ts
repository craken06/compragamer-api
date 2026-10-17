import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, KeyObject } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { createKeyCache, verifyGoogleCredential, Jwk } from '../src/customers/google';

const CLIENT_ID = 'cliente-123.apps.googleusercontent.com';
const NOW = 1_800_000_000;
const MSG = 'No pudimos verificar tu cuenta de Google. Probá de nuevo.';

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const newPair = () => generateKeyPairSync('rsa', { modulusLength: 2048 });
const toJwk = (pub: KeyObject, kid = 'k1'): Jwk => ({ ...(pub.export({ format: 'jwk' }) as any), kid, alg: 'RS256' });

const pair = newPair();
const jwk = toJwk(pair.publicKey);
const getKey = async (kid: string) => (kid === 'k1' ? jwk : null);

function makeToken(claims: Record<string, unknown> = {}, o: { header?: Record<string, unknown>; key?: KeyObject; sig?: string } = {}) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'k1', ...o.header }));
  const payload = b64url(JSON.stringify({
    iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1234', email: 'Ana@Gmail.com', email_verified: true,
    name: 'Ana Pérez', picture: 'https://x/y.png', iat: NOW - 10, exp: NOW + 3000, ...claims,
  }));
  const sig = o.sig ?? b64url(sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), o.key ?? pair.privateKey));
  return `${header}.${payload}.${sig}`;
}

const verify = (t: string, extra: Record<string, unknown> = {}) =>
  verifyGoogleCredential(t, { clientId: CLIENT_ID, getKey, nowSeconds: NOW, ...extra } as any);
const rejects = (p: Promise<unknown>) => assert.rejects(p, (e: any) => e instanceof UnauthorizedException && e.message === MSG);

test('comprobante válido devuelve el perfil con el email en minúsculas', async () => {
  assert.deepEqual(await verify(makeToken()), { sub: '1234', email: 'ana@gmail.com', name: 'Ana Pérez', picture: 'https://x/y.png', hd: null });
});
test('cuenta de Google Workspace: devuelve hd en minúsculas; hd vacío o no texto es null', async () => {
  assert.equal((await verify(makeToken({ email: 'ana@empresa.com', hd: 'Empresa.com' }))).hd, 'empresa.com');
  assert.equal((await verify(makeToken({ hd: '' }))).hd, null);
  assert.equal((await verify(makeToken({ hd: 123 }))).hd, null);
});
test('aud como arreglo que incluye el clientId se acepta', async () => {
  assert.equal((await verify(makeToken({ aud: ['otro', CLIENT_ID] }))).sub, '1234');
});
test('firma de otra clave se rechaza', () => rejects(verify(makeToken({}, { key: newPair().privateKey }))));
test('aud distinto se rechaza', () => rejects(verify(makeToken({ aud: 'otro' }))));
test('clientId vacío se rechaza', () => rejects(verify(makeToken(), { clientId: '' })));
test('iss ajeno se rechaza', () => rejects(verify(makeToken({ iss: 'https://evil.com' }))));
test('iss sin https se acepta', async () => { assert.equal((await verify(makeToken({ iss: 'accounts.google.com' }))).sub, '1234'); });
test('vencido hace 2 minutos se rechaza', () => rejects(verify(makeToken({ exp: NOW - 120 }))));
test('vencido hace 30 s se acepta (tolerancia)', async () => { assert.equal((await verify(makeToken({ exp: NOW - 30 }))).sub, '1234'); });
test('email_verified false se rechaza', () => rejects(verify(makeToken({ email_verified: false }))));
test('alg none se rechaza', () => rejects(verify(makeToken({}, { header: { alg: 'none' }, sig: '' }))));
test('alg HS256 se rechaza', () => rejects(verify(makeToken({}, { header: { alg: 'HS256' } }))));
test('kid desconocido se rechaza', () => rejects(verify(makeToken({}, { header: { kid: 'zzz' } }))));
test('texto que no es JWT se rechaza', async () => {
  for (const t of ['hola', '', 'a.b', 'a.b.c', '....']) await rejects(verify(t));
});
test('sin name usa la parte local del email; sin picture es null', async () => {
  const p = await verify(makeToken({ name: undefined, picture: undefined, email: 'ana@gmail.com' }));
  assert.equal(p.name, 'ana');
  assert.equal(p.picture, null);
});

// ---- caché de claves ----
function fakeFetch(maxAge: string | null, keys: Jwk[] = [jwk], ok = true) {
  const f: any = async () => {
    f.calls++;
    return { ok, json: async () => ({ keys }), headers: { get: () => (maxAge === null ? null : `public, ${maxAge}, must-revalidate`) } };
  };
  f.calls = 0;
  return f;
}

test('caché: dos pedidos del mismo kid hacen 1 descarga; tras 601 s, 2', async () => {
  let t = 1_000_000;
  const f = fakeFetch('max-age=600');
  const get = createKeyCache('https://x/certs', f, () => t);
  assert.equal((await get('k1'))?.kid, 'k1');
  assert.equal((await get('k1'))?.kid, 'k1');
  assert.equal(f.calls, 1);
  t += 601_000;
  await get('k1');
  assert.equal(f.calls, 2);
});
test('caché: sin Cache-Control dura 3600 s', async () => {
  let t = 0;
  const f = fakeFetch(null);
  const get = createKeyCache('u', f, () => t);
  await get('k1');
  t += 3_599_000;
  await get('k1');
  assert.equal(f.calls, 1);
  t += 2_000;
  await get('k1');
  assert.equal(f.calls, 2);
});
test('caché: kid desconocido provoca 1 descarga extra y no más', async () => {
  const f = fakeFetch('max-age=600');
  const get = createKeyCache('u', f, () => 5);
  await get('k1');
  assert.equal(f.calls, 1);
  assert.equal(await get('nuevo'), null);
  assert.equal(f.calls, 2);
  assert.equal(await get('nuevo'), null);
  assert.equal(f.calls, 2);
});
test('caché: descarga fallida devuelve null y no se cachea', async () => {
  const bad = fakeFetch('max-age=600', [jwk], false);
  const get = createKeyCache('u', bad, () => 5);
  assert.equal(await get('k1'), null);
  assert.equal(await get('k1'), null);
  assert.equal(bad.calls, 2);
  const boom: any = async () => { throw new Error('red'); };
  assert.equal(await createKeyCache('u', boom, () => 5)('k1'), null);
});

test('caché: kids desconocidos distintos (A, B, A) en 60 s cuestan 1 descarga extra en total', async () => {
  let t = 10_000;
  const f = fakeFetch('max-age=600');
  const get = createKeyCache('u', f, () => t);
  await get('k1');
  assert.equal(f.calls, 1);
  assert.equal(await get('A'), null);
  t += 1_000;
  assert.equal(await get('B'), null);
  t += 1_000;
  assert.equal(await get('A'), null);
  assert.equal(f.calls, 2);
});
test('caché: pasado el enfriamiento de 60 s, otro kid desconocido cuesta 1 descarga más', async () => {
  let t = 10_000;
  const f = fakeFetch('max-age=600');
  const get = createKeyCache('u', f, () => t);
  await get('k1');
  await get('A');
  assert.equal(f.calls, 2);
  t += 61_000;
  assert.equal(await get('B'), null);
  assert.equal(f.calls, 3);
  assert.equal(await get('C'), null);
  assert.equal(f.calls, 3);
});
