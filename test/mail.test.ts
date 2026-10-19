/*
 * Mails: plantillas, cliente de Resend (fetch simulado), reintento y avisos de contacto.
 * Sin red: nunca se llama a Resend de verdad.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MailClient, OutgoingMail } from '../src/mail/mail.client';
import { MailService } from '../src/mail/mail.service';
import { contactAck, contactNotice, fulfillmentCustomer, orderCustomer, orderNotice, revocationCode, REVOCATION_PREFIX } from '../src/mail/templates';
import { ContactController } from '../src/contact/contact.controller';

const SITE = 'https://auryx.test';

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) { prev[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  const restore = () => { for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } };
  try { const r = fn(); return r instanceof Promise ? r.finally(restore) : (restore(), r); } catch (e) { restore(); throw e; }
}

/** Cliente simulado: guarda lo enviado; `fail` = cuántos envíos fallan antes de andar. */
function fakeClient(fail = 0) {
  const sent: OutgoingMail[] = [];
  let attempts = 0;
  const client: any = {
    enabled: true, sent,
    get attempts() { return attempts; },
    send: async (m: OutgoingMail) => { attempts++; if (attempts <= fail) throw new Error('Resend caído'); sent.push(m); },
  };
  return client;
}
function mailService(client: any) {
  const svc = new MailService(client);
  svc.retryDelayMs = 0;
  return svc;
}

const msg = { id: 42, name: 'Ana <b>Pérez</b>', email: 'ana@example.com', phone: '+54 9 11 5555-5555', message: 'Hola <script>alert(1)</script>' };
const order = {
  code: 'AX-7K3P9Q', customerName: 'Ana Pérez', customerEmail: 'ana@example.com', customerPhone: '1155555555',
  deliveryMethod: 'envio', shippingAddress: { street: 'Av. Siempreviva 742', floor: '3B', city: 'Rosario', province: 'Santa Fe', zip: '2000' },
  billingDoc: null, billingName: null, notes: 'Timbre <roto>', totalArs: 1234567.5, status: 'pagado',
  fulfillmentStatus: 'pendiente', trackingNumber: null,
  items: [{ productName: 'Panel Solar Jinko – Tiger Neo – 585 W', quantity: 2, unitPriceArs: 285000 }, { productName: 'Inversor <X>', quantity: 1, unitPriceArs: 664567.5 }],
};

// ---------- plantillas ----------

test('código de arrepentimiento: ARR- + id con 6 dígitos', () => {
  assert.equal(revocationCode(42), 'ARR-000042');
  assert.equal(revocationCode(1234567), 'ARR-1234567');
});

test('aviso de contacto: escapa lo que escribe el cliente (HTML) y lo deja tal cual en texto', () => {
  const m = contactNotice(msg);
  assert.ok(!m.html.includes('<script>'));
  assert.ok(m.html.includes('&lt;script&gt;'));
  assert.ok(!m.html.includes('<b>Pérez'));
  assert.ok(m.text.includes('Hola <script>alert(1)</script>'));
  assert.ok(m.text.includes('+54 9 11 5555-5555'));
  assert.match(m.subject, /Ana/);
});

test('acuse de contacto: no repite el mensaje (no sirve para mandar spam a un tercero) y saluda solo con el primer nombre', () => {
  const m = contactAck(msg);
  assert.ok(!m.html.includes('alert(1)') && !m.text.includes('alert(1)'));
  assert.ok(m.text.startsWith('Hola Ana,'));
  const long = contactAck({ ...msg, name: 'Visitá www.spam.example.com ya mismo' });
  assert.ok(!long.text.includes('spam.example'));
});

test('arrepentimiento: el acuse y el aviso llevan el código; el aviso dice que hay que responder en 24 h', () => {
  const code = revocationCode(42);
  const ack = contactAck({ ...msg, message: `${REVOCATION_PREFIX} Pedido: AX-7K3P9Q\n\nNo lo quiero` }, code);
  assert.match(ack.subject, /ARR-000042/);
  assert.ok(ack.text.includes('ARR-000042'));
  const notice = contactNotice({ ...msg, message: `${REVOCATION_PREFIX} Pedido: AX-7K3P9Q` }, code);
  assert.match(notice.subject, /Arrepentimiento/);
  assert.match(notice.subject, /ARR-000042/);
  assert.match(notice.text, /24 h/);
});

