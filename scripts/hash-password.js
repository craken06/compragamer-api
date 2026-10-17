/*
 * Genera el valor de ADMIN_PASSWORD_HASH para el .env (o las variables de Render).
 *   node scripts/hash-password.js
 * Pide la contraseña por la consola (no va como argumento para que no quede en el historial).
 * Misma función que usa el login (src/auth/token.ts): scrypt con sal aleatoria.
 */
const readline = require('readline');
const { randomBytes, scryptSync } = require('crypto');

// la pregunta va por stderr: por stdout sale solo el hash (se puede copiar o redirigir tal cual)
const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
const lines = rl[Symbol.asyncIterator]();
const ask = async (q) => { process.stderr.write(q); return (await lines.next()).value ?? ''; };

(async () => {
  const password = await ask('Contraseña (mínimo 10 caracteres): ');
  rl.close();
  if (password.length < 10) {
    console.error('La contraseña tiene que tener al menos 10 caracteres.');
    process.exit(1);
  }
  if (password !== password.trim()) console.error('Ojo: la contraseña tiene espacios al principio o al final.');
  const salt = randomBytes(16).toString('hex');
  console.log(`scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`);
})();
