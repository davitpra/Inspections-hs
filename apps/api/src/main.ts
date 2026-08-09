import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * La PWA se sirve como archivos estáticos y la API es otro proceso: son dos orígenes
 * distintos, y sin CORS el dispositivo no puede llamar a ninguna ruta. `apps/web` ya
 * está construido así — `VITE_API_BASE_URL` apunta a otro host — así que esto no es una
 * concesión al desarrollo local sino la configuración que el despliegue necesita.
 *
 * **Lista blanca explícita, nunca `*`.** Un comodín acá le daría a cualquier página del
 * navegador del inspector permiso para hablarle a la API con su sesión. El token viaja
 * en el header `Authorization` y no en una cookie, así que `credentials` queda en
 * `false`: no hay nada que el navegador deba adjuntar solo.
 */
function allowedOrigins(): string[] {
  const configured = process.env.WEB_ORIGINS;

  if (configured) return configured.split(',').map((origin) => origin.trim());

  // Sin configurar: solo el servidor de desarrollo de Vite. Un despliegue que no
  // declare `WEB_ORIGINS` deja de responderle a su propia PWA, que es un fallo ruidoso
  // y por lo tanto preferible a un comodín silencioso.
  return ['http://localhost:5173', 'http://localhost:4173'];
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: allowedOrigins(),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'authorization'],
    credentials: false,
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
