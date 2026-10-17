/*
 * Reglas del estado de entrega (spec 4.8).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedFulfillment, assertFulfillment, fulfillmentData } from '../src/orders/fulfillment';

const ALL = ['pendiente', 'preparando', 'enviado', 'listo_para_retirar', 'entregado'] as const;

test('pedido no pagado: ningún cambio de entrega', () => {
  for (const status of ['pendiente_pago', 'cotizacion', 'rechazado', 'cancelado'] as const) {
    assert.deepEqual(allowedFulfillment({ status, deliveryMethod: 'envio' }), []);
    for (const f of ALL) {
      assert.throws(() => assertFulfillment({ status, deliveryMethod: 'envio' }, f), {
        name: 'BadRequestException', message: 'Solo se puede cambiar la entrega de un pedido pagado.',
      });
    }
  }
});

test('envío pagado: pendiente, preparando, enviado, entregado; no listo_para_retirar', () => {
  const o = { status: 'pagado' as const, deliveryMethod: 'envio' as const };
  assert.deepEqual(allowedFulfillment(o), ['pendiente', 'preparando', 'enviado', 'entregado']);
  for (const f of ['pendiente', 'preparando', 'enviado', 'entregado'] as const) assert.doesNotThrow(() => assertFulfillment(o, f));
  assert.throws(() => assertFulfillment(o, 'listo_para_retirar'), { name: 'BadRequestException', message: 'Ese estado no corresponde al tipo de entrega.' });
});

test('retiro pagado: listo_para_retirar sí, enviado no', () => {
  const o = { status: 'pagado' as const, deliveryMethod: 'retiro' as const };
  assert.deepEqual(allowedFulfillment(o), ['pendiente', 'preparando', 'listo_para_retirar', 'entregado']);
  for (const f of ['pendiente', 'preparando', 'listo_para_retirar', 'entregado'] as const) assert.doesNotThrow(() => assertFulfillment(o, f));
  assert.throws(() => assertFulfillment(o, 'enviado'), { message: 'Ese estado no corresponde al tipo de entrega.' });
});

test('estado desconocido: rechazado', () => {
  assert.throws(() => assertFulfillment({ status: 'pagado', deliveryMethod: 'envio' }, 'perdido' as any), { message: 'Ese estado no corresponde al tipo de entrega.' });
});

test('trackingNumber: solo con enviado, recortado a 80', () => {
  assert.deepEqual(fulfillmentData('enviado', '  AB123  '), { fulfillmentStatus: 'enviado', trackingNumber: 'AB123' });
  assert.equal(fulfillmentData('enviado', 'x'.repeat(100)).trackingNumber, 'x'.repeat(80));
  assert.equal(fulfillmentData('enviado', '   ').trackingNumber, null);
  assert.equal(fulfillmentData('enviado').trackingNumber, null);
  assert.deepEqual(fulfillmentData('preparando', 'AB123'), { fulfillmentStatus: 'preparando', trackingNumber: null });
  assert.equal(fulfillmentData('entregado', 'AB123').trackingNumber, null);
});
