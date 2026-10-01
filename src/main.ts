import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { allowedOrigins, corsOptions } from './cors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const origins = allowedOrigins();
  if (origins.length === 0) {
    console.warn('⚠️  CORS_ORIGINS no está definida: solo se aceptan orígenes locales (localhost).');
  } else {
    console.log(`CORS: orígenes permitidos -> ${origins.join(', ')}`);
  }
  if (!process.env.ADMIN_API_KEY) {
    console.warn('⚠️  ADMIN_API_KEY no está definida: POST/PUT/DELETE de productos están deshabilitados.');
  }
  app.enableCors(corsOptions());

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`🚀 API corriendo en http://localhost:${port}`);
}
bootstrap();
