import { createPublicKey, verify } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';

/*
 * Verificación del comprobante (ID token) de Google Identity Services, sin dependencias:
 * JWT RS256 firmado con las claves públicas de Google (JWKS), validado con el módulo crypto de Node.
 */

export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

export type Jwk = { kid: string; kty: 'RSA'; n: string; e: string; alg?: string };

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

const FAIL_MESSAGE = 'No pudimos verificar tu cuenta de Google. Probá de nuevo.';
const fail = () => new UnauthorizedException(FAIL_MESSAGE);

const DEFAULT_TTL_MS = 3600 * 1000;
const FORCED_COOLDOWN_MS = 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

type FetchLike = (url: string) => Promise<{ ok: boolean; json(): Promise<any>; headers: { get(name: string): string | null } }>;

/**
 * Caché de las claves de Google según `Cache-Control: max-age` (3600 s si falta).
 * Si llega un `kid` que no está y la caché sigue vigente, fuerza una descarga, pero como máximo una cada 60 s
 * sin importar el `kid` (así, kids inventados no amplifican pedidos hacia Google). El vencimiento normal descarga igual que siempre.
 * Una descarga fallida devuelve null y no se guarda.
 */
export function createKeyCache(
  url: string,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
  now: () => number = () => Date.now(),
): (kid: string) => Promise<Jwk | null> {
  let keys = new Map<string, Jwk>();
  let expiresAt = 0;
  let lastForced = -Infinity; // momento de la última recarga forzada por kid desconocido

  async function download(): Promise<boolean> {
    try {
      const res = await fetchFn(url);
      if (!res.ok) return false;
      const body = await res.json();
      if (!body || !Array.isArray(body.keys)) return false;
      const m = new Map<string, Jwk>();
      for (const k of body.keys) if (k && typeof k.kid === 'string') m.set(k.kid, k as Jwk);
      const match = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
      keys = m;
      expiresAt = now() + (match ? Number(match[1]) * 1000 : DEFAULT_TTL_MS);
      return true;
    } catch {
      return false;
    }
  }

  return async (kid: string) => {
    const fresh = now() < expiresAt;
    if (fresh && keys.has(kid)) return keys.get(kid)!;
    if (fresh) {
      if (now() - lastForced < FORCED_COOLDOWN_MS) return null;
      lastForced = now(); // también si la descarga falla: el enfriamiento corre igual
    }
    if (!(await download())) return null;
    return keys.get(kid) ?? null;
  };
}

export async function verifyGoogleCredential(
  credential: string,
  opts: { clientId: string; getKey: (kid: string) => Promise<Jwk | null>; nowSeconds?: number },
): Promise<GoogleProfile> {
  try {
    if (!opts.clientId || typeof credential !== 'string') throw fail();
    const parts = credential.split('.');
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) throw fail();

    const header = JSON.parse(fromB64url(parts[0]).toString('utf8'));
    // Se descarta todo lo que no sea RS256 con kid antes de buscar claves (alg none / HS256 no llegan a la firma).
    if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string') throw fail();

    const jwk = await opts.getKey(header.kid);
    if (!jwk) throw fail();
    const publicKey = createPublicKey({ key: jwk as any, format: 'jwk' });
    const ok = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, fromB64url(parts[2]));
    if (!ok) throw fail();

    const c = JSON.parse(fromB64url(parts[1]).toString('utf8'));
    const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (!c || !ISSUERS.includes(c.iss)) throw fail();
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    if (!aud.includes(opts.clientId)) throw fail();
    if (typeof c.exp !== 'number' || !(c.exp > now - CLOCK_SKEW_SECONDS)) throw fail();
    if (c.email_verified !== true) throw fail();
    if (typeof c.sub !== 'string' || !c.sub) throw fail();
    if (typeof c.email !== 'string' || !c.email.trim()) throw fail();

    const email = c.email.trim().toLowerCase();
    const name = typeof c.name === 'string' && c.name.trim() ? c.name.trim() : email.split('@')[0];
    const picture = typeof c.picture === 'string' && c.picture ? c.picture : null;
    return { sub: c.sub, email, name, picture };
  } catch {
    throw fail();
  }
}
