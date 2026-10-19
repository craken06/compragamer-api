import { BadRequestException, Body, Controller, Get, HttpCode, Ip, Optional, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { RateLimiter } from '../common/rate-limit';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { REVOCATION_PREFIX, revocationCode } from '../mail/templates';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

@Controller()
export class ContactController {
  private limiter = new RateLimiter(5, 60 * 60 * 1000, 'Ya recibimos varios mensajes tuyos. Si es urgente, escribinos por WhatsApp.');

  constructor(private prisma: PrismaService, @Optional() private mail?: MailService) {}

  // POST /contact { name, email, phone?, message } -> guarda el mensaje para el panel de administración y avisa por mail.
  // Un arrepentimiento (prefijo REVOCATION_PREFIX) devuelve además el código de la solicitud: { ok, code }.
  @Post('contact')
  @HttpCode(201)
  async create(@Body() body: { name?: string; email?: string; phone?: string; message?: string; website?: string }, @Ip() ip: string) {
    if (body?.website) return { ok: true }; // campo trampa: lo completan los bots, no las personas
    const name = String(body?.name ?? '').trim().slice(0, 120);
    const email = String(body?.email ?? '').trim().toLowerCase().slice(0, 160);
    const phone = String(body?.phone ?? '').trim().slice(0, 40) || null;
    const message = String(body?.message ?? '').trim().slice(0, 4000);
    if (name.length < 2) throw new BadRequestException('Falta el nombre.');
    if (!EMAIL_RE.test(email)) throw new BadRequestException('El email no es válido.');
    if (message.length < 5) throw new BadRequestException('El mensaje está vacío.');
    this.limiter.check(ip);
    const saved = await this.prisma.contactMessage.create({ data: { name, email, phone, message } });
    const code = message.startsWith(REVOCATION_PREFIX) ? revocationCode(saved.id) : undefined;
    this.mail?.contactReceived({ id: saved.id, name, email, phone, message }, code);
    return code ? { ok: true, code } : { ok: true };
  }

  @Get('admin/contact')
  @UseGuards(AdminKeyGuard)
  list() {
    return this.prisma.contactMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  }

  @Put('admin/contact/:id/read')
  @UseGuards(AdminKeyGuard)
  markRead(@Param('id', ParseIntPipe) id: number) {
    return this.prisma.contactMessage.update({ where: { id }, data: { read: true } });
  }
}