test('pedido pagado (cliente): detalle, total en pesos, entrega y link al pedido; datos escapados', () => {
  const m = orderCustomer(order, 'pagado', SITE);
  assert.match(m.subject, /AX-7K3P9Q/);
  assert.ok(m.text.includes('$ 1.234.567,50') || m.text.includes('$ 1.234.567,50'));
  assert.ok(m.text.includes('2 × Panel Solar Jinko – Tiger Neo – 585 W'));
  assert.ok(m.text.includes('Av. Siempreviva 742'));
  assert.ok(m.html.includes(`${SITE}/pedido/AX-7K3P9Q/`));
  assert.ok(m.html.includes('Inversor &lt;X&gt;'));
});

test('cotización (cliente) dice que no se cobró; aviso interno con teléfono, notas y link al admin', () => {
  const quote = orderCustomer(order, 'cotizacion', SITE);
  assert.match(quote.text, /no se cobró/i);
  const notice = orderNotice(order, 'pagado', SITE);
  assert.match(notice.subject, /pagado/i);
  assert.ok(notice.text.includes('1155555555'));
  assert.ok(notice.text.includes('Timbre <roto>'));
  assert.ok(notice.html.includes('Timbre &lt;roto&gt;'));
  assert.ok(notice.html.includes(`${SITE}/admin/`));
});

test('entrega: enviado (con seguimiento), listo para retirar y entregado mandan mail; pendiente y preparando no', () => {
  const sent = fulfillmentCustomer({ ...order, fulfillmentStatus: 'enviado', trackingNumber: 'OCA-123' }, SITE)!;
  assert.match(sent.subject, /enviado/i);
  assert.ok(sent.text.includes('OCA-123'));
  assert.match(fulfillmentCustomer({ ...order, deliveryMethod: 'retiro', fulfillmentStatus: 'listo_para_retirar' }, SITE)!.subject, /retirar/i);
  assert.match(fulfillmentCustomer({ ...order, fulfillmentStatus: 'entregado' }, SITE)!.subject, /entregado/i);
  assert.equal(fulfillmentCustomer({ ...order, fulfillmentStatus: 'pendiente' }, SITE), null);
  assert.equal(fulfillmentCustomer({ ...order, fulfillmentStatus: 'preparando' }, SITE), null);
});

// ---------- cliente de Resend ----------

test('MailClient: sin RESEND_API_KEY está apagado y no llama a fetch', () => withEnv({ RESEND_API_KEY: undefined }, async () => {
  const realFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => { called = true; return new Response('{}'); }) as any;
  try {
    const c = new MailClient();
    assert.equal(c.enabled, false);
    await c.send({ to: 'a@b.com', subject: 's', html: 'h', text: 't' });
    assert.equal(called, false);
  } finally { globalThis.fetch = realFetch; }
}));

test('MailClient: POST a Resend con clave, remitente, Reply-To; un error HTTP lanza', () => withEnv({ RESEND_API_KEY: 're_test', MAIL_FROM: 'AURYX <avisos@auryx.test>' }, async () => {
  const realFetch = globalThis.fetch;
  const calls: any[] = [];
  let status = 200;
  globalThis.fetch = (async (url: string, init: any) => { calls.push({ url, init }); return new Response(status === 200 ? '{"id":"1"}' : '{"message":"bad"}', { status }); }) as any;
  try {
    const c = new MailClient();
    await c.send({ to: 'ana@example.com', subject: 'Hola', html: '<p>h</p>', text: 'h', replyTo: 'cliente@example.com' });
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer re_test');
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body, { from: 'AURYX <avisos@auryx.test>', to: ['ana@example.com'], subject: 'Hola', html: '<p>h</p>', text: 'h', reply_to: 'cliente@example.com' });
    status = 422;
    await assert.rejects(c.send({ to: 'x@y.com', subject: 's', html: 'h', text: 't' }), /422/);
  } finally { globalThis.fetch = realFetch; }
}));

// ---------- servicio: reintento y nunca lanza ----------

