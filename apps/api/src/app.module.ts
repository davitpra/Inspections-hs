import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ZodExceptionFilter } from './common/zod-exception.filter';
import { ActionsModule } from './actions/actions.module';
import { IncidentsModule } from './incidents/incidents.module';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { DbModule } from './db/db.module';
import { FindingsModule } from './findings/findings.module';
import { InspectionsModule } from './inspections/inspections.module';
import { JobsModule } from './jobs/jobs.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReportingModule } from './reporting/reporting.module';
import { TemplatesModule } from './templates/templates.module';
import { UploadsModule } from './uploads/uploads.module';

@Module({
  imports: [
    DbModule,
    JobsModule,
    AuthModule,
    InspectionsModule,
    // ANTES QUE `FindingsModule`, Y NO ES ESTILO. `ReportingController` declara
    // `GET findings/recurrence` y `FindingsController` declara `GET findings/:id`:
    // Nest resuelve por orden de registro, así que invertir estas dos líneas hace que
    // el parámetro se coma el literal y que pedir la recurrencia termine buscando un
    // hallazgo con id "recurrence". Un test de integración lo verifica.
    ReportingModule,
    FindingsModule,
    ActionsModule,
    IncidentsModule,
    NotificationsModule,
    UploadsModule,
    // Los catálogos de solo lectura que la consola de programación necesita para
    // ofrecer nombres en vez de identificadores. Ninguno declara un `:param` a nivel
    // raíz, así que no hay riesgo de orden como el de `findings/recurrence`.
    CatalogModule,
    TemplatesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Como proveedor y no como `app.useGlobalFilters()` en `main.ts`: los tests de
    // integración levantan la app con `Test.createTestingModule`, que no pasa por
    // `bootstrap`. Registrarlo acá es lo que hace que lo probado sea lo que corre.
    { provide: APP_FILTER, useClass: ZodExceptionFilter },
  ],
})
export class AppModule {}
