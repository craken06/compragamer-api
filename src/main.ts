import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { allowedOrigins, corsOptions } from './cors';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // detrás del proxy de Render/ngrok: la IP real del cliente viene en X-Forwarded-For (límites por IP)
  app.set('trust proxy', 1);

  const origins = allowedOrigins();
  if (origins.length === 0) {
    console.warn('⚠️  CORS_ORIGINS no está definida: solo se aceptan orígenes locales (localhost).');
  } else {
    console.log(`CORS: orígenes permitidos -> ${origins.join(', ')}`);
  }
  if (!process.env.JWT_SECRET) {
    console.warn('⚠️  Falta JWT_SECRET: la administración (escrituras de productos, pedidos, clientes) está deshabilitada.');
  }
  if (process.env.ADMIN_API_KEY) {
    console.warn('⚠️  ADMIN_API_KEY ya no se usa (la administración exige usuario y contraseña): borrala de las variables del servidor.');
  }
  if (!process.env.JWT_SECRET || !process.env.ADMIN_USER || !process.env.ADMIN_PASSWORD_HASH) {
    console.warn('⚠️  Login del panel deshabilitado: faltan JWT_SECRET, ADMIN_USER o ADMIN_PASSWORD_HASH.');
  }
  if (!process.env.GOOGLE_CLIENT_ID) {
    console.warn('⚠️  GOOGLE_CLIENT_ID no está definida: el ingreso de clientes con Google está deshabilitado.');
  }
  if (!process.env.MP_ACCESS_TOKEN) {
    console.warn('⚠️  MP_ACCESS_TOKEN no está definida: los pedidos se guardan como cotización (sin pago online).');
  } else {
    if (!process.env.FRONTEND_URL || !process.env.API_PUBLIC_URL) {
      console.warn('⚠️  Mercado Pago necesita FRONTEND_URL (vuelta del pago) y API_PUBLIC_URL (webhook).');
    }
    if (!process.env.MP_WEBHOOK_SECRET) {
      console.warn('⚠️  MP_WEBHOOK_SECRET no está definida: el webhook de Mercado Pago acepta notificaciones SIN firma. '
        + 'Copiá la clave secreta de Webhooks del panel de MP en MP_WEBHOOK_SECRET.');
    }
  }
  app.enableCors(corsOptions());

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`🚀 API corriendo en http://localhost:${port}`);
}
bootstrap();
