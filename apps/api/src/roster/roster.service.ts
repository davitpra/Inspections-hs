import { Injectable } from '@nestjs/common';
import type { PersonWithAccount, RosterQuery } from '@hs/contracts';

import { DbService } from '../db/db.service';
import type { SessionScope } from '../db/site-scope';
import { rosterForbidden } from './roster.errors';
import { findRoster } from './roster.repository';

/**
 * La consola del roster: poder ver quién trabaja en cada planta sin abrir `psql`.
 *
 * **SOLO LECTURA, Y ES TODO EL ALCANCE.** No hay ninguna ruta que escriba `person` desde
 * acá: ni alta, ni baja, ni corrección de nombre, ni transferencia entre plantas. El
 * roster lo mantiene la importación del CSV de ADP —`parse-roster-csv.ts` y
 * `apply-roster.ts`, en este mismo directorio—, que es su fuente de verdad y la única.
 *
 * Que el motor conceda `UPDATE (first_name, last_name, site_id, deactivated_at)` a
 * `hs_app` no es una invitación a usarlo desde un endpoint: esos privilegios existen para
 * la importación. Si algún día hace falta corregir desde la pantalla, es otro change, con
 * su discusión sobre qué gana cuando el siguiente CSV pise el cambio.
 */
@Injectable()
export class RosterService {
  constructor(private readonly db: DbService) {}

  /**
   * El roster de UNA planta, con las seis columnas de `person` y la cuenta de cada una
   * (proposal — "GET /people devuelve, junto a cada persona, la cuenta que la referencia").
   *
   * POR QUÉ ACÁ HAY UN `WHERE site_id` Y NO ES LA VIOLACIÓN QUE PARECE. `person` **sí**
   * lleva política de aislamiento (`hs_apply_site_isolation`), así que el límite ya está
   * puesto abajo: un `site_id` de otra planta devuelve cero filas sin filtrar nada. Este
   * `WHERE` es SELECCIÓN entre las plantas del alcance, la misma categoría que el de
   * `locationPackage` y `rosterPackage`.
   *
   * Y POR QUÉ NO ESTÁ EL CHEQUEO EXPLÍCITO QUE SÍ TIENE `/inspector-candidates`. Aquel
   * endpoint compara `session.siteIds.includes(siteId)` a mano porque lee `app_user` y
   * `user_site_scope`, que **no llevan política**. Acá sobra, y agregarlo sugeriría que RLS
   * no alcanza — que es justo lo contrario de lo que garantiza ADR-004.
   */
  async list(session: SessionScope, query: RosterQuery): Promise<PersonWithAccount[]> {
    this.requireCoordinator(session);

    return this.db.withSessionClient(session, (client) => findRoster(client, query));
  }

  private requireCoordinator(session: { role: string }): void {
    if (session.role !== 'hs_coordinator') throw rosterForbidden();
  }
}
