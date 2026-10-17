import { BadRequestException, Body, Controller, ForbiddenException, HttpCode, Inject, Ip, Post } from '@nestjs/common';
import { RateLimiter } from '../common/rate-limit';
import { CustomersService } from './customers.service';
import { GOOGLE_CERTS_URL, GoogleProfile, createKeyCache, verifyGoogleCredential } from './google';

/** Verifica el comprobante de Google; se inyecta para que los tests no toquen la red. */
export const GOOGLE_VERIFIER = 'GOOGLE_VERIFIER';
export type GoogleVerifier = (credential: string, clientId: string) => Promise<GoogleProfile>;

/** Verificador real: un solo caché de claves para todo el proceso. */
export function createGoogleVerifier(): GoogleVerifier {
  const getKey = createKeyCache(GOOGLE_CERTS_URL);
  return (credential, clientId) => verifyGoogleCredential(credential, { clientId, getKey });
}

@Controller('customer-auth')
export class CustomerAuthController {
  private readonly limiter = new RateLimiter(30, 60 * 60 * 1000, 'Demasiados intentos. Probá de nuevo en un rato.');

  constructor(
    private readonly customers: CustomersService,
    @Inject(GOOGLE_VERIFIER) private readonly verifyGoogle: GoogleVerifier,
  ) {}

  // POST /customer-auth/google { credential } -> { token, customer }
  @Post('google')
  @HttpCode(200)
  async google(@Body() body: { credential?: string }, @Ip() ip: string) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) throw new ForbiddenException('Ingreso con Google deshabilitado');
    if (!process.env.JWT_SECRET) throw new ForbiddenException('Ingreso deshabilitado: falta JWT_SECRET en el servidor');
    this.limiter.check(ip);
    const credential = body?.credential;
    if (typeof credential !== 'string' || !credential) throw new BadRequestException('Falta el comprobante de Google.');
    const profile = await this.verifyGoogle(credential, clientId);
    return this.customers.loginWithIdentity('google', profile);
  }
}
