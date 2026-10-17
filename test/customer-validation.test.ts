import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { PROVINCES, normalizePhone, normalizeAddress, normalizeBilling, isValidCuit } from '../src/customers/validation';

const bad = (fn: () => unknown, re?: RegExp) => assert.throws(fn, (e: any) => e instanceof BadRequestException && (!re || re.test(e.message)));

test('24 provincias', () => assert.equal(PROVINCES.length, 24));

test('teléfono: normaliza', () => {
  assert.equal(normalizePhone('+54 9 11 6685-8516'), '+5491166858516');
  assert.equal(normalizePhone('(011) 4555-1234'), '01145551234');
});
test('teléfono: largo inválido o tipo raro', () => {
  bad(() => normalizePhone('1234567'), /entre 8 y 15 números/);
  bad(() => normalizePhone('1234567890123456'));
  bad(() => normalizePhone(undefined));
  bad(() => normalizePhone(12345678));
});

const addr = { street: 'Av. Corrientes 1234', floor: '3° B', city: 'CABA', province: 'Ciudad Autónoma de Buenos Aires', zip: '1425' };

test('dirección válida', () => {
  assert.deepEqual(normalizeAddress(addr), addr);
});
test('dirección: zip y CPA', () => {
  assert.equal(normalizeAddress({ ...addr, zip: ' c1425abc ' }).zip, 'C1425ABC');
  bad(() => normalizeAddress({ ...addr, zip: '14' }), /postal/i);
});
test('dirección: provincia, piso, campos faltantes', () => {
  bad(() => normalizeAddress({ ...addr, province: 'Narnia' }), /provincia/i);
  assert.equal(normalizeAddress({ ...addr, floor: '' }).floor, null);
  assert.equal(normalizeAddress({ ...addr, floor: undefined }).floor, null);
  bad(() => normalizeAddress({ ...addr, street: '  ' }), /Falta la calle y el número\./);
  bad(() => normalizeAddress({ ...addr, city: 'A' }), /localidad/i);
  bad(() => normalizeAddress(null));
  bad(() => normalizeAddress('x'));
});

test('facturación vacía → null', () => {
  assert.equal(normalizeBilling(undefined), null);
  assert.equal(normalizeBilling(null), null);
  assert.equal(normalizeBilling({}), null);
  assert.equal(normalizeBilling({ doc: '', name: '' }), null);
  assert.equal(normalizeBilling({ doc: ' ', name: ' ' }), null);
});
test('facturación: DNI y CUIT', () => {
  assert.deepEqual(normalizeBilling({ doc: '30.123.456', name: ' Juan Pérez ' }), { doc: '30123456', name: 'Juan Pérez' });
  assert.equal(normalizeBilling({ doc: '20-12345678-6', name: 'Ana Gómez' })!.doc, '20123456786');
  assert.equal(normalizeBilling({ doc: '20111111112', name: 'Ana Gómez' })!.doc, '20111111112');
  bad(() => normalizeBilling({ doc: '20123456787', name: 'Ana Gómez' }), /CUIT/);
  bad(() => normalizeBilling({ doc: '123456', name: 'Ana Gómez' }));
});
test('facturación: nombre o documento solos o inválidos', () => {
  bad(() => normalizeBilling({ doc: '30123456', name: 'A' }));
  bad(() => normalizeBilling({ doc: '30123456', name: '' }), /nombre|razón/i);
  bad(() => normalizeBilling({ doc: '', name: 'Ana Gómez' }), /documento|DNI|CUIT/i);
});

test('isValidCuit', () => {
  assert.equal(isValidCuit('20123456786'), true);
  assert.equal(isValidCuit('20123456787'), false);
  assert.equal(isValidCuit('2012345678'), false);
  // dígito verificador 10 → inválido (suma%11 == 1)
  assert.equal(isValidCuit('20000000010'), false);
});
