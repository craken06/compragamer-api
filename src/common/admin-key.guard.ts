import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

/**
 * Protege los endpoints que escriben (POST / PUT / DELETE).
 * Se envía la clave en el header `x-admin-key`, y se compara con ADMIN_API_KEY.
 * Si ADMIN_API_KEY no está definida, la escritura queda deshabilitada (falla cerrada).
 */
@Injectable()
export class AdminKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.ADMIN_API_KEY;
    if (!expected) {
      throw new ForbiddenException('Escritura deshabilitada: falta configurar ADMIN_API_KEY en el servidor');
    }
    const req = context.switchToHttp().getRequest();
    const provided = String(req.headers['x-admin-key'] ?? '');

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Clave de administración inválida');
    }
    return true;
  }
}
