import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CompatibilityService } from '../src/compatibility/compatibility.service';

// Prisma falso: cuenta las lecturas a la base y deja cambiar el catálogo entre pedidos.
function fakePrisma() {
  const state = {
    productReads: 0,
    ruleReads: 0,
    failProducts: false,
    products: <any[]>[
      { id: 1, name: 'Panel 550', active: true, category: { slug: 'panel' }, specs: { voc: 49.6, isc: 13.9, vmp: 41.3, imp: 13.32, pmax: 550 } },
      { id: 2, name: 'Inversor 5k', active: true, category: { slug: 'inversor' }, specs: { maxPvVoltage: 550, maxInputCurrentPerMppt: 13.5, maxShortCircuitCurrentPerMppt: 16.5, mpptRangeMin: 120, mpptRangeMax: 550, maxPvPower: 8600, mpptCount: 2 } },
    ],
  };
  const prisma = {
    product: {
      findMany: async () => {
        state.productReads++;
        if (state.failProducts) throw new Error('base dormida');
        return state.products;
      },
    },
    compatibilityRule: { findMany: async () => { state.ruleReads++; return []; } }, // vacía: reglas por defecto
  };
  return { state, prisma };
}

const req = { panel: { productId: 1, qty: 10, wiring: 'series' as const }, converterIds: [2] };

test('evaluate: el catálogo y las reglas se leen una vez y después salen de memoria', async () => {
  const { state, prisma } = fakePrisma();
  const svc = new CompatibilityService(prisma as any);
  const a = await svc.evaluate(req);
  const b = await svc.evaluate({ ...req, panel: { ...req.panel, qty: 9 } });
  await svc.evaluate(req);
  assert.equal(state.productReads, 1);
  assert.equal(state.ruleReads, 1);
  assert.ok(a.converters[2]);
  assert.ok(b.converters[2]);
});

test('evaluate: con la copia vencida responde con ella y la renueva en segundo plano', async () => {
  const { state, prisma } = fakePrisma();
  const svc = new CompatibilityService(prisma as any);
  await svc.evaluate(req);
  (svc as any).productsCache.at -= 61 * 1000; // vence la copia
  state.products = state.products.map((p) => (p.id === 2 ? { ...p, specs: { ...p.specs, maxPvVoltage: 400 } } : p));
  const stale = await svc.evaluate(req); // todavía con la copia vieja: 550 V admitidos
  assert.notEqual(stale.converters[2]!.status, 'bad');
  await new Promise((r) => setImmediate(r)); // termina la renovación
  const fresh = await svc.evaluate(req); // 10 x 49,6 V en frío > 400 V
  assert.equal(fresh.converters[2]!.status, 'bad');
  assert.equal(state.productReads, 2);
});

test('evaluate: si la renovación falla, sigue con la copia anterior sin romper', async () => {
  const { state, prisma } = fakePrisma();
  const svc = new CompatibilityService(prisma as any);
  await svc.evaluate(req);
  (svc as any).productsCache.at -= 61 * 1000;
  state.failProducts = true;
  const r = await svc.evaluate(req);
  assert.ok(r.converters[2]);
  await new Promise((r2) => setImmediate(r2));
  assert.ok((await svc.evaluate(req)).converters[2]);
});

test('evaluate: sin copia y con la base caída, el error llega al que pidió (el sitio usa su motor local)', async () => {
  const { state, prisma } = fakePrisma();
  state.failProducts = true;
  const svc = new CompatibilityService(prisma as any);
  await assert.rejects(svc.evaluate(req), /base dormida/);
});

test('evaluate: un producto inactivo o inexistente no se evalúa (igual que antes del caché)', async () => {
  const { prisma } = fakePrisma();
  const svc = new CompatibilityService(prisma as any);
  const r = await svc.evaluate({ ...req, converterIds: [2, 99] });
  assert.ok(r.converters[2]);
  assert.equal(99 in r.converters, false);
});

test('evaluate: cada batería trae minQty (cuántas hacen falta) además del veredicto a la cantidad pedida', async () => {
  const { state, prisma } = fakePrisma();
  state.products.push(
    { id: 3, name: 'Híbrido 6k', active: true, category: { slug: 'inversor' }, specs: { maxPvVoltage: 600, batteryVoltageMin: 40, batteryVoltageMax: 60, ratedPowerAC: 6000 } },
    { id: 4, name: 'Batería 48 V 37 A', active: true, category: { slug: 'bateria' }, specs: { nominalVoltage: 48, maxContinuousCurrent: 37 } },
    { id: 5, name: 'Batería HV', active: true, category: { slug: 'bateria' }, specs: { nominalVoltage: 400, maxContinuousCurrent: 25 } },
  );
  const svc = new CompatibilityService(prisma as any);
  const r = await svc.evaluate({ ...req, converterIds: [3], converterId: 3, batteryIds: [4, 5, 2], batteryQty: 1 });
  assert.equal(r.batteries[4]!.status, 'warning');
  assert.equal(r.batteries[4]!.minQty, 4);
  assert.equal(r.batteries[5]!.status, 'bad');
  assert.equal(r.batteries[5]!.minQty, null);
  assert.equal(2 in r.batteries, false); // un inversor no es batería
});
