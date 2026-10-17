import { BadRequestException, Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { CustomersService } from './customers.service';

// :id tiene que ser un entero positivo
function parseId(value: unknown): number {
  const raw = String(value);
  const id = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) throw new BadRequestException('Id de cliente inválido.');
  return id;
}

@Controller('admin/customers')
@UseGuards(AdminKeyGuard)
export class AdminCustomersController {
  constructor(private readonly customers: CustomersService) {}

  // GET /admin/customers?q= -> clientes con cantidad y total de pedidos pagados
  @Get()
  list(@Query('q') q?: string) {
    return this.customers.adminList(q);
  }

  // GET /admin/customers/:id -> ficha con sus pedidos
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.customers.adminDetail(parseId(id));
  }

  // PATCH /admin/customers/:id { blocked } -> bloquear o desbloquear
  @Patch(':id')
  setBlocked(@Param('id') id: string, @Body() body: { blocked?: unknown }) {
    return this.customers.setBlocked(parseId(id), body?.blocked as boolean);
  }
}
