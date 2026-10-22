/*
 * Plantillas de los mails: funciones puras (datos -> { subject, html, text }), sin red ni base.
 * Todo lo que escribe el cliente pasa por esc() en el HTML. El acuse de contacto no repite el
 * mensaje ni el nombre completo: si no, el formulario serviría para mandarle texto libre a un tercero.
 */

export interface RenderedMail { subject: string; html: string; text: string }

export interface ContactMail { id: number; name: string; email: string; phone?: string | null; message: string }

export interface OrderMail {
  code: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  deliveryMethod?: string | null;
  shippingAddress?: any;
  billingDoc?: string | null;
  billingName?: string | null;
  notes?: string | null;
  totalArs: number | string | { toString(): string };
  fulfillmentStatus?: string | null;
  trackingNumber?: string | null;
  items?: { productName: string; quantity: number; unitPriceArs: number | string | { toString(): string } }[];
}

/** Prefijo que pone el sitio en los mensajes del Botón de arrepentimiento (src/app.js). */
export const REVOCATION_PREFIX = '[BOTÓN DE ARREPENTIMIENTO]';

/** Código de la solicitud de arrepentimiento (Res. 424/2020): sale del id del mensaje guardado. */
export function revocationCode(id: number): string {
  return `ARR-${String(id).padStart(6, '0')}`;
}

const NAVY = '#05080f';
const YELLOW = '#f5b301';
const INK = '#121a2e';
const DIM = '#5a6681';
const LINE = '#d6dce7';

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const ars = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: unknown) => ars.format(Number(n));

