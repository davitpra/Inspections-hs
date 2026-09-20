import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { CORS_METHODS, allowedOrigins } from './cors';
import { validateEnv } from './env';
import { authRateLimits } from './rate-limit';
import { closeGracefullyOnSignals } from './shutdown';

async function bootstrap() {
  // Antes de `NestFactory.create`: con el entorno mal, ningún módulo llega a abrir un pool.
  const env = validateEnv(process.env);
  const logger = new Logger('Bootstrap');

  if (env.production && env.databaseSslMode === 'disable') {
    logger.warn(
      'DATABASE_URL declara sslmode=disable. Solo es aceptable en la red privada de la plataforma.',
    );
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Primero, porque `request.ip` lo leen el límite de intentos y la sesión (`ip_address`).
  app.set('trust proxy', env.trustProxy);

  // La API solo devuelve JSON y no sirve HTML: los defaults de helmet no le quitan nada y
  // le ponen HSTS, `nosniff` y una CSP cerrada a cualquier respuesta que un navegador abra
  // directo. CORP `same-origin` no afecta a la PWA: los `fetch` en modo CORS no lo evalúan.
  app.use(helmet());

  app.enableCors({
    origin: allowedOrigins(),
    methods: [...CORS_METHODS],
    allowedHeaders: ['content-type', 'authorization'],
    credentials: false,
  });

  // DESPUÉS de CORS, a propósito. Un 429 sin `Access-Control-Allow-Origin` el navegador no
  // se lo deja leer a la PWA: el inspector vería «Failed to fetch» en vez del mensaje.
  for (const [path, handler] of authRateLimits()) app.use(path, handler);

  closeGracefullyOnSignals(app, env.shutdownGraceMs);

  await app.listen(env.port);
}
bootstrap();
