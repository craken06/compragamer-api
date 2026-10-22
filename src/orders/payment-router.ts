import { Injectable } from '@nestjs/common';
import { MpPayment } from './mercadopago.client';

/*
 * Un solo webhook de Mercado Pago para todo lo que se cobra. Según el prefijo del external_reference,
 * el pago va a otro módulo (CU- = inscripción a un curso); sin prefijo registrado, es un pedido de la
 * tienda (AX- o el UUID de los pedidos viejos). Así Pedidos no depende de Cursos.
 */

/** Lo mismo que devuelve el webhook de pedidos: el código y el estado resultante, o por qué se ignoró. */
export interface PaymentResult { code?: string; status?: string; ignored?: string }
export type PaymentHandler = (payment: MpPayment) => Promise<PaymentResult>;

@Injectable()
export class PaymentRouter {
  private readonly handlers = new Map<string, PaymentHandler>();

  register(prefix: string, handler: PaymentHandler) {
    this.handlers.set(prefix, handler);
  }

  find(ref: string | undefined): PaymentHandler | null {
    if (!ref) return null;
    for (const [prefix, handler] of this.handlers) if (ref.startsWith(prefix)) return handler;
    return null;
  }
}
