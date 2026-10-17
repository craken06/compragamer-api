import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { verifyToken } from '../auth/token';
import { PrismaService } from '../prisma/prisma.service';

const MESSAGE = 'Tu sesión venció. Ingresá de nuevo.';

/**
 * Protege los endpoints de cliente: token firmado con JWT_SECRET y role === 'customer'.
 * Carga el cliente de la base en cada request (así un bloqueo o borrado corta la sesión al instante)
 * y lo deja en `req.customer`.
 */
@Injectable()
export class CustomerGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const secret = process.env.JWT_SECRET;
    const req = context.switchToHttp().getRequest();
    const auth = String(req.headers?.['authorization'] ?? '');
    if (!secret || !auth.startsWith('Bearer ')) throw new UnauthorizedException(MESSAGE);

    const payload = verifyToken(auth.slice(7).trim(), secret);
    // Los tokens de admin comparten el secreto: solo role=customer pasa.
    if (!payload || payload.role !== 'customer' || !/^[1-9]\d{0,9}$/.test(payload.sub)) throw new UnauthorizedException(MESSAGE);

    const customer = await this.prisma.customer.findUnique({ where: { id: Number(payload.sub) } });
    if (!customer || customer.blocked) throw new UnauthorizedException(MESSAGE);

    req.customer = { id: customer.id, email: customer.email, name: customer.name, phone: customer.phone ?? null };
    return true;
  }
}
