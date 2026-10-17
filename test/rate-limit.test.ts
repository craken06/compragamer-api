import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../src/common/rate-limit';
import { CalculatorsController } from '../src/calculators/calculators.controller';
import { CompatibilityController } from '../src/compatibility/compatibility.controller';

const is429 = (e: any) => e.getStatus() === 429;

test('RateLimiter: corta al pasar el máximo y libera al terminar la ventana', () => {
  const l = new RateLimiter(2, 1000, 'tope');
  l.check('a', 0); l.check('a', 10);
  assert.throws(() => l.check('a', 20), is429);
  l.check('b', 20); // otra clave no comparte el contador
  l.check('a', 1001);
});

test('RateLimiter: con más de 10 000 claves borra solo las vencidas, no resetea a las activas', () => {
  const l = new RateLimiter(1, 60_000, 'tope');
  l.check('victima', 100_000);
  for (let i = 0; i < 5000; i++) l.check(`vieja-${i}`, 0); // vencidas para t >= 60 000
  for (let i = 0; i < 5001; i++) l.check(`nueva-${i}`, 100_000 + i);
  // la poda corrió: las vencidas se fueron y las activas siguen
  assert.ok((l as any).hits.size <= 5002);
  assert.throws(() => l.check('victima', 106_000), is429);
  assert.throws(() => l.check('nueva-0', 106_000), is429);
});

test('POST /compatibility/evaluate: 120 por minuto por IP', async () => {
  const ctrl = new CompatibilityController({ evaluate: async () => ({ ok: true }) } as any);
  for (let i = 0; i < 120; i++) await ctrl.evaluate({} as any, '1.2.3.4');
  assert.throws(() => ctrl.evaluate({} as any, '1.2.3.4'), is429);
  assert.deepEqual(await ctrl.evaluate({} as any, '5.6.7.8'), { ok: true });
});

test('POST /calculators/*: 300 por minuto por IP, compartido entre las cuatro', () => {
  const ctrl = new CalculatorsController();
  for (let i = 0; i < 75; i++) {
    ctrl.consumption({ items: [] }, '1.2.3.4');
    ctrl.cost({ kwh: 1, pricePerKwh: 1 }, '1.2.3.4');
    ctrl.savings({ currentKwh: 1, solarKwh: 1, energyPrice: 1 }, '1.2.3.4');
    ctrl.orientation({ lat: -34 }, '1.2.3.4');
  }
  assert.throws(() => ctrl.orientation({ lat: -34 }, '1.2.3.4'), is429);
  assert.equal(ctrl.orientation({ lat: -34 }, '9.9.9.9').result.angle > 0, true);
});
