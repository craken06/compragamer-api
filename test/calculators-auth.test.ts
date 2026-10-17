import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumption, cost, orientation, savings } from '../src/calculators/calculators';
import { hashPassword, issueToken, verifyPassword, verifyToken } from '../src/auth/token';

test('consumo: heladera 150 W × 24 h + 10 LED 9 W × 5 h = 4,05 kWh/día', () => {
  const r = consumption([{ name: 'Heladera', power: 150, qty: 1, hours: 24 }, { name: 'LED', power: 9, qty: 10, hours: 5 }]);
  assert.equal(r.result.dailyKwh, 4.05);
  assert.equal(r.result.monthlyKwh, 121.5);
  assert.equal(r.result.yearlyKwh, 1478);
  assert.deepEqual(r.warnings, []);
});

test('consumo: horas > 24 se acotan y avisa; negativos a 0; lista vacía avisa', () => {
  const r = consumption([{ name: 'X', power: 100, qty: 1, hours: 30 }, { power: -5, qty: 1, hours: 1 }]);
  assert.equal(r.result.dailyKwh, 2.4);
  assert.equal(r.warnings.length, 2);
  assert.match(consumption([]).warnings[0], /No hay equipos/);
  assert.match(consumption(null as any).warnings[0], /No hay equipos/);
});

test('costo y ahorro', () => {
  assert.equal(cost(300, 150).result.cost, 45000);
  assert.ok(cost(300, 0).warnings.some((w) => w.includes('precio')));
  const s = savings(300, 400, 150);
  assert.equal(s.result.monthly, 60000);
  assert.equal(s.result.coveredPct, 100);
  assert.equal(s.result.excessKwh, 100);
  assert.ok(s.warnings.some((w) => w.includes('excedente')));
  assert.equal(savings(0, 100, 150).result.coveredPct, 0);
});

test('orientación: Buenos Aires -34,6 -> 35° al Norte; ecuador -> mínimo 10°; fuera de rango se acota', () => {
  assert.deepEqual(orientation(-34.6).result, { angle: 35, azimuth: 'Norte (0°)', azimuthDeg: 0 });
  assert.equal(orientation(40).result.azimuthDeg, 180);
  assert.equal(orientation(2).result.angle, 10);
  assert.equal(orientation(-120).result.angle, 90);
  assert.ok(orientation(-120).warnings.length >= 2);
});

test('contraseña: hash scrypt verificable, sin "$" (Prisma expande variables del .env)', () => {
  const h = hashPassword('una clave larga');
  assert.ok(!h.includes('$'));
  assert.equal(verifyPassword('una clave larga', h), true);
  assert.equal(verifyPassword('otra', h), false);
  assert.equal(verifyPassword('x', undefined), false);
  assert.equal(verifyPassword('x', 'basura'), false);
});

test('token: firma, vencimiento y manipulación', () => {
  const t = issueToken('admin', 's3cret', { now: 1000 });
  assert.equal(verifyToken(t, 's3cret', 1001)!.sub, 'admin');
  assert.equal(verifyToken(t, 'otro', 1001), null);
  assert.equal(verifyToken(t, 's3cret', 1000 + 13 * 3600), null); // vencido
  const [h, , s] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'admin', exp: 9e9 })).toString('base64url');
  assert.equal(verifyToken(`${h}.${forged}.${s}`, 's3cret', 1001), null);
  assert.equal(verifyToken('a.b', 's3cret'), null);
});

test('consumo: name que no es texto (número, objeto, null) no rompe y usa el genérico', () => {
  const r = consumption([
    { name: 123 as any, power: 100, qty: 1, hours: 30 },
    { name: { a: 1 } as any, power: -1, qty: 1, hours: 1 },
    { name: null as any, power: 10, qty: 1, hours: 1 },
  ]);
  assert.ok(r.warnings.some((w) => w.startsWith('el equipo 1:')));
  assert.ok(r.warnings.some((w) => w.includes('en el equipo 2')));
  assert.equal(r.result.items, 3);
});
