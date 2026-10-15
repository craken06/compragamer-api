/*
 * Genera el valor de ADMIN_PASSWORD_HASH para el .env (o las variables de Render).
 *   node scripts/hash-password.js "mi contraseña larga"
 * Misma función que usa el login (src/auth/token.ts): scrypt con sal aleatoria.
 */
const { randomBytes, scryptSync } = require('crypto');

const password = process.argv[2];
if (!password || password.length < 10) {
  console.error('Uso: node scripts/hash-password.js "contraseña" (mínimo 10 caracteres)');
  process.exit(1);
}
const salt = randomBytes(16).toString('hex');
console.log(`scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`);
