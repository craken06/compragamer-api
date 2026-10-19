import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { FulfillmentStatus, OrderStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ExchangeRateService } from '../exchange-rate/exchange-rate.service';
import { CustomersService } from '../customers/customers.service';
import { ShippingAddress, normalizeAddress, normalizeBilling, normalizePhone } from '../customers/validation';
import { MercadoPagoClient } from './mercadopago.client';
import { withUniqueCode } from './order-code';
import { assertFulfillment, fulfillmentData } from './fulfillment';
import { INSTALLATION_MP_ID, INSTALLATION_NAME, INSTALLATION_PRODUCT_ID, INSTALLATION_RATE } from './installation';
import { productTitle } from '../products/title';
import { MailService } from '../mail/mail.service';

export interface CreateOrderRequest {
  items: { productId: number; qty: number }[];
  phone: string;
  delivery: { method: 'envio' | 'retiro'; address?: unknown };
  billing?: unknown; // { doc, name }, opcional
  saveDetails?: boolean; // guarda teléfono, dirección y facturación en la cuenta
  notes?: string;
  mode?: 'pago' | 'cotizacion'; // cotizacion = se guarda el pedido sin cobrar
  /** equipos (de `items`) a los que se les pidió instalación y asesoría: se cobra INSTALLATION_RATE de su precio */
  installation?: { productId: number; qty: number }[];
}

export type AdminOrderFilter = 'para_preparar' | 'todos' | 'pendientes_pago' | 'entregados';

const MAX_ITEMS = 50;
const MAX_QTY = 999; // unidades por producto en un pedido
const NOT_FOUND = 'Pedido no encontrado';

// Filtros del panel (spec 4.8)
const ADMIN_FILTERS: Record<AdminOrderFilter, Prisma.OrderWhereInput> = {
  para_preparar: { status: 'pagado', fulfillmentStatus: { not: 'entregado' } },
  todos: {},
  pendientes_pago: { status: 'pendiente_pago' },
  entregados: { fulfillmentStatus: 'entregado' },
};

// Estados de pago de MP -> estado del pedido
const MP_STATUS: Record<string, OrderStatus> = {
  approved: 'pagado',
  authorized: 'pendiente_pago',
  in_process: 'pendiente_pago',
  in_mediation: 'pendiente_pago',
  pending: 'pendiente_pago',
  rejected: 'rechazado',
  cancelled: 'cancelado',
  refunded: 'cancelado',
  charged_back: 'cancelado',
};

