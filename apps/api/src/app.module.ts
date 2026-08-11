import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ActionsModule } from './actions/actions.module';
import { IncidentsModule } from './incidents/incidents.module';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { FindingsModule } from './findings/findings.module';
import { InspectionsModule } from './inspections/inspections.module';
import { JobsModule } from './jobs/jobs.module';
import { NotificationsModule } from './notifications/notifications.module';
import { UploadsModule } from './uploads/uploads.module';

@Module({
  imports: [
    DbModule,
    JobsModule,
    AuthModule,
    InspectionsModule,
    FindingsModule,
    ActionsModule,
    IncidentsModule,
    NotificationsModule,
    UploadsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
