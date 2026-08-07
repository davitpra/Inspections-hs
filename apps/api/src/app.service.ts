import { Injectable } from '@nestjs/common';
import { healthResponseSchema, type HealthResponse } from '@hs/contracts';

@Injectable()
export class AppService {
  getHealth(): HealthResponse {
    // El contrato se valida acá y no en el cliente: la API es la que promete la forma.
    return healthResponseSchema.parse({ status: 'ok', service: 'api' });
  }
}
