import { Prisma } from '@prisma/client';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CUSTOMER_TOKEN_TTL_SECONDS, issueToken } from '../auth/token';
import { PrismaService } from '../prisma/prisma.service';
import { ShippingAddress, normalizeAddress, normalizeBilling, normalizePhone } from './validation';

export interface PublicCustomer {
  id: number;
  email: string;
  name: string;
  avatarUrl: string | null;
  phone: string | null;
  defaultAddress: ShippingAddress | null;
  billingDoc: string | null;
  billingName: string | null;
}

export interface LoginProfile { sub: string; email: string; name: string; picture: string | null; hd?: string | null }

/**
 * Google solo es dueño del email en Gmail y en Google Workspace (token con `hd`). En una cuenta de
 * Google creada con un email de otro dominio, email_verified dice que se verificó alguna vez, no que
 * la persona lo siga controlando (dominio vencido, ex empleado): no alcanza para entrar a una cuenta ajena.
 */
export function canLinkByEmail(provider: string, profile: LoginProfile): boolean {
  if (provider !== 'google') return false;
  return /@(gmail|googlemail)\.com$/.test(profile.email) || (typeof profile.hd === 'string' && !!profile.hd);
}

const EMAIL_TAKEN_MESSAGE = 'Ese email ya tiene una cuenta. Ingresá con la cuenta con la que te registraste o escribinos por WhatsApp.';

export interface AdminCustomerRow {
  id: number; name: string; email: string; avatarUrl: string | null; phone: string | null;
  providers: string[]; createdAt: Date; lastLoginAt: Date; blocked: boolean;
  paidOrders: number; paidTotalArs: number;
}

// cliente con sus identidades y sus pedidos pagados (solo el total) -> fila del panel
const ADMIN_INCLUDE = {
  identities: { select: { provider: true } },
  orders: { where: { status: 'pagado' as const }, select: { totalArs: true } },
};

function toAdminRow(c: any): AdminCustomerRow {
  const paid: any[] = c.orders ?? [];
  return {
    id: c.id, name: c.name, email: c.email, avatarUrl: c.avatarUrl ?? null, phone: c.phone ?? null,
    providers: [...new Set<string>((c.identities ?? []).map((i: any) => i.provider))].sort(),
    createdAt: c.createdAt, lastLoginAt: c.lastLoginAt, blocked: !!c.blocked,
    paidOrders: paid.length,
    paidTotalArs: Math.round(paid.reduce((s, o) => s + Number(o.totalArs), 0) * 100) / 100,
  };
}

const BLOCKED_MESSAGE = 'Tu cuenta está suspendida. Escribinos por WhatsApp.';

