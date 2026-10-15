import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ExchangeRateService } from '../exchange-rate/exchange-rate.service';
import { MercadoPagoClient } from './mercadopago.client';

export interface CreateOrderRequest {
  customer: { name: string; email: string; phone?: string };
  items: { productId: number; qty: number }[];
  notes?: string;
  mode?: 'pago' | 'cotizacion'; // cotizacion = se guarda el pedido sin cobrar
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_ITEMS = 50;

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

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(private prisma: PrismaService, private rates: ExchangeRateService, private mp: MercadoPagoClient) {}

  /**
   * Crea el pedido con precios calculados en el servidor (nunca los que manda el navegador).
   * Los precios de la base incluyen IVA; los cargados en USD se pasan a ARS con la cotización vigente.
   */
  async create(req: CreateOrderRequest) {
    const name = String(req?.customer?.name ?? '').trim().slice(0, 120);
    const email = String(req?.customer?.email ?? '').trim().toLowerCase().slice(0, 160);
    const phone = String(req?.customer?.phone ?? '').trim().slice(0, 40) || null;
    if (name.length < 2) throw new BadRequestException('Falta el nombre.');
    if (!EMAIL_RE.test(email)) throw new BadRequestException('El email no es válido.');
    const lines = Array.isArray(req?.items) ? req.items : [];
    if (!lines.length || lines.length > MAX_ITEMS) throw new BadRequestException(`El pedido tiene que tener entre 1 y ${MAX_ITEMS} productos.`);

    const qtyById = new Map<number, number>();
    for (const l of lines) {
      const id = Number(l?.productId), qty = Math.round(Number(l?.qty));
      if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(qty) || qty < 1 || qty > 999) {
        throw new BadRequestException('Hay un producto o una cantidad inválida en el pedido.');
      }
      qtyById.set(id, (qtyById.get(id) ?? 0) + qty);
    }

    const products = await this.prisma.product.findMany({ where: { id: { in: [...qtyById.keys()] }, active: true } });
    if (products.length !== qtyById.size) throw new BadRequestException('Algún producto del carrito ya no está disponible. Actualizá la página.');
    const sinStock = products.filter((p) => p.stockStatus === 'sin_stock');
    if (sinStock.length) throw new BadRequestException(`Sin stock: ${sinStock.map((p) => p.name).join(', ')}.`);

    const { usdArs } = await this.rates.getRate();
    const items = products.map((p) => {
      const price = Number(p.price);
      const unit = Math.round((p.currency === 'USD' ? price * usdArs : price) * 100) / 100;
      return { productId: p.id, productName: `${p.brand} ${p.name}`.slice(0, 200), quantity: qtyById.get(p.id), unitPriceArs: unit };
    });
    if (items.some((i) => !(i.unitPriceArs > 0))) throw new BadRequestException('Hay un producto sin precio: consultanos por WhatsApp.');
    const total = Math.round(items.reduce((s, i) => s + i.unitPriceArs * i.quantity, 0) * 100) / 100;

    const quote = req.mode === 'cotizacion' || !this.mp.enabled;
    const publicId = randomUUID();
    const order = await this.prisma.order.create({
      data: {
        publicId, customerName: name, customerEmail: email, customerPhone: phone,
        notes: req.notes ? String(req.notes).slice(0, 1000) : null,
        status: quote ? 'cotizacion' : 'pendiente_pago',
        totalArs: new Prisma.Decimal(total), usdArsRate: new Prisma.Decimal(usdArs),
        items: { create: items.map((i) => ({ ...i, unitPriceArs: new Prisma.Decimal(i.unitPriceArs) })) },
      },
    });

    if (quote) return { publicId, status: order.status, totalArs: total, paymentUrl: null };

    const frontend = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
    const apiPublic = (process.env.API_PUBLIC_URL || '').replace(/\/+$/, '');
    try {
      const pref = await this.mp.createPreference({
        externalReference: publicId,
        items: items.map((i) => ({ id: String(i.productId), title: i.productName, quantity: i.quantity, unit_price: i.unitPriceArs })),
        payerEmail: email, payerName: name,
        backUrl: `${frontend}/#pedido/${publicId}`,
        notificationUrl: apiPublic ? `${apiPublic}/payments/webhook` : undefined,
      });
      await this.prisma.order.update({ where: { id: order.id }, data: { mpPreferenceId: pref.id } });
      return { publicId, status: order.status, totalArs: total, paymentUrl: pref.init_point };
    } catch (err) {
      // el pedido queda guardado como cotización para no perderlo
      await this.prisma.order.update({ where: { id: order.id }, data: { status: 'cotizacion' } });
      throw err;
    }
  }

  /** Estado público de un pedido (por id no adivinable). No expone datos del cliente. */
  async findPublic(publicId: string) {
    const order = await this.prisma.order.findUnique({ where: { publicId }, include: { items: true } });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    return {
      publicId: order.publicId, status: order.status, totalArs: Number(order.totalArs), createdAt: order.createdAt,
      items: order.items.map((i) => ({ productName: i.productName, quantity: i.quantity, unitPriceArs: Number(i.unitPriceArs) })),
    };
  }

  findAll() {
    return this.prisma.order.findMany({ orderBy: { createdAt: 'desc' }, include: { items: true }, take: 200 });
  }

  /**
   * Notificación de Mercado Pago. Se consulta el pago a MP (fuente de verdad) y se
   * actualiza el pedido por external_reference. Es idempotente: MP reintenta.
   */
  async handlePaymentNotification(paymentId: string) {
    const payment = await this.mp.getPayment(paymentId);
    const ref = payment.external_reference;
    if (!ref) return { ignored: 'sin external_reference' };
    const order = await this.prisma.order.findUnique({ where: { publicId: ref } });
    if (!order) return { ignored: 'pedido inexistente' };

    let status = MP_STATUS[payment.status] ?? order.status;
    // un pago aprobado tiene que cubrir el total y ser en pesos; si no, queda para revisar a mano
    if (status === 'pagado' && (payment.currency_id !== 'ARS' || Number(payment.transaction_amount) + 0.01 < Number(order.totalArs))) {
      this.logger.error(`Pago ${payment.id} aprobado por ${payment.transaction_amount} ${payment.currency_id} no coincide con el pedido ${ref} (${order.totalArs} ARS)`);
      status = 'pendiente_pago';
    }
    // un pedido ya pagado no vuelve atrás por una notificación vieja
    if (order.status === 'pagado' && status !== 'cancelado') status = 'pagado';

    await this.prisma.order.update({
      where: { id: order.id },
      data: { status, mpPaymentId: String(payment.id), mpStatus: payment.status },
    });
    return { publicId: ref, status };
  }
}
