import { Injectable } from '@nestjs/common';
import type { Person, RosterQuery } from '@hs/contracts';

import { DbService } from '../db/db.service';
import type { SessionScope } from '../db/site-scope';
import { rosterForbidden } from './roster.errors';

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
   * El roster de UNA planta, con las seis columnas de `person`.
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
  async list(session: SessionScope, query: RosterQuery): Promise<Person[]> {
    this.requireCoordinator(session);

    return this.db.withSessionClient(session, async (client) => {
      const { rows } = await client.query<PersonRow>(
        `SELECT id, site_id, employee_number, first_name, last_name, deactivated_at
           FROM person
          WHERE site_id = $1
            AND ($2 = 'all'
                 OR ($2 = 'active' AND deactivated_at IS NULL)
                 OR ($2 = 'inactive' AND deactivated_at IS NOT NULL))
          ORDER BY last_name, first_name, employee_number`,
        [query.site_id, query.status],
      );

      return rows.map(toPerson);
    });
  }

  private requireCoordinator(session: { role: string }): void {
    if (session.role !== 'hs_coordinator') throw rosterForbidden();
  }
}

function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    site_id: row.site_id,
    employee_number: row.employee_number,
    first_name: row.first_name,
    last_name: row.last_name,
    deactivated_at: row.deactivated_at?.toISOString() ?? null,
  };
}

interface PersonRow extends Record<string, unknown> {
  id: string;
  site_id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  deactivated_at: Date | null;
}
