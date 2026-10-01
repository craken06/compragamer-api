import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { corsOptions } from './cors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  if (!process.env.CORS_ORIGINS) {
    console.warn('⚠️  CORS_ORIGINS no está definida: solo se aceptan orígenes locales (localhost).');
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
