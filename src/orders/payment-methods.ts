/*
 * Medios de pago habilitados. Mercado Pago depende de MP_ACCESS_TOKEN; la transferencia, de:
 *  - TRANSFER_ENABLED=true
 *  - TRANSFER_BANK = {"holder","cuit","bank","cbu","alias"} (JSON). Sin titular y CBU o alias, queda deshabilitada.
 *  - TRANSFER_DISCOUNT_PCT (0 por defecto) y TRANSFER_DEADLINE_HOURS (72 por defecto).
 */

export type PaymentMethod = 'mercadopago' | 'transferencia';
export const PAYMENT_METHODS: PaymentMethod[] = ['mercadopago', 'transferencia'];

export interface BankAccount { holder: string; cuit: string; bank: string; cbu: string; alias: string }

export interface TransferConfig {
  enabled: boolean;
  bank: BankAccount | null;
  discountPct: number;
  deadlineHours: number;
}

/** Línea del pedido con el descuento por transferencia (sin FK, como la instalación con product_id 0). */
export const TRANSFER_DISCOUNT_PRODUCT_ID = -1;

function parseBank(raw: string | undefined): BankAccount | null {
  if (!raw) return null;
  try {
    const b = JSON.parse(raw);
    const s = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
    const bank: BankAccount = { holder: s(b.holder, 120), cuit: s(b.cuit, 20), bank: s(b.bank, 80), cbu: s(b.cbu, 30), alias: s(b.alias, 40) };
    return bank.holder && (bank.cbu || bank.alias) ? bank : null;
  } catch {
    return null;
  }
}

function num(raw: string | undefined, def: number, min: number, max: number) {
  const n = Number(raw);
  return raw !== undefined && raw !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

export function transferConfig(env: NodeJS.ProcessEnv = process.env): TransferConfig {
  const bank = parseBank(env.TRANSFER_BANK);
  return {
    enabled: env.TRANSFER_ENABLED === 'true' && !!bank,
    bank,
    discountPct: num(env.TRANSFER_DISCOUNT_PCT, 0, 0, 50),
    deadlineHours: num(env.TRANSFER_DEADLINE_HOURS, 72, 1, 24 * 14),
  };
}

export function discountLabel(pct: number) {
  return `Descuento por transferencia (${pct} %)`;
}
