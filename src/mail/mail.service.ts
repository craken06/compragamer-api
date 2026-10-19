import { Injectable, Logger } from '@nestjs/common';
import { MailClient, OutgoingMail } from './mail.client';
import {
  ContactMail, OrderMail, OrderMailKind, contactAck, contactNotice, fulfillmentCustomer, orderCustomer, orderNotice,
} from './templates';

/*
 * Qué mail sale y a quién. Se envía en segundo plano, después de guardar: nunca demora ni hace
 * fallar la respuesta. Un reintento; si vuelve a fallar queda en el log (el dato ya está en el admin).
 *  - NOTIFY_EMAIL: adónde van los avisos internos (contacto@auryx.com.ar, que reenvía Cloudflare). Vacío = sin avisos.
 *  - FRONTEND_URL: base de los links a /pedido/<código>/ y al admin.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly pending = new Set<Promise<void>>();
  retryDelayMs = 3000;

  constructor(private client: MailClient) {}

  private get notifyTo() {
    return (process.env.NOTIFY_EMAIL || '').trim();
  }
  private get site() {
    return process.env.FRONTEND_URL || 'https://auryx.com.ar';
  }

  /** Envía en segundo plano (no se espera). Nunca lanza. */
  dispatch(mails: OutgoingMail[]): void {
    for (const mail of mails) {
      const job = this.sendWithRetry(mail).finally(() => this.pending.delete(job));
      this.pending.add(job);
    }
  }

  /** Espera los envíos en curso (tests y apagado). */
  async flush(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  private async sendWithRetry(mail: OutgoingMail): Promise<void> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await this.client.send(mail);
        return;
      } catch (err) {
        if (attempt === 2) {
          this.logger.error(`No se pudo enviar "${mail.subject}" a ${mail.to}: ${(err as Error)?.message}`);
          return;
        }
        await new Promise((r) => setTimeout(r, this.retryDelayMs));
      }
    }
  }

  private notice(m: { subject: string; html: string; text: string }, replyTo?: string): OutgoingMail[] {
    return this.notifyTo ? [{ to: this.notifyTo, ...m, ...(replyTo ? { replyTo } : {}) }] : [];
  }

  /** Mensaje de contacto o arrepentimiento (con `revocationCode`). */
  contactReceived(m: ContactMail, revocationCode?: string): void {
    this.dispatch([
      { to: m.email, ...contactAck(m, revocationCode), ...(this.notifyTo ? { replyTo: this.notifyTo } : {}) },
      ...this.notice(contactNotice(m, revocationCode), m.email),
    ]);
  }

  /** Pedido guardado como cotización o recién pagado. */
  orderReceived(o: OrderMail, kind: OrderMailKind): void {
    this.dispatch([
      { to: o.customerEmail, ...orderCustomer(o, kind, this.site), ...(this.notifyTo ? { replyTo: this.notifyTo } : {}) },
      ...this.notice(orderNotice(o, kind, this.site), o.customerEmail),
    ]);
  }

  /** Cambio de estado de entrega (solo los que avisan al cliente). */
  fulfillmentChanged(o: OrderMail): void {
    const m = fulfillmentCustomer(o, this.site);
    if (m) this.dispatch([{ to: o.customerEmail, ...m, ...(this.notifyTo ? { replyTo: this.notifyTo } : {}) }]);
  }
}