/** Solo el primer nombre, sin links ni texto largo (ver comentario de arriba). */
function firstName(name: string): string {
  const first = String(name ?? '').trim().split(/\s+/)[0] ?? '';
  return /^[\p{L}'-]{1,30}$/u.test(first) ? first : '';
}
const hello = (name: string) => (firstName(name) ? `Hola ${firstName(name)},` : 'Hola,');

function siteBase(siteUrl: string) {
  return String(siteUrl || 'https://auryx.com.ar').replace(/\/+$/, '');
}

/** Estructura común del HTML: cabecera navy con la marca, cuerpo blanco y pie. `body` ya viene escapado. */
function layout(title: string, body: string, footer = 'AURYX · Energía solar y almacenamiento · auryx.com.ar'): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:${INK};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f9;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid ${LINE};border-radius:10px;overflow:hidden;">
<tr><td style="background:${NAVY};padding:18px 24px;border-bottom:4px solid ${YELLOW};"><span style="color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:3px;">AURYX</span></td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55;">${body}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid ${LINE};color:${DIM};font-size:12px;">${esc(footer)}</td></tr>
</table></td></tr></table></body></html>`;
}

const p = (html: string) => `<p style="margin:0 0 14px;">${html}</p>`;
const button = (href: string, label: string) =>
  `<p style="margin:20px 0;"><a href="${esc(href)}" style="background:${YELLOW};color:${NAVY};text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:6px;display:inline-block;">${esc(label)}</a></p>`;
const codeBox = (code: string) =>
  `<p style="margin:16px 0;font-size:22px;font-weight:bold;letter-spacing:2px;font-family:Consolas,monospace;">${esc(code)}</p>`;
const pre = (s: string) =>
  `<div style="white-space:pre-wrap;background:#f3f5f9;border:1px solid ${LINE};border-radius:6px;padding:12px;font-size:14px;">${esc(s)}</div>`;
const rows = (pairs: [string, string | null | undefined][]) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;margin:0 0 14px;">${pairs
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td style="padding:3px 12px 3px 0;color:${DIM};vertical-align:top;">${esc(k)}</td><td style="padding:3px 0;">${esc(v)}</td></tr>`)
    .join('')}</table>`;
const textRows = (pairs: [string, string | null | undefined][]) => pairs.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');

// ---------- contacto y arrepentimiento ----------

const isRevocation = (code?: string) => !!code;

/** Acuse al cliente. Con `code` es el de un arrepentimiento. */
export function contactAck(m: ContactMail, code?: string): RenderedMail {
  if (isRevocation(code)) {
    const subject = `Recibimos tu solicitud de arrepentimiento (${code})`;
    const lines = [
      hello(m.name),
      `Recibimos tu solicitud de arrepentimiento. Este es el código de tu solicitud: ${code}`,
      'Te vamos a escribir para coordinar la devolución. No tenés que hacer nada más por ahora.',
      'Si no la pediste vos, respondé este mail y la anulamos.',
    ];
    const html = layout(subject, [
      p(esc(hello(m.name))),
      p('Recibimos tu solicitud de arrepentimiento. Este es el código de tu solicitud:'),
      codeBox(code!),
      p('Te vamos a escribir para coordinar la devolución. No tenés que hacer nada más por ahora.'),
      p('Si no la pediste vos, respondé este mail y la anulamos.'),
    ].join(''));
    return { subject, html, text: `${lines.join('\n\n')}\n\nAURYX · auryx.com.ar` };
  }
  const subject = 'Recibimos tu mensaje';
  const lines = [
    hello(m.name),
    'Gracias por escribirnos. Recibimos tu mensaje y te respondemos a este mail lo antes posible, en general dentro del día hábil.',
    'Si querés sumar algo, respondé este mail.',
  ];
  const html = layout(subject, lines.map((l) => p(esc(l))).join(''));
  return { subject, html, text: `${lines.join('\n\n')}\n\nAURYX · auryx.com.ar` };
}

/** Aviso a AURYX con el mensaje completo (se responde con "Responder": va al cliente). */
export function contactNotice(m: ContactMail, code?: string): RenderedMail {
  const subject = isRevocation(code)
    ? `Arrepentimiento ${code} — ${m.name}`.slice(0, 150)
    : `Contacto: ${m.name}`.slice(0, 150);
  const data: [string, string | null | undefined][] = [
    ['Nombre', m.name], ['Email', m.email], ['Teléfono', m.phone ?? null], ...(code ? [['Código', code] as [string, string]] : []),
  ];
  const warning = isRevocation(code)
    ? 'Botón de arrepentimiento: el cliente ya recibió el código. Escribile dentro de las 24 h para coordinar la devolución (Res. 424/2020).'
    : '';
  const html = layout(subject, [
    warning ? p(`<strong>${esc(warning)}</strong>`) : '',
    rows(data),
    pre(m.message),
    p(`<span style="color:${DIM};font-size:13px;">Para contestar, respondé este mail: le llega a ${esc(m.email)}.</span>`),
  ].join(''), 'Aviso interno de auryx.com.ar');
  const text = [warning, textRows(data), '', m.message, '', `Para contestar, respondé este mail: le llega a ${m.email}.`].filter((l, i) => l || i > 0).join('\n');
  return { subject, html, text };
}

// ---------- pedidos ----------

export type OrderMailKind = 'cotizacion' | 'pagado';

function addressText(a: any): string | null {
  if (!a || typeof a !== 'object') return null;
  const street = [a.street, a.floor].filter(Boolean).join(' ');
  const zip = a.zip ? ` (CP ${a.zip})` : '';
  return [street, a.city, a.province].filter(Boolean).join(', ') + zip;
}

function deliveryText(o: OrderMail): string {
  if (o.deliveryMethod === 'envio') return `Envío a ${addressText(o.shippingAddress) ?? 'la dirección del pedido'}`;
  if (o.deliveryMethod === 'retiro') return 'Retiro: te avisamos cuando esté listo para retirar';
  return 'A coordinar';
}

function itemsHtml(o: OrderMail): string {
  const items = o.items ?? [];
  const body = items.map((i) =>
    `<tr><td style="padding:6px 8px 6px 0;border-bottom:1px solid ${LINE};">${esc(i.quantity)} × ${esc(i.productName)}</td><td align="right" style="padding:6px 0;border-bottom:1px solid ${LINE};white-space:nowrap;">${esc(money(Number(i.unitPriceArs) * i.quantity))}</td></tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:0 0 14px;">${body}
