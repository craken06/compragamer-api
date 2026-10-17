import { test } from 'node:test';
import assert from 'node:assert/strict';
import { securityHeaders } from '../src/security-headers';

test('headers de seguridad: nosniff, sin framing, sin referrer, HSTS y CORP; llama a next', () => {
  const set: Record<string, string> = {};
  let nextCalled = false;
  securityHeaders({}, { setHeader: (k: string, v: string) => (set[k] = v) }, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.deepEqual(set, {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    // same-origin solo frena pedidos no-cors (<img>, <script>); los fetch CORS del sitio no se ven afectados
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
});
