import {
  BadRequestException, Body, Controller, ExecutionContext, Get, Headers, HttpCode, Ip, NotFoundException, Param,
  ParseIntPipe, Patch, Post, Query, Req, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { FulfillmentStatus } from '@prisma/client';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { RateLimiter } from '../common/rate-limit';
import { CustomerGuard } from '../customers/customer.guard';
import { AdminOrderFilter, CreateOrderRequest, OrdersService } from './orders.service';
import { MercadoPagoClient } from './mercadopago.client';
import { ORDER_CODE_RE } from './order-code';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller()
export class OrdersController {
  private limiter = new RateLimiter(10, 60 * 60 * 1000, 'Demasiados pedidos seguidos. Escribinos por WhatsApp.');

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
    return this.orders.create(req.customer, body ?? ({} as CreateOrderRequest));
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

  // POST /payments/webhook -> notificaciones de Mercado Pago (formato webhook v1 o IPN con ?topic=payment&id=)
  @Post('payments/webhook')
  @HttpCode(200)
  async webhook(
    @Body() body: any,
    @Query() query: Record<string, string>,
    @Headers('x-signature') signature?: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    const type = body?.type ?? query.type ?? query.topic;
    const id = String(body?.data?.id ?? query['data.id'] ?? query.id ?? '');
    if (type !== 'payment') return { ignored: type ?? 'sin tipo' };
    if (!/^\d{1,20}$/.test(id)) throw new BadRequestException('id de pago inválido');
    if (!this.mp.verifySignature(signature, requestId, id)) throw new UnauthorizedException('Firma de Mercado Pago inválida');
    return this.orders.handlePaymentNotification(id);
  }
}
