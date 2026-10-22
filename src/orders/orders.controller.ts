import {
  BadRequestException, Body, Controller, ExecutionContext, Get, Headers, HttpCode, Ip, NotFoundException, Param,
  ParseIntPipe, Patch, Post, Query, Req, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { FulfillmentStatus } from '@prisma/client';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { RateLimiter } from '../common/rate-limit';
import { CustomerGuard } from '../customers/customer.guard';
import { AdminOrderFilter, AdminPaymentAction, CreateOrderRequest, OrdersService } from './orders.service';
import { MercadoPagoClient } from './mercadopago.client';
import { ORDER_CODE_RE } from './order-code';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller()
export class OrdersController {
  private limiter = new RateLimiter(10, 60 * 60 * 1000, 'Demasiados pedidos seguidos. Escribinos por WhatsApp.');
  // además del límite por IP, uno por cuenta: con varias IPs no se puede llenar el panel de cotizaciones
  private customerLimiter = new RateLimiter(20, 24 * 60 * 60 * 1000, 'Llegaste al máximo de pedidos por hoy. Escribinos por WhatsApp.');
  // cada notificación consulta el pago a MP: sin tope, una inundación agota el rate limit de MP de la cuenta.
  // Es amplio para no frenar nunca las notificaciones reales.
  private webhookLimiter = new RateLimiter(120, 60 * 1000, 'Demasiadas notificaciones.');
  private uploadLimiter = new RateLimiter(30, 60 * 60 * 1000, 'Demasiadas subidas seguidas. Probá en un rato.');

  constructor(
    private readonly orders: OrdersService,
    private readonly mp: MercadoPagoClient,
    private readonly customerGuard: CustomerGuard,
  ) {}

  // POST /orders -> { code, status, totalArs, paymentUrl } (paymentUrl = checkout de Mercado Pago)
  @Post('orders')
  @UseGuards(CustomerGuard)
  create(@Req() req: any, @Body() body: CreateOrderRequest, @Ip() ip: string) {
    this.limiter.check(ip);
    this.customerLimiter.check(String(req.customer.id));
    return this.orders.create(req.customer, body ?? ({} as CreateOrderRequest));
  }

  // GET /payments/methods -> { mercadopago, transferencia: { enabled, discountPct, deadlineHours } }
  @Get('payments/methods')
  methods() {
    return this.orders.paymentMethods();
  }

  // POST /orders/:code/receipt/upload-url { filename, size, contentType } -> { key, url, headers }
  @Post('orders/:code/receipt/upload-url')
  @UseGuards(CustomerGuard)
  receiptUploadUrl(@Req() req: any, @Param('code') code: string, @Body() body: any, @Ip() ip: string) {
    this.uploadLimiter.check(ip);
    return this.orders.receiptUploadUrl(req.customer.id, this.codeOf(code), body ?? {});
  }

  // POST /orders/:code/receipt { key } -> pedido actualizado
  @Post('orders/:code/receipt')
  @UseGuards(CustomerGuard)
  attachReceipt(@Req() req: any, @Param('code') code: string, @Body() body: any) {
    return this.orders.attachReceipt(req.customer.id, this.codeOf(code), body?.key);
  }

  private codeOf(raw: string) {
    const code = String(raw ?? '').trim().toUpperCase();
    if (!ORDER_CODE_RE.test(code)) throw new NotFoundException('Pedido no encontrado');
    return code;
  }

  // GET /me/orders -> pedidos del cliente, del más nuevo al más viejo
  @Get('me/orders')
  @UseGuards(CustomerGuard)
  mine(@Req() req: any) {
    return this.orders.listForCustomer(req.customer.id);
  }

  /**
   * GET /orders/:id -> una sola ruta para los dos formatos:
   *  - UUID: pedido viejo sin cuenta (página de retorno del pago de antes del cambio).
   *  - AX-XXXXXX: exige sesión de cliente y que el pedido sea suyo. El guard se aplica a mano
   *    porque depende del formato del parámetro.
   */
  @Get('orders/:id')
  async findOne(@Param('id') id: string, @Req() req: any) {
    const raw = String(id ?? '').trim();
    if (UUID_RE.test(raw)) return this.orders.findLegacyPublic(raw.toLowerCase());
    const code = raw.toUpperCase();
    if (!ORDER_CODE_RE.test(code)) throw new NotFoundException('Pedido no encontrado');
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
    if (!(await this.customerGuard.canActivate(ctx))) throw new UnauthorizedException();
    return this.orders.findForCustomer(req.customer.id, code);
  }

  // GET /admin/orders?filter=para_preparar|todos|pendientes_pago|entregados&q=<código>
  @Get('admin/orders')
  @UseGuards(AdminKeyGuard)
  adminList(@Query('filter') filter?: AdminOrderFilter, @Query('q') q?: string) {
    return this.orders.adminList(filter || 'para_preparar', q);
  }

  // PATCH /admin/orders/:id/fulfillment { status, trackingNumber? }
  @Patch('admin/orders/:id/fulfillment')
  @UseGuards(AdminKeyGuard)
  setFulfillment(@Param('id', ParseIntPipe) id: number, @Body() body: { status: FulfillmentStatus; trackingNumber?: string }) {
    return this.orders.setFulfillment(id, body?.status, body?.trackingNumber);
  }

  // GET /admin/orders/:id/receipt -> { url } firmada (10 min)
  @Get('admin/orders/:id/receipt')
  @UseGuards(AdminKeyGuard)
  receipt(@Param('id', ParseIntPipe) id: number) {
    return this.orders.adminReceiptUrl(id);
  }

  // PATCH /admin/orders/:id/payment { action: confirmar | rechazar_comprobante | cancelar }
  @Patch('admin/orders/:id/payment')
  @UseGuards(AdminKeyGuard)
  payment(@Param('id', ParseIntPipe) id: number, @Body() body: { action: AdminPaymentAction }) {
    return this.orders.adminPayment(id, body?.action);
  }

  // POST /payments/webhook -> notificaciones de Mercado Pago (formato webhook v1 o IPN con ?topic=payment&id=)
  @Post('payments/webhook')
  @HttpCode(200)
  async webhook(
    @Body() body: any,
    @Query() query: Record<string, string>,
    @Headers('x-signature') signature?: string,
    @Headers('x-request-id') requestId?: string,
    @Ip() ip?: string,
  ) {
    this.webhookLimiter.check(ip ?? '');
    const type = body?.type ?? query.type ?? query.topic;
    const id = String(body?.data?.id ?? query['data.id'] ?? query.id ?? '');
    if (type !== 'payment') return { ignored: type ?? 'sin tipo' };
    if (!/^\d{1,20}$/.test(id)) throw new BadRequestException('id de pago inválido');
    if (!this.mp.verifySignature(signature, requestId, id)) throw new UnauthorizedException('Firma de Mercado Pago inválida');
    return this.orders.handlePaymentNotification(id);
  }
}
