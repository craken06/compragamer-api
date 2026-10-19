import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productTitle } from '../src/products/title';

// Mismos casos que se probaron con productTitle del sitio (src/utils/format.js): los dos nombran igual.
test('nombre con la marca (patrón nuevo): se usa tal cual, aunque la marca venga abreviada', () => {
  assert.equal(productTitle({ brand: 'Jinko Solar', name: 'Panel Solar Jinko N-Type TOPCon – Tiger Neo – 585 W' }), 'Panel Solar Jinko N-Type TOPCon – Tiger Neo – 585 W');
  assert.equal(productTitle({ brand: 'JA Solar', name: 'Panel Solar JA Solar N-Type TOPCon – DeepBlue 4.0 Pro – 590 W' }), 'Panel Solar JA Solar N-Type TOPCon – DeepBlue 4.0 Pro – 590 W');
  assert.equal(productTitle({ brand: 'LG Energy Solution', name: 'Batería de Litio LG Alto Voltaje 350 V – RESU10H Prime – 9,6 kWh' }), 'Batería de Litio LG Alto Voltaje 350 V – RESU10H Prime – 9,6 kWh');
});

test('nombre técnico sin la marca (como antes): la marca va adelante', () => {
  assert.equal(productTitle({ brand: 'Jinko Solar', name: 'Tiger Neo 72HL4-V 585W' }), 'Jinko Solar Tiger Neo 72HL4-V 585W');
  assert.equal(productTitle({ brand: 'SOK', name: '48V 100Ah Server Rack Battery' }), 'SOK 48V 100Ah Server Rack Battery');
});

test('la marca cuenta solo como palabra completa; sin marca, el nombre', () => {
  assert.equal(productTitle({ brand: 'SMA', name: 'Smart cable' }), 'SMA Smart cable');
  assert.equal(productTitle({ brand: '', name: 'Sin marca' }), 'Sin marca');
  assert.equal(productTitle({ brand: 'Q.Cells', name: 'Panel Q.Cells 480' }), 'Panel Q.Cells 480'); // caracteres de regex en la marca
});