/** Pedido como lo ve el cliente (GET /me/orders y GET /orders/:code). El link de pago solo si sigue pendiente. */
function toCustomerOrder(o: any) {
  return {
    code: o.code,
    createdAt: o.createdAt,
    status: o.status,
    fulfillmentStatus: o.fulfillmentStatus,
    trackingNumber: o.trackingNumber ?? null,
    deliveryMethod: o.deliveryMethod ?? null,
    shippingAddress: (o.shippingAddress as ShippingAddress | null) ?? null,
    billingDoc: o.billingDoc ?? null,
    billingName: o.billingName ?? null,
    notes: o.notes ?? null,
    totalArs: Number(o.totalArs),
    paymentUrl: o.status === 'pendiente_pago' ? o.paymentUrl ?? null : null,
    items: (o.items ?? []).map((i: any) => ({
      productId: i.productId, productName: i.productName, quantity: i.quantity, unitPriceArs: Number(i.unitPriceArs),
    })),
  };
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private prisma: PrismaService,
    private rates: ExchangeRateService,
    private mp: MercadoPagoClient,
    private customers: CustomersService,
    @Optional() private mail?: MailService,
  ) {}

  /**
   * Crea el pedido de un cliente con sesión, con precios calculados en el servidor (nunca los que manda el navegador).
   * Los precios de la base incluyen IVA; los cargados en USD se pasan a ARS con la cotización vigente.
   * Nombre y email salen de la cuenta, no del cuerpo.
   */
  async create(customer: { id: number; name: string; email: string }, req: CreateOrderRequest) {
    const name = String(customer.name ?? '').trim().slice(0, 120);
    const email = String(customer.email ?? '').trim().toLowerCase().slice(0, 160);
    const lines = Array.isArray(req?.items) ? req.items : [];
    if (!lines.length || lines.length > MAX_ITEMS) throw new BadRequestException(`El pedido tiene que tener entre 1 y ${MAX_ITEMS} productos.`);

    const qtyById = new Map<number, number>();
    for (const l of lines) {
      const id = Number(l?.productId), qty = Math.round(Number(l?.qty));
      if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(qty) || qty < 1 || qty > MAX_QTY) {
        throw new BadRequestException('Hay un producto o una cantidad inválida en el pedido.');
      }
      qtyById.set(id, (qtyById.get(id) ?? 0) + qty);
    }
    // el tope va sobre el total por producto: si no, repetir la línea lo saltea (50 × 999)
    if ([...qtyById.values()].some((q) => q > MAX_QTY)) {
      throw new BadRequestException(`Se pueden pedir hasta ${MAX_QTY} unidades de cada producto.`);
    }

    // instalación: solo sobre equipos que están en el pedido, y no más unidades que las pedidas
    const installQty = new Map<number, number>();
    if (req?.installation !== undefined) {
      if (!Array.isArray(req.installation) || req.installation.length > MAX_ITEMS) throw new BadRequestException('La instalación pedida no es válida.');
      for (const l of req.installation) {
        const id = Number(l?.productId), qty = Math.round(Number(l?.qty));
        if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(qty) || qty < 1) throw new BadRequestException('La instalación pedida no es válida.');
        installQty.set(id, (installQty.get(id) ?? 0) + qty);
      }
      if ([...installQty].some(([id, q]) => q > (qtyById.get(id) ?? 0))) {
        throw new BadRequestException('La instalación incluye equipos que no están en el pedido. Actualizá la página.');
      }
    }

    // entrega y facturación (las validaciones lanzan 400 con el mensaje para el usuario)
    const phone = normalizePhone(req?.phone);
    const method = req?.delivery?.method;
    if (method !== 'envio' && method !== 'retiro') throw new BadRequestException('Elegí cómo recibir el pedido: envío o retiro.');
    const address = method === 'envio' ? normalizeAddress(req.delivery.address) : null;
    const billing = normalizeBilling(req?.billing);

    const products = await this.prisma.product.findMany({ where: { id: { in: [...qtyById.keys()] }, active: true, showInStore: true } });
    if (products.length !== qtyById.size) throw new BadRequestException('Algún producto del carrito ya no está disponible. Actualizá la página.');
    const sinStock = products.filter((p) => p.stockStatus === 'sin_stock');
    if (sinStock.length) throw new BadRequestException(`Sin stock: ${sinStock.map((p) => p.name).join(', ')}.`);

    const { usdArs } = await this.rates.getRate();
    const items = products.map((p) => {
      const price = Number(p.price);
      const unit = Math.round((p.currency === 'USD' ? price * usdArs : price) * 100) / 100;
      return { productId: p.id, productName: productTitle(p).slice(0, 200), quantity: qtyById.get(p.id), unitPriceArs: unit };
    });
    if (items.some((i) => !(i.unitPriceArs > 0))) throw new BadRequestException('Hay un producto sin precio: consultanos por WhatsApp.');
    const unitById = new Map(items.map((i) => [i.productId, i.unitPriceArs]));
    const installBase = [...installQty].reduce((s, [id, q]) => s + (unitById.get(id) ?? 0) * q, 0);
    if (installBase > 0) {
      items.push({ productId: INSTALLATION_PRODUCT_ID, productName: INSTALLATION_NAME, quantity: 1, unitPriceArs: Math.round(installBase * INSTALLATION_RATE * 100) / 100 });
    }
    const total = Math.round(items.reduce((s, i) => s + i.unitPriceArs * i.quantity, 0) * 100) / 100;

    const quote = req.mode === 'cotizacion' || !this.mp.enabled;
    const order = await withUniqueCode((code) => this.prisma.order.create({
      data: {
        publicId: randomUUID(), code, customerId: customer.id,
        customerName: name, customerEmail: email, customerPhone: phone,
        deliveryMethod: method,
        // con retiro no se manda la dirección: queda NULL
        ...(address ? { shippingAddress: address as unknown as Prisma.InputJsonObject } : {}),
        billingDoc: billing?.doc ?? null, billingName: billing?.name ?? null,
        notes: req.notes ? String(req.notes).slice(0, 1000) : null,
        status: quote ? 'cotizacion' : 'pendiente_pago',
        totalArs: new Prisma.Decimal(total), usdArsRate: new Prisma.Decimal(usdArs),
        items: { create: items.map((i) => ({ ...i, unitPriceArs: new Prisma.Decimal(i.unitPriceArs) })) },
      },
    }));
    const code = order.code;

    // guardar en la cuenta es un extra: se hace al final y nunca puede dejar el pedido sin link de pago
    const saveDetails = async () => {
      if (req.saveDetails !== true) return;
      try {
        // lo omitido no cambia: con retiro no se toca la dirección; sin facturación, tampoco
        await this.customers.updateMe(customer.id, {
          phone,
          ...(address ? { defaultAddress: address } : {}),
          ...(billing ? { billing } : {}),
        });
      } catch (err) {
        this.logger.warn(`No se pudieron guardar los datos de la cuenta ${customer.id} (pedido ${code}): ${(err as Error)?.message}`);
      }
    };

    if (quote) {
      await saveDetails();
      this.mail?.orderReceived({ ...order, items }, 'cotizacion');
      return { code, status: order.status, totalArs: total, paymentUrl: null };
    }

    const frontend = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
    const apiPublic = (process.env.API_PUBLIC_URL || '').replace(/\/+$/, '');
    try {
      const pref = await this.mp.createPreference({
        externalReference: code,
        items: items.map((i) => ({
          id: i.productId === INSTALLATION_PRODUCT_ID ? INSTALLATION_MP_ID : String(i.productId),
          title: i.productName, quantity: i.quantity, unit_price: i.unitPriceArs,
        })),
        payerEmail: email, payerName: name,
        backUrl: `${frontend}/pedido/${code}/`,
        notificationUrl: apiPublic ? `${apiPublic}/payments/webhook` : undefined,
      });
      // se guarda el link para el botón "Pagar" de un pedido pendiente
      await this.prisma.order.update({ where: { id: order.id }, data: { mpPreferenceId: pref.id, paymentUrl: pref.init_point } });
      await saveDetails();
      return { code, status: order.status, totalArs: total, paymentUrl: pref.init_point };
    } catch (err) {
      // el pedido queda guardado como cotización para no perderlo
      await this.prisma.order.update({ where: { id: order.id }, data: { status: 'cotizacion' } });
      throw err;
    }
  }

  /** Estado público de un pedido viejo (sin cuenta) por su UUID. No expone datos del cliente. */
  async findLegacyPublic(publicId: string) {
    const order = await this.prisma.order.findUnique({ where: { publicId }, include: { items: true } });
    // los pedidos con cliente solo se ven con sesión, por código
    if (!order || order.customerId !== null) throw new NotFoundException(NOT_FOUND);
    return {
      publicId: order.publicId, status: order.status, totalArs: Number(order.totalArs), createdAt: order.createdAt,
      items: order.items.map((i) => ({ productName: i.productName, quantity: i.quantity, unitPriceArs: Number(i.unitPriceArs) })),
    };
  }

  /** Detalle de un pedido del cliente. Si no existe o es de otro, el mismo 404 (no revela que existe). */
  async findForCustomer(customerId: number, code: string) {
    const order = await this.prisma.order.findUnique({ where: { code }, include: { items: true } });
    if (!order || order.customerId !== customerId) throw new NotFoundException(NOT_FOUND);
    return toCustomerOrder(order);
  }

  /** GET /me/orders: del más nuevo al más viejo. */
  async listForCustomer(customerId: number) {
    const orders = await this.prisma.order.findMany({
      where: { customerId }, orderBy: { createdAt: 'desc' }, include: { items: true }, take: 200,
    });
    return orders.map(toCustomerOrder);
  }

  /** Listado del panel con filtro (por defecto, los que hay que preparar) y búsqueda por código. */
  async adminList(filter: AdminOrderFilter = 'para_preparar', q?: string) {
    const f = filter || 'para_preparar';
    if (!Object.prototype.hasOwnProperty.call(ADMIN_FILTERS, f)) throw new BadRequestException('Filtro de pedidos inválido.');
    const where: Prisma.OrderWhereInput = { ...ADMIN_FILTERS[f] };
    const search = typeof q === 'string' ? q.trim().slice(0, 20) : '';
    if (search) where.code = { contains: search, mode: 'insensitive' };
    return this.prisma.order.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 200,
      include: { items: true, customer: { select: { id: true, name: true } } },
    });
  }

  /** Cambia el estado de entrega (spec 4.8): solo pagados y según el método de entrega. */
  async setFulfillment(orderId: number, status: FulfillmentStatus, trackingNumber?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException(NOT_FOUND);
    assertFulfillment(order, status);
    const previous = order.fulfillmentStatus;
    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: fulfillmentData(status, trackingNumber),
      include: { items: true, customer: { select: { id: true, name: true } } },
    });
    // volver a elegir el mismo estado (o corregir el seguimiento) no repite el mail
    if (previous !== status) this.mail?.fulfillmentChanged(updated);
    return updated;
  }

  /**
   * Notificación de Mercado Pago. Se consulta el pago a MP (fuente de verdad) y se
   * actualiza el pedido por external_reference: el código, o el publicId en pedidos
   * creados antes del cambio. Es idempotente: MP reintenta.
   */
  async handlePaymentNotification(paymentId: string) {
    const payment = await this.mp.getPayment(paymentId);
    const ref = payment.external_reference;
    if (!ref) return { ignored: 'sin external_reference' };
    const order =
      (await this.prisma.order.findUnique({ where: { code: ref } })) ??
      (await this.prisma.order.findUnique({ where: { publicId: ref } }));
    if (!order) return { ignored: 'pedido inexistente' };

    let status = MP_STATUS[payment.status] ?? order.status;
    // un pago aprobado tiene que cubrir el total y ser en pesos; si no, queda para revisar a mano
    // sin monto o con un monto no numérico tampoco: Number(undefined) + 0.01 < total da false y pasaría
    const paid = payment.transaction_amount == null ? NaN : Number(payment.transaction_amount);
    if (status === 'pagado' && (payment.currency_id !== 'ARS' || !Number.isFinite(paid) || paid + 0.01 < Number(order.totalArs))) {
      this.logger.error(`Pago ${payment.id} aprobado por ${payment.transaction_amount} ${payment.currency_id} no coincide con el pedido ${ref} (${order.totalArs} ARS)`);
      status = 'pendiente_pago';
    }
    // un pedido ya pagado no vuelve atrás por una notificación vieja
    if (order.status === 'pagado' && status !== 'cancelado') status = 'pagado';

    const data = { status, mpPaymentId: String(payment.id), mpStatus: payment.status };
    if (status === 'pagado' && order.status !== 'pagado') {
      // condicional: si MP manda dos notificaciones a la vez, solo una pasa el pedido a pagado y manda los mails
      const { count } = await this.prisma.order.updateMany({ where: { id: order.id, status: { not: 'pagado' } }, data });
      if (count === 1) await this.notifyPaid(order.id);
    } else {
      await this.prisma.order.update({ where: { id: order.id }, data });
    }
    return { code: order.code, status };
  }

  /** Mails de pago confirmado. Un error acá no puede hacer fallar el webhook (MP reintentaría y el pedido ya está pagado). */
  private async notifyPaid(orderId: number) {
    if (!this.mail) return;
    try {
      const paid = await this.prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
      if (paid) this.mail.orderReceived(paid, 'pagado');
    } catch (err) {
      this.logger.warn(`No se pudo armar el mail del pedido pagado ${orderId}: ${(err as Error)?.message}`);
    }
  }
}
