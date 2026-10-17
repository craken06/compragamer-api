import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateOrderCode, withUniqueCode, ORDER_CODE_RE } from '../src/orders/order-code';

test('formato', () => {
  for (let i = 0; i < 1000; i++) assert.match(generateOrderCode(), ORDER_CODE_RE);
});

test('sin caracteres confusos', () => {
  for (let i = 0; i < 1000; i++) assert.doesNotMatch(generateOrderCode().slice(3), /[01ILO]/);
});

const choque = () => Object.assign(new Error('unique'), { code: 'P2002', meta: { target: ['code'] } });

test('reintenta ante choque', async () => {
  let calls = 0;
  const r = await withUniqueCode(async (c) => {
    calls++;
    if (calls <= 2) throw choque();
    return c;
  });
  assert.match(r, ORDER_CODE_RE);
  assert.equal(calls, 3);
});

test('target como string también cuenta', async () => {
  let calls = 0;
  await withUniqueCode(async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error('u'), { code: 'P2002', meta: { target: 'orders_code_key' } });
    return 1;
  });
  assert.equal(calls, 2);
});

test('se rinde a los 5', async () => {
  let calls = 0;
  await assert.rejects(withUniqueCode(async () => { calls++; throw choque(); }));
  assert.equal(calls, 5);
});

test('otro error no reintenta', async () => {
  let calls = 0;
  await assert.rejects(withUniqueCode(async () => { calls++; throw new Error('x'); }), /x/);
  assert.equal(calls, 1);
});

test('P2002 sobre otro campo no reintenta', async () => {
  let calls = 0;
  await assert.rejects(withUniqueCode(async () => { calls++; throw Object.assign(new Error('u'), { code: 'P2002', meta: { target: ['public_id'] } }); }));
  assert.equal(calls, 1);
});