export function toPublicCustomer(c: any): PublicCustomer {
  return {
    id: c.id,
    email: c.email,
    name: c.name,
    avatarUrl: c.avatarUrl ?? null,
    phone: c.phone ?? null,
    defaultAddress: (c.defaultAddress as ShippingAddress | null) ?? null,
    billingDoc: c.billingDoc ?? null,
    billingName: c.billingName ?? null,
  };
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Ingreso o alta con un perfil ya verificado por el proveedor (spec 4.3). */
  async loginWithIdentity(provider: 'google' | 'microsoft', profile: LoginProfile): Promise<{ token: string; customer: PublicCustomer }> {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new ForbiddenException('Ingreso deshabilitado: falta JWT_SECRET en el servidor');

    // el verificador ya completa el nombre; acá se asegura igual (parte local del email)
    const name = profile.name?.trim() || profile.email.split('@')[0];
    profile = { ...profile, name, email: profile.email.trim().toLowerCase() };

    let customer: any;
    try {
      customer = await this.findOrCreate(provider, profile);
    } catch (e: any) {
      // dos primeros ingresos en paralelo: el segundo choca con el único (proveedor+sujeto o email); se repite la búsqueda
      if (e?.code !== 'P2002') throw e;
      customer = await this.findOrCreate(provider, profile);
    }
    if (customer.blocked) throw new ForbiddenException(BLOCKED_MESSAGE);

    const updated = await this.prisma.customer.update({
      where: { id: customer.id },
      data: { name: profile.name, avatarUrl: profile.picture || null, lastLoginAt: new Date() },
    });
    const token = issueToken(String(updated.id), secret, { role: 'customer', ttlSeconds: CUSTOMER_TOKEN_TTL_SECONDS });
    return { token, customer: toPublicCustomer(updated) };
  }

  // Devuelve el cliente (aunque esté bloqueado: el llamador decide); crea lo que falte en una transacción.
  private findOrCreate(provider: string, profile: LoginProfile) {
    return this.prisma.$transaction(async (tx: any) => {
      const identity = await tx.customerIdentity.findUnique({
        where: { provider_subject: { provider, subject: profile.sub } },
        include: { customer: true },
      });
      if (identity) return identity.customer;

      const byEmail = await tx.customer.findUnique({ where: { email: profile.email } });
      if (byEmail) {
        // el email es único en customers, así que no se puede abrir otra cuenta con él: si el proveedor
        // no es autoritativo para ese email, se rechaza en vez de vincular (ver canLinkByEmail)
        if (!canLinkByEmail(provider, profile)) throw new ForbiddenException(byEmail.blocked ? BLOCKED_MESSAGE : EMAIL_TAKEN_MESSAGE);
        // un bloqueado no suma identidades
        if (!byEmail.blocked) {
          await tx.customerIdentity.create({ data: { customerId: byEmail.id, provider, subject: profile.sub, email: profile.email } });
        }
        return byEmail;
      }

      return tx.customer.create({
        data: {
          email: profile.email,
          name: profile.name,
          avatarUrl: profile.picture || null,
          identities: { create: { provider, subject: profile.sub, email: profile.email } },
        },
      });
    });
  }

  async getMe(id: number): Promise<PublicCustomer> {
    const c = await this.prisma.customer.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('No encontramos tu cuenta.');
    return toPublicCustomer(c);
  }

  /** Las claves ausentes no se tocan; `null` borra el dato. */
  async updateMe(
    id: number,
    body: { phone?: string | null; defaultAddress?: unknown; billing?: unknown },
  ): Promise<PublicCustomer> {
    const data: Prisma.CustomerUpdateInput = {};
    if (body?.phone !== undefined) data.phone = body.phone === null ? null : normalizePhone(body.phone);
    if (body?.defaultAddress !== undefined) {
      // un Json nullable no acepta null a secas: borrar es Prisma.DbNull
      data.defaultAddress = body.defaultAddress === null ? Prisma.DbNull : (normalizeAddress(body.defaultAddress) as unknown as Prisma.InputJsonObject);
    }
    if (body?.billing !== undefined) {
      const billing = body.billing === null ? null : normalizeBilling(body.billing);
      data.billingDoc = billing?.doc ?? null;
      data.billingName = billing?.name ?? null;
    }
    const updated = await this.prisma.customer.update({ where: { id }, data });
    return toPublicCustomer(updated);
  }

  /** Listado del panel (spec 4.8): búsqueda por nombre, email o teléfono; los de ingreso más reciente primero. */
  async adminList(q?: string): Promise<AdminCustomerRow[]> {
    const search = typeof q === 'string' ? q.trim().slice(0, 80) : '';
    const where: Prisma.CustomerWhereInput = {};
    if (search) {
      const digits = search.replace(/\D/g, '');
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        ...(digits ? [{ phone: { contains: digits } }] : []),
      ];
    }
    const rows = await this.prisma.customer.findMany({ where, orderBy: { lastLoginAt: 'desc' }, take: 200, include: ADMIN_INCLUDE });
    return rows.map(toAdminRow);
  }

  /** Ficha del cliente: sus datos, el bloqueo y todos sus pedidos (misma forma que el listado de pedidos del panel). */
  async adminDetail(id: number) {
    const c = await this.prisma.customer.findUnique({ where: { id }, include: ADMIN_INCLUDE });
    if (!c) throw new NotFoundException('Cliente no encontrado');
    const orders = await this.prisma.order.findMany({
      where: { customerId: id }, orderBy: { createdAt: 'desc' },
      include: { items: true, customer: { select: { id: true, name: true } } },
    });
    return { ...toPublicCustomer(c), ...toAdminRow(c), orders };
  }

  /** Bloquear impide ingresar y usar la sesión vigente; no borra nada. */
  async setBlocked(id: number, blocked: boolean): Promise<AdminCustomerRow> {
    if (typeof blocked !== 'boolean') throw new BadRequestException('blocked tiene que ser verdadero o falso.');
    const c = await this.prisma.customer.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Cliente no encontrado');
    const updated = await this.prisma.customer.update({ where: { id }, data: { blocked }, include: ADMIN_INCLUDE });
    return toAdminRow(updated);
  }
}
