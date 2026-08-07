import { Controller, Get } from '@nestjs/common';
import { type HealthResponse } from '@hs/contracts';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  getHealth(): HealthResponse {
    return this.appService.getHealth();
  }
}