<tr><td style="padding:8px 8px 0 0;font-weight:bold;">Total</td><td align="right" style="padding:8px 0 0;font-weight:bold;white-space:nowrap;">${esc(money(o.totalArs))}</td></tr></table>`;
}
const itemsText = (o: OrderMail) =>
  [...(o.items ?? []).map((i) => `${i.quantity} × ${i.productName} — ${money(Number(i.unitPriceArs) * i.quantity)}`), `Total: ${money(o.totalArs)}`].join('\n');

/** Al cliente: cotización recibida o pago confirmado. */
export function orderCustomer(o: OrderMail, kind: OrderMailKind, siteUrl: string): RenderedMail {
  const link = `${siteBase(siteUrl)}/pedido/${o.code}/`;
  const subject = kind === 'pagado' ? `Pago confirmado: pedido ${o.code}` : `Recibimos tu pedido ${o.code}`;
  const intro = kind === 'pagado'
    ? `Confirmamos el pago de tu pedido ${o.code}. Ya lo estamos preparando y te avisamos por mail cada vez que cambie de estado.`
    : `Recibimos tu pedido ${o.code} como cotización: no se cobró nada. Te contactamos para confirmar disponibilidad, plazos y la forma de pago.`;
  const html = layout(subject, [
    p(esc(hello(o.customerName))),
    p(esc(intro)),
    itemsHtml(o),
    rows([['Entrega', deliveryText(o)]]),
    button(link, 'Ver mi pedido'),
    p(`<span style="color:${DIM};font-size:13px;">¿Dudas? Respondé este mail.</span>`),
  ].join(''));
  const text = [hello(o.customerName), intro, itemsText(o), `Entrega: ${deliveryText(o)}`, `Ver tu pedido: ${link}`, '¿Dudas? Respondé este mail.', 'AURYX · auryx.com.ar'].join('\n\n');
  return { subject, html, text };
}

/** Aviso a AURYX: pedido nuevo (cotización) o pagado (para preparar). */
export function orderNotice(o: OrderMail, kind: OrderMailKind, siteUrl: string): RenderedMail {
  const subject = kind === 'pagado'
    ? `Pedido pagado ${o.code} — para preparar (${money(o.totalArs)})`
    : `Cotización nueva ${o.code} (${money(o.totalArs)})`;
  const data: [string, string | null | undefined][] = [
    ['Cliente', o.customerName], ['Email', o.customerEmail], ['Teléfono', o.customerPhone ?? null],
    ['Entrega', deliveryText(o)], ['Facturación', o.billingDoc ? `${o.billingName ?? ''} ${o.billingDoc}`.trim() : null],
    ['Notas', o.notes ?? null],
  ];
  const admin = `${siteBase(siteUrl)}/admin/`;
  const html = layout(subject, [rows(data), itemsHtml(o), button(admin, 'Abrir el admin')].join(''), 'Aviso interno de auryx.com.ar');
  const text = [textRows(data), itemsText(o), `Admin: ${admin}`].join('\n\n');
  return { subject, html, text };
}

/** Al cliente cuando cambia la entrega. null = ese estado no avisa (pendiente, preparando). */
export function fulfillmentCustomer(o: OrderMail, siteUrl: string): RenderedMail | null {
  const link = `${siteBase(siteUrl)}/pedido/${o.code}/`;
  let subject: string, intro: string;
  switch (o.fulfillmentStatus) {
    case 'enviado':
      subject = `Tu pedido ${o.code} fue enviado`;
      intro = o.trackingNumber
        ? `Tu pedido ${o.code} ya salió. Número de seguimiento: ${o.trackingNumber}`
        : `Tu pedido ${o.code} ya salió. Te avisamos si hay novedades.`;
      break;
    case 'listo_para_retirar':
      subject = `Tu pedido ${o.code} está listo para retirar`;
      intro = `Tu pedido ${o.code} ya está listo. Respondé este mail o escribinos por WhatsApp para coordinar el día y el horario de retiro.`;
      break;
    case 'entregado':
      subject = `Tu pedido ${o.code} fue entregado`;
      intro = `Registramos tu pedido ${o.code} como entregado. ¡Gracias por elegir AURYX! Si algo no está bien, respondé este mail.`;
      break;
    default:
      return null;
  }
  const html = layout(subject, [p(esc(hello(o.customerName))), p(esc(intro)), button(link, 'Ver mi pedido')].join(''));
  const text = [hello(o.customerName), intro, `Ver tu pedido: ${link}`, 'AURYX · auryx.com.ar'].join('\n\n');
  return { subject, html, text };
}

// ---------- transferencias ----------

export interface BankMail { holder: string; cuit: string; bank: string; cbu: string; alias: string }

const deadlineFmt = new Intl.DateTimeFormat('es-AR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires' });
const deadlineText = (d: Date | string | null | undefined) => (d ? `${deadlineFmt.format(new Date(d))} h` : 'a coordinar');

const bankPairs = (b: BankMail, total: unknown): [string, string | null | undefined][] => [
  ['Titular', b.holder], ['CUIT', b.cuit || null], ['Banco', b.bank || null], ['CBU/CVU', b.cbu || null], ['Alias', b.alias || null],
  ['Monto exacto', money(total)],
];

/** Al cliente: pedido por transferencia creado, con los datos para pagar y el plazo. */
export function transferCustomer(o: OrderMail, bank: BankMail, deadline: Date | string | null, siteUrl: string): RenderedMail {
  const link = `${siteBase(siteUrl)}/pedido/${o.code}/`;
  const subject = `Datos para transferir: pedido ${o.code}`;
  const intro = `Recibimos tu pedido ${o.code}. Para confirmarlo, transferí el monto exacto antes del ${deadlineText(deadline)} y subí el comprobante desde la página del pedido.`;
  const after = 'Cuando verifiquemos la transferencia te mandamos la confirmación. Si no se paga a tiempo, el pedido se cancela solo.';
  const html = layout(subject, [
    p(esc(hello(o.customerName))), p(esc(intro)), rows(bankPairs(bank, o.totalArs)), itemsHtml(o),
    button(link, 'Subir el comprobante'), p(esc(after)),
  ].join(''));
  const text = [hello(o.customerName), intro, textRows(bankPairs(bank, o.totalArs)), itemsText(o), `Subí el comprobante: ${link}`, after, 'AURYX · auryx.com.ar'].join('\n\n');
  return { subject, html, text };
}

/** Aviso a AURYX: pedido nuevo por transferencia, o comprobante subido (`receipt`). */
export function transferNotice(o: OrderMail, kind: 'nuevo' | 'comprobante', siteUrl: string): RenderedMail {
  const subject = kind === 'comprobante'
    ? `Comprobante subido ${o.code} — revisar y confirmar (${money(o.totalArs)})`
    : `Pedido por transferencia ${o.code} — esperando pago (${money(o.totalArs)})`;
  const intro = kind === 'comprobante'
    ? 'El cliente subió el comprobante. Verificá la acreditación en el banco y confirmá el pago desde el admin (Pedidos → Transferencias).'
    : 'Pedido nuevo por transferencia. Todavía no hay comprobante.';
  const data: [string, string | null | undefined][] = [['Cliente', o.customerName], ['Email', o.customerEmail], ['Teléfono', o.customerPhone ?? null]];
  const admin = `${siteBase(siteUrl)}/admin/`;
  const html = layout(subject, [p(esc(intro)), rows(data), itemsHtml(o), button(admin, 'Abrir el admin')].join(''), 'Aviso interno de auryx.com.ar');
  const text = [intro, textRows(data), itemsText(o), `Admin: ${admin}`].join('\n\n');
  return { subject, html, text };
}

/** Al cliente: el comprobante no se pudo verificar; tiene que subir otro. */
export function receiptRejectedCustomer(o: OrderMail, deadline: Date | string | null, siteUrl: string): RenderedMail {
  const link = `${siteBase(siteUrl)}/pedido/${o.code}/`;
  const subject = `Revisá el comprobante del pedido ${o.code}`;
  const intro = `No pudimos verificar la transferencia del pedido ${o.code} con el comprobante que subiste. Subí otro (o escribinos) antes del ${deadlineText(deadline)}.`;
  const html = layout(subject, [p(esc(hello(o.customerName))), p(esc(intro)), button(link, 'Subir otro comprobante'), p(`<span style="color:${DIM};font-size:13px;">¿Dudas? Respondé este mail.</span>`)].join(''));
  const text = [hello(o.customerName), intro, `Pedido: ${link}`, '¿Dudas? Respondé este mail.', 'AURYX · auryx.com.ar'].join('\n\n');
  return { subject, html, text };
}
