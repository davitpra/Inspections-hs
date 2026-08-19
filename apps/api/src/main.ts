import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CORS_METHODS, allowedOrigins } from './cors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: allowedOrigins(),
    methods: [...CORS_METHODS],
    allowedHeaders: ['content-type', 'authorization'],
    credentials: false,
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
