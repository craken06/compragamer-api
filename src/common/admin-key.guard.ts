import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { verifyToken } from '../auth/token';

/**
 * Protege los endpoints de administración (escrituras y lecturas privadas).
 * Solo acepta `Authorization: Bearer <token>` con el token que devuelve POST /auth/login,
 * firmado con JWT_SECRET: nadie entra sin el usuario y la contraseña del admin.
 * (Ya no hay clave aparte tipo x-admin-key: sería una puerta trasera sin login ni bloqueo.)
 * Si falta JWT_SECRET en el servidor, falla cerrado.
 */
@Injectable()
export class AdminKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new ForbiddenException('Administración deshabilitada: falta configurar JWT_SECRET en el servidor');
    }
    const req = context.switchToHttp().getRequest();

    const auth = String(req.headers['authorization'] ?? '');
    if (!auth.startsWith('Bearer ')) throw new UnauthorizedException('Credenciales de administración inválidas');
    const payload = verifyToken(auth.slice(7).trim(), jwtSecret);
    if (!payload) throw new UnauthorizedException('Sesión vencida o inválida: volvé a iniciar sesión');
    // Los clientes usan el mismo JWT_SECRET: solo role=admin pasa (los tokens viejos sin role también se rechazan).
    if (payload.role !== 'admin') throw new UnauthorizedException('Sesión vencida o inválida: volvé a iniciar sesión');
    req.admin = payload.sub;
    return true;
  }
}
