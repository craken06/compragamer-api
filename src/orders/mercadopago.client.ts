import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

/*
 * Cliente mínimo de la API de Mercado Pago (Checkout Pro), con fetch y sin SDK.
 *  - MP_ACCESS_TOKEN: credencial privada de la cuenta (de prueba "TEST-..." o productiva "APP_USR-...").
 *  - MP_WEBHOOK_SECRET: clave secreta de las notificaciones (panel de MP > Webhooks). Opcional pero recomendada.
 * Nunca se confía en el cuerpo del webhook: el estado del pago se vuelve a consultar a MP.
 */

const MP_API = 'https://api.mercadopago.com';

export interface PreferenceItem { id: string; title: string; quantity: number; unit_price: number }
export interface MpPayment { id: number; status: string; status_detail?: string; external_reference?: string; transaction_amount?: number; currency_id?: string }

@Injectable()
export class MercadoPagoClient {
  private readonly logger = new Logger(MercadoPagoClient.name);

  get enabled() {
    return !!process.env.MP_ACCESS_TOKEN;
  }

  private async call<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) throw new ServiceUnavailableException('El pago online todavía no está configurado (falta MP_ACCESS_TOKEN).');
    const res = await fetch(`${MP_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`Mercado Pago ${method} ${path} respondió ${res.status}: ${text.slice(0, 300)}`);
      throw new ServiceUnavailableException('Mercado Pago no respondió correctamente. Probá de nuevo en unos minutos.');
    }
    return (await res.json()) as T;
  }

  createPreference(opts: {
    externalReference: string; items: PreferenceItem[]; payerEmail: string; payerName: string;
    backUrl: string; notificationUrl?: string;
  }) {
    return this.call<{ id: string; init_point: string; sandbox_init_point?: string }>('POST', '/checkout/preferences', {
      items: opts.items.map((i) => ({ ...i, currency_id: 'ARS' })),
      payer: { email: opts.payerEmail, name: opts.payerName },
      external_reference: opts.externalReference,
      back_urls: { success: opts.backUrl, failure: opts.backUrl, pending: opts.backUrl },
      auto_return: 'approved',
      statement_descriptor: 'AURYX',
      ...(opts.notificationUrl ? { notification_url: opts.notificationUrl } : {}),
    }, `pref-${opts.externalReference}`);
  }

  getPayment(id: string) {
    return this.call<MpPayment>('GET', `/v1/payments/${encodeURIComponent(id)}`);
  }

  /**
   * Valida el header x-signature de la notificación ("ts=...,v1=...") según la doc de MP:
   * HMAC-SHA256(secret, "id:<data.id>;request-id:<x-request-id>;ts:<ts>;").
   * Si no hay MP_WEBHOOK_SECRET configurado devuelve true (igual se consulta el pago a MP).
   */
  verifySignature(signature: string | undefined, requestId: string | undefined, dataId: string): boolean {
    const secret = process.env.MP_WEBHOOK_SECRET;
    if (!secret) return true;
    if (!signature) return false;
    const parts = Object.fromEntries(signature.split(',').map((p) => p.split('=').map((s) => s.trim())));
    if (!parts.ts || !parts.v1) return false;
    const manifest = `id:${dataId.toLowerCase()};request-id:${requestId ?? ''};ts:${parts.ts};`;
    const expected = Buffer.from(createHmac('sha256', secret).update(manifest).digest('hex'));
    const given = Buffer.from(parts.v1);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}
