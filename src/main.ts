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
  if (!process.env.ADMIN_API_KEY && !process.env.JWT_SECRET) {
    console.warn('⚠️  Faltan ADMIN_API_KEY y JWT_SECRET: la administración (escrituras de productos) está deshabilitada.');
  }
  if (!process.env.JWT_SECRET || !process.env.ADMIN_USER || !process.env.ADMIN_PASSWORD_HASH) {
    console.warn('⚠️  Login del panel deshabilitado: faltan JWT_SECRET, ADMIN_USER o ADMIN_PASSWORD_HASH.');
  }
  if (!process.env.MP_ACCESS_TOKEN) {
    console.warn('⚠️  MP_ACCESS_TOKEN no está definida: los pedidos se guardan como cotización (sin pago online).');
  } else if (!process.env.FRONTEND_URL || !process.env.API_PUBLIC_URL) {
    console.warn('⚠️  Mercado Pago necesita FRONTEND_URL (vuelta del pago) y API_PUBLIC_URL (webhook).');
  }
  app.enableCors(corsOptions());

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`🚀 API corriendo en http://localhost:${port}`);
}
bootstrap();
