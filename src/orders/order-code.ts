import { randomInt } from 'crypto';

// Sin 0, 1, I, L, O para que no se confundan al dictarlo o leerlo.
export const ORDER_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const ORDER_CODE_RE = /^AX-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

/** Código de pedido `AX-XXXXXX`, al azar (no correlativo, para no revelar el volumen de ventas). */
export function generateOrderCode(rand: (max: number) => number = (max) => randomInt(max)): string {
  let out = 'AX-';
  for (let i = 0; i < 6; i++) out += ORDER_CODE_ALPHABET[rand(ORDER_CODE_ALPHABET.length)];
  return out;
}

/** ¿Es un choque de la restricción única sobre `code`? (target puede ser array o string) */
function isCodeCollision(err: any): boolean {
  if (!err || err.code !== 'P2002') return false;
  const target = err.meta?.target;
  return Array.isArray(target) ? target.includes('code') : typeof target === 'string' && target.includes('code');
}

/** Ejecuta `create` con un código nuevo; si choca con uno existente reintenta (hasta `attempts` veces). */
export async function withUniqueCode<T>(
  create: (code: string) => Promise<T>,
  gen: () => string = () => generateOrderCode(),
  attempts = 5,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await create(gen());
    } catch (err) {
      if (!isCodeCollision(err)) throw err;
      last = err;
    }
  }
  throw last;
}
