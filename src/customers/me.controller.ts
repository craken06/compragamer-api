import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { CustomerGuard } from './customer.guard';
import { CustomersService } from './customers.service';

@Controller('me')
@UseGuards(CustomerGuard)
export class MeController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  get(@Req() req: any) {
    return this.customers.getMe(req.customer.id);
  }

  // PATCH /me { phone?, defaultAddress?, billing? }: lo omitido no cambia, null borra
  @Patch()
  update(@Req() req: any, @Body() body: { phone?: string | null; defaultAddress?: unknown; billing?: unknown }) {
    return this.customers.updateMe(req.customer.id, body ?? {});
  }
}
