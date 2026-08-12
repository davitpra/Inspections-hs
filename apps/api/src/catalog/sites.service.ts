import { Injectable } from '@nestjs/common';
import type { Site } from '@hs/contracts';

import { DbService } from '../db/db.service';
import type { SessionScope } from '../db/site-scope';

/**
 * Las plantas que la sesión alcanza.
 *
 * POR QUÉ ACÁ HAY UN `WHERE` DE SITIO Y NO ES LA VIOLACIÓN QUE PARECE. La invariante del
 * proyecto dice «aislamiento por sitio vía políticas RLS, nunca vía WHERE en el
 * endpoint», y esta consulta filtra por `session.siteIds` a mano. La diferencia es que
 * **`site` no lleva política**, y eso está decidido y escrito en la migración 0004 desde
 * el primer día:
 *
 *   «Dato de referencia de la organización, no contenido operativo […] Ponérsela crearía
 *   un arranque circular —para insertar la fila habría que declarar en `app.site_ids` un
 *   id que todavía no existe— a cambio de esconder el hecho de que la otra planta existe,
 *   que no es lo que protege §6 pregunta 5. Lo que esa pregunta protege son los hallazgos,
 *   y viven en tablas con `site_id` y con política. **El aislamiento empieza en
 *   `location`.**»
 *
 * O sea: no hay política que rodear. El filtro es SELECCIÓN, la misma categoría que el
 * `WHERE site_id` que ya llevan `locationPackage` y `rosterPackage` en el servicio de
 * inspecciones. Si alguien "corrige" esto sacando el `WHERE`, el listado devuelve las dos
 * plantas a todo el mundo.
 *
 * SIN FILTRAR `deactivated_at`: una regla o una inspección de una planta cerrada tiene que
 * seguir resolviendo a un nombre y no a un identificador. Quien arma un selector filtra
 * por su cuenta; quien arma una etiqueta necesita la fila igual.
 *
 * Sin comprobación de rol: nombrar las plantas donde uno trabaja no es administrar nada, y
 * el paquete de campo ya le sirve bastante más que esto a cualquier inspector.
 */
@Injectable()
export class SitesService {
  constructor(private readonly db: DbService) {}

  async list(session: SessionScope): Promise<Site[]> {
    return this.db.withSessionClient(session, async (client) => {
      const { rows } = await client.query<SiteRow>(
        `SELECT id, code, name, deactivated_at
           FROM site
          WHERE id = ANY($1::uuid[])
          ORDER BY name`,
        [[...session.siteIds]],
      );

      return rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        deactivated_at: row.deactivated_at?.toISOString() ?? null,
      }));
    });
  }
}

interface SiteRow extends Record<string, unknown> {
  id: string;
  code: string;
  name: string;
  deactivated_at: Date | null;
}
