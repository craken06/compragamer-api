import { Injectable, Logger } from '@nestjs/common';

/*
 * Cliente mínimo de Resend (https://resend.com/docs/api-reference/emails/send-email), con fetch y sin SDK.
 *  - RESEND_API_KEY: clave de la cuenta (permiso "Sending access"). Sin ella no se envía nada.
 *  - MAIL_FROM: remitente de un dominio verificado en Resend, p. ej. "AURYX <avisos@auryx.com.ar>".
 */

const RESEND_API = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'AURYX <avisos@auryx.com.ar>';

export interface OutgoingMail { to: string; subject: string; html: string; text: string; replyTo?: string }

@Injectable()
export class MailClient {
  private readonly logger = new Logger(MailClient.name);

  get enabled() {
    return !!process.env.RESEND_API_KEY;
  }

  /** Envía un mail. Lanza si Resend no lo acepta (el reintento lo decide MailService). Sin clave, no hace nada. */
  async send(mail: OutgoingMail): Promise<void> {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      this.logger.log(`Mail no enviado (falta RESEND_API_KEY): "${mail.subject}"`);
      return;
    }
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || DEFAULT_FROM,
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Resend respondió ${res.status}: ${text.slice(0, 300)}`);
    }
  }
}