test('MailService: reintenta una vez; si vuelve a fallar no lanza', async () => {
  const once = fakeClient(1), svc1 = mailService(once);
  svc1.dispatch([{ to: 'a@b.com', subject: 's', html: 'h', text: 't' }]);
  await svc1.flush();
  assert.equal(once.attempts, 2);
  assert.equal(once.sent.length, 1);

  const down = fakeClient(99), svc2 = mailService(down);
  svc2.dispatch([{ to: 'a@b.com', subject: 's', html: 'h', text: 't' }]);
  await svc2.flush();
  assert.equal(down.attempts, 2);
  assert.equal(down.sent.length, 0);
});

test('MailService: sin NOTIFY_EMAIL se manda solo lo del cliente', () => withEnv({ NOTIFY_EMAIL: undefined }, async () => {
  const c = fakeClient(), svc = mailService(c);
  svc.contactReceived(msg);
  await svc.flush();
  assert.deepEqual(c.sent.map((m: OutgoingMail) => m.to), ['ana@example.com']);
}));

// ---------- POST /contact ----------

function fakeContactPrisma() {
  const rows: any[] = [];
  return { rows, contactMessage: { create: async ({ data }: any) => { const r = { id: rows.length + 1, read: false, createdAt: new Date(), ...data }; rows.push(r); return r; } } };
}

test('POST /contact: acuse al cliente y aviso a AURYX con Reply-To del cliente', () => withEnv({ NOTIFY_EMAIL: 'contacto@auryx.test' }, async () => {
  const c = fakeClient(), mail = mailService(c);
  const ctrl = new ContactController(fakeContactPrisma() as any, mail);
  const r = await ctrl.create({ name: 'Ana', email: 'Ana@Example.com', message: 'Quiero una cotización' }, '1.1.1.1');
  assert.deepEqual(r, { ok: true });
  await mail.flush();
  const toClient = c.sent.find((m: OutgoingMail) => m.to === 'ana@example.com');
  const toUs = c.sent.find((m: OutgoingMail) => m.to === 'contacto@auryx.test');
  assert.ok(toClient && toUs);
  assert.equal(toUs.replyTo, 'ana@example.com');
}));

test('POST /contact: arrepentimiento devuelve el código y los mails lo llevan', () => withEnv({ NOTIFY_EMAIL: 'contacto@auryx.test' }, async () => {
  const c = fakeClient(), mail = mailService(c);
  const ctrl = new ContactController(fakeContactPrisma() as any, mail);
  const r = await ctrl.create({ name: 'Ana', email: 'ana@example.com', message: `${REVOCATION_PREFIX} Pedido: AX-7K3P9Q\n\n(sin comentarios)` }, '2.2.2.2');
  assert.deepEqual(r, { ok: true, code: 'ARR-000001' });
  await mail.flush();
  assert.equal(c.sent.length, 2);
  assert.ok(c.sent.every((m: OutgoingMail) => m.subject.includes('ARR-000001')));
}));

test('POST /contact: campo trampa no manda mails; Resend caído no rompe el formulario', () => withEnv({ NOTIFY_EMAIL: 'contacto@auryx.test' }, async () => {
  const c = fakeClient(), mail = mailService(c);
  const ctrl = new ContactController(fakeContactPrisma() as any, mail);
  await ctrl.create({ name: 'Bot', email: 'bot@example.com', message: 'spam spam', website: 'x' }, '3.3.3.3');
  await mail.flush();
  assert.equal(c.attempts, 0);

  const down = fakeClient(99), mail2 = mailService(down);
  const ctrl2 = new ContactController(fakeContactPrisma() as any, mail2);
  assert.deepEqual(await ctrl2.create({ name: 'Ana', email: 'ana@example.com', message: 'Hola, consulta' }, '4.4.4.4'), { ok: true });
  await mail2.flush();
}));

test('POST /contact: sin servicio de mail (Optional) sigue andando', async () => {
  const ctrl = new ContactController(fakeContactPrisma() as any);
  assert.deepEqual(await ctrl.create({ name: 'Ana', email: 'ana@example.com', message: 'Hola, consulta' }, '5.5.5.5'), { ok: true });
});
