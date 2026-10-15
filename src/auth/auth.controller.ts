import { Body, Controller, ForbiddenException, Get, HttpCode, HttpException, HttpStatus, Ip, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { AdminKeyGuard } from '../common/admin-key.guard';
import { TOKEN_TTL_SECONDS, issueToken, verifyPassword } from './token';

const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;

@Controller('auth')
export class AuthController {
  // intentos fallidos por IP (en memoria: alcanza para un único servidor)
  private fails = new Map<string, { count: number; first: number }>();

  // POST /auth/login { user, password } -> { token, expiresIn }
  @Post('login')
  @HttpCode(200)
  login(@Body() body: { user?: string; password?: string }, @Ip() ip: string) {
    const secret = process.env.JWT_SECRET;
    const expectedUser = process.env.ADMIN_USER;
    const hash = process.env.ADMIN_PASSWORD_HASH;
    if (!secret || !expectedUser || !hash) {
      throw new ForbiddenException('Login deshabilitado: faltan JWT_SECRET, ADMIN_USER o ADMIN_PASSWORD_HASH en el servidor');
    }

    const now = Date.now();
    const f = this.fails.get(ip);
    if (f && now - f.first < WINDOW_MS && f.count >= MAX_FAILS) {
      throw new HttpException('Demasiados intentos fallidos. Probá de nuevo en 15 minutos.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = String(body?.user ?? '');
    const a = Buffer.from(user), b = Buffer.from(expectedUser);
    const userOk = a.length === b.length && timingSafeEqual(a, b);
    const passOk = verifyPassword(String(body?.password ?? ''), hash); // se calcula siempre: mismo tiempo con usuario malo
    if (!userOk || !passOk) {
      const entry = f && now - f.first < WINDOW_MS ? f : { count: 0, first: now };
      entry.count++;
      this.fails.set(ip, entry);
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }
    this.fails.delete(ip);
    return { token: issueToken(user, secret), expiresIn: TOKEN_TTL_SECONDS };
  }

  // GET /auth/me -> valida el token (el admin lo usa al cargar)
  @Get('me')
  @UseGuards(AdminKeyGuard)
  me(@Req() req: any) {
    return { user: req.admin ?? 'api-key' };
  }
}
