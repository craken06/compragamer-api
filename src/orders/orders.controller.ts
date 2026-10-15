import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Ip, Param, ParseUUIDPipe, Post, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { RateLimiter } from '../common/rate-limit';
import { CreateOrderRequest, OrdersService } from './orders.service';
import { MercadoPagoClient } from './mercadopago.client';

@Controller()
export class OrdersController {
  private limiter = new RateLimiter(10, 60 * 60 * 1000, 'Demasiados pedidos seguidos. Escribinos por WhatsApp.');

  constructor(private readonly orders: OrdersService, private readonly mp: MercadoPagoClient) {}

  // POST /orders -> { publicId, status, totalArs, paymentUrl } (paymentUrl = checkout de Mercado Pago)
  @Post('orders')
  create(@Body() body: CreateOrderRequest, @Ip() ip: string) {
    this.limiter.check(ip);
    return this.orders.create(body);
  }

  // GET /orders/:publicId -> estado del pedido (página de retorno del pago)
  @Get('orders/:publicId')
  findOne(@Param('publicId', new ParseUUIDPipe()) publicId: string) {
    return this.orders.findPublic(publicId);
  }

  // GET /admin/orders -> listado completo para el panel de administración
  @Get('admin/orders')
  @UseGuards(AdminKeyGuard)
  findAll() {
    return this.orders.findAll();
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
