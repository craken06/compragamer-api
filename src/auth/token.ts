import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/*
 * Login de un único administrador, sin dependencias externas.
 *  - Contraseña: ADMIN_PASSWORD_HASH con formato "scrypt:<salt hex>:<hash hex>"
 *    (se genera con: node scripts/hash-password.js "mi clave").
 *  - Token: payload JSON en base64url + firma HMAC-SHA256 con JWT_SECRET (mismo formato que un JWT HS256).
 */

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export const TOKEN_TTL_SECONDS = 12 * 60 * 60;

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')): string {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string | undefined): boolean {
  if (!stored) return false;
  const [algo, salt, hash] = stored.split(':');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const a = Buffer.from(scryptSync(password, salt, 64).toString('hex'));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sign(data: string, secret: string) {
  return b64url(createHmac('sha256', secret).update(data).digest());
}

export function issueToken(sub: string, secret: string, now = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub, iat: now, exp: now + TOKEN_TTL_SECONDS }));
  return `${header}.${payload}.${sign(`${header}.${payload}`, secret)}`;
}

/** Devuelve el payload si la firma y el vencimiento son válidos; si no, null. */
export function verifyToken(token: string, secret: string, now = Math.floor(Date.now() / 1000)): { sub: string; exp: number } | null {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`, secret));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(fromB64url(parts[1]).toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}
