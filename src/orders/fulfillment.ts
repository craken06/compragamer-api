import { BadRequestException } from '@nestjs/common';
import { FulfillmentStatus, OrderStatus } from '@prisma/client';

export type DeliveryMethod = 'envio' | 'retiro';

/**
 * Estados de entrega que se pueden elegir para un pedido (spec 4.8).
 * Solo para pagados; se puede volver atrás para corregir un error.
 * Pedidos viejos (sin método de entrega): sin `enviado` ni `listo_para_retirar`.
 */
export function allowedFulfillment(order: { status: OrderStatus; deliveryMethod: DeliveryMethod | string | null }): FulfillmentStatus[] {
  if (order.status !== 'pagado') return [];
  if (order.deliveryMethod === 'envio') return ['pendiente', 'preparando', 'enviado', 'entregado'];
  if (order.deliveryMethod === 'retiro') return ['pendiente', 'preparando', 'listo_para_retirar', 'entregado'];
  return ['pendiente', 'preparando', 'entregado'];
}

export function assertFulfillment(order: { status: OrderStatus; deliveryMethod: DeliveryMethod | string | null }, status: FulfillmentStatus): void {
  if (order.status !== 'pagado') throw new BadRequestException('Solo se puede cambiar la entrega de un pedido pagado.');
  if (!allowedFulfillment(order).includes(status)) throw new BadRequestException('Ese estado no corresponde al tipo de entrega.');
}

/** Datos a guardar: el número de seguimiento solo vale con `enviado` (recortado, máx. 80). */
export function fulfillmentData(status: FulfillmentStatus, trackingNumber?: string | null) {
  const tracking = status === 'enviado' && typeof trackingNumber === 'string' ? trackingNumber.trim().slice(0, 80) : '';
  return { fulfillmentStatus: status, trackingNumber: tracking || null };
}
