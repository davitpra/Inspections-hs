import { Controller, Get, Query } from '@nestjs/common';
import { rosterQuerySchema, type Person } from '@hs/contracts';

import { CurrentSession } from '../auth/session.decorator';
import type { SessionContext } from '../auth/session.service';
import { RosterService } from './roster.service';

/**
 * La superficie HTTP del roster: **una ruta, de solo lectura**.
 *
 * `/people` y no `/roster`: el recurso son las personas; "roster" es la pantalla.
 *
 * **Esto no es el selector de sujeto.** Aquel vive en `GET /scheduled-inspections/:id/roster`,
 * devuelve cuatro columnas y lo puede llamar cualquiera; §4 dice que el supervisor elige a
 * una persona *sin poder ver su perfil*, y esa frase ata a esa ruta, no a esta. Acá el rol se
 * comprueba en la lectura porque esta ruta SÍ devuelve el perfil. Conectar el selector de
 * incidentes a `/people` rompería lo único que las mantiene separadas.
 *
 * No hay `POST`, `PATCH` ni `DELETE`, y es el alcance decidido: el roster se mantiene con
 * `pnpm roster:import`.
 */
@Controller()
export class RosterController {
  constructor(private readonly roster: RosterService) {}

  /** El roster de una planta. `site_id` es selección entre el alcance, no el límite. */
  @Get('people')
  async list(
    @CurrentSession() session: SessionContext,
    @Query() query: unknown,
  ): Promise<Person[]> {
    return this.roster.list(session, rosterQuerySchema.parse(query));
  }
}
