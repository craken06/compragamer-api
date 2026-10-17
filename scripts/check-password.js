/*
 * Revisa, en tu PC, si una contraseña coincide con el ADMIN_PASSWORD_HASH cargado en Render.
 *   node scripts/check-password.js
 * Pide el hash (copialo tal cual de Render) y la contraseña; no los guarda ni los manda a ningún lado.
 * Misma verificación que el login (src/auth/token.ts).
 */
const readline = require('readline');
const { scryptSync, timingSafeEqual } = require('crypto');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lines = rl[Symbol.asyncIterator]();
const ask = async (q) => { process.stdout.write(q); return (await lines.next()).value ?? ''; };

(async () => {
  const stored = await ask('ADMIN_PASSWORD_HASH (pegalo tal cual está en Render): ');
  const password = await ask('Contraseña: ');
  rl.close();
  console.log('');

  if (stored !== stored.trim()) console.log('- El hash tiene espacios al principio o al final: borralos en Render.');
  if (/["']/.test(stored)) console.log('- El hash tiene comillas: en Render va sin comillas.');
  const [algo, salt, hash] = stored.trim().replace(/^["']|["']$/g, '').split(':');
  if (algo !== 'scrypt' || !salt || !hash) {
    console.log('- El hash no tiene el formato scrypt:<sal>:<hash>. Generalo con: node scripts/hash-password.js');
    return;
  }
  if (password !== password.trim()) console.log('- La contraseña tiene espacios al principio o al final.');
  const a = Buffer.from(scryptSync(password, salt, 64).toString('hex'));
  const b = Buffer.from(hash);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  console.log(ok ? 'La contraseña COINCIDE con el hash.' : 'La contraseña NO coincide con el hash.');
})();
