import { Controller, Get } from '@nestjs/common';
import { type HealthResponse } from '@hs/contracts';
import { AppService } from './app.service';
import { Public } from './auth/auth.guard';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /**
   * Pública a propósito: la consume el healthcheck del contenedor y el proxy, que no
   * tienen sesión ni deben tenerla. No devuelve nada del dominio —`{ status, service }`,
   * `healthResponseSchema`— así que no hay nada que filtrar.
   */
  @Public()
  @Get('health')
  getHealth(): HealthResponse {
    return this.appService.getHealth();
  }
}
