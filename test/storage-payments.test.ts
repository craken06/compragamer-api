/*
 * Firma SigV4 de R2 (contra el ejemplo publicado por AWS), validación de subidas y configuración
 * de medios de pago. Sin red.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presignUrl, rfc3986 } from '../src/storage/sigv4';
import { RECEIPT_RULE, checkUpload } from '../src/storage/storage.service';
import { transferConfig } from '../src/orders/payment-methods';

test('SigV4: URL prefirmada igual al ejemplo de la documentación de AWS (GET /test.txt)', () => {
  const url = presignUrl({
    method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    expires: 86400, date: new Date('2013-05-24T00:00:00Z'),
  });
  assert.ok(url.endsWith('X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404'), url);
  assert.ok(url.includes('X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request'));
});

test('SigV4: codificación RFC 3986 y rutas con espacios', () => {
  assert.equal(rfc3986("a b!'()*"), 'a%20b%21%27%28%29%2A');
  const url = presignUrl({ method: 'PUT', host: 'h', path: '/b/mi archivo.pdf', region: 'auto', accessKeyId: 'a', secretAccessKey: 's', expires: 60, headers: { 'Content-Type': 'application/pdf' } });
  assert.ok(url.startsWith('https://h/b/mi%20archivo.pdf?'));
  assert.ok(url.includes('X-Amz-SignedHeaders=content-type%3Bhost'));
});

test('checkUpload: extensión, tipo, tamaño y nombre limpio', () => {
  assert.deepEqual(checkUpload({ filename: 'Comp "1".JPG', size: 10, contentType: 'image/jpeg' }, RECEIPT_RULE),
    { ext: 'jpg', contentType: 'image/jpeg', size: 10, filename: 'Comp _1_.JPG' });
  assert.throws(() => checkUpload({ filename: 'a.pdf', size: 0 }, RECEIPT_RULE), /vacío/);
  assert.throws(() => checkUpload({ filename: 'a.pdf', size: 1.5 }, RECEIPT_RULE), /vacío/);
  assert.throws(() => checkUpload({ filename: 'sin-extension', size: 10 }, RECEIPT_RULE), /no permitido/);
  assert.throws(() => checkUpload({ filename: 'a.pdf', size: 8 * 1024 * 1024 + 1 }, RECEIPT_RULE), /8 MB/);
});

test('transferConfig: necesita TRANSFER_ENABLED=true y banco con titular y CBU o alias; límites de descuento y plazo', () => {
  const bank = JSON.stringify({ holder: 'AURYX', alias: 'auryx.solar' });
  assert.equal(transferConfig({}).enabled, false);
  assert.equal(transferConfig({ TRANSFER_ENABLED: 'true' }).enabled, false);
  assert.equal(transferConfig({ TRANSFER_ENABLED: 'true', TRANSFER_BANK: '{no es json' }).enabled, false);
  assert.equal(transferConfig({ TRANSFER_ENABLED: 'true', TRANSFER_BANK: JSON.stringify({ holder: 'AURYX' }) }).enabled, false);
  const c = transferConfig({ TRANSFER_ENABLED: 'true', TRANSFER_BANK: bank, TRANSFER_DISCOUNT_PCT: '99', TRANSFER_DEADLINE_HOURS: '0' });
  assert.equal(c.enabled, true);
  assert.equal(c.bank!.alias, 'auryx.solar');
  assert.equal(c.discountPct, 50);
  assert.equal(c.deadlineHours, 1);
  assert.equal(transferConfig({ TRANSFER_ENABLED: 'true', TRANSFER_BANK: bank, TRANSFER_DISCOUNT_PCT: 'x' }).discountPct, 0);
});
