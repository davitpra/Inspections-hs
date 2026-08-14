import { Module } from '@nestjs/common';

import { RosterController } from './roster.controller';
import { RosterService } from './roster.service';

/**
 * El roster: su importación desde el CSV de ADP y su administración desde la consola.
 *
 * POR QUÉ LA SUPERFICIE HTTP DE `person` VIVE ACÁ. `auth/` son cuentas —`app_user`,
 * credenciales, invitaciones, sesiones— y Persona ≠ Usuario es la distinción central de §4;
 * meter el roster ahí sería empezar a borrarla. `catalog/` es dato de referencia de la
 * organización (las plantas), y las personas no lo son. Este directorio ya era "el roster"
 * desde la etapa 2: solo le faltaba la puerta.
 *
 * No importa `DbModule` porque es `@Global()`. No exporta nada: nadie más necesita esto, y
 * mantenerlo sin exportar es lo que impide que otro módulo se cuelgue de él (ADR-008).
 */
@Module({
  controllers: [RosterController],
  providers: [RosterService],
})
export class RosterModule {}
