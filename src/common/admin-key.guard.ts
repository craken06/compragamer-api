import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { verifyToken } from '../auth/token';

/**
 * Protege los endpoints de administración (escrituras y lecturas privadas).
 * Acepta cualquiera de las dos credenciales:
 *  - `Authorization: Bearer <token>` que devuelve POST /auth/login (panel de administración), firmado con JWT_SECRET.
 *  - `x-admin-key: <ADMIN_API_KEY>` (scripts y herramientas).
 * Si no hay ninguna de las dos configuradas en el servidor, falla cerrado.
 */
@Injectable()
export class AdminKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const apiKey = process.env.ADMIN_API_KEY;
    const jwtSecret = process.env.JWT_SECRET;
    if (!apiKey && !jwtSecret) {
      throw new ForbiddenException('Administración deshabilitada: falta configurar ADMIN_API_KEY o JWT_SECRET en el servidor');
    }
    const req = context.switchToHttp().getRequest();

    const auth = String(req.headers['authorization'] ?? '');
    if (jwtSecret && auth.startsWith('Bearer ')) {
      const payload = verifyToken(auth.slice(7).trim(), jwtSecret);
      if (!payload) throw new UnauthorizedException('Sesión vencida o inválida: volvé a iniciar sesión');
      req.admin = payload.sub;
      return true;
    }

    const provided = String(req.headers['x-admin-key'] ?? '');
    if (apiKey && provided) {
      const a = Buffer.from(provided);
      const b = Buffer.from(apiKey);
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    }
    throw new UnauthorizedException('Credenciales de administración inválidas');
  }
}
