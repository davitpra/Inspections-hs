import { Injectable } from '@nestjs/common';
import type { TemplateOption } from '@hs/contracts';

import { DbService } from '../db/db.service';
import type { SessionScope } from '../db/site-scope';
import { LATEST_PUBLISHED_VERSION_CTE } from './published-version.sql';

/**
 * Las plantillas que se pueden programar.
 *
 * SIN RECORTE POR SITIO, y no es un olvido: `template` no lleva `site_id` ni política, y
 * la migración 0003 dice por qué —«una plantilla es contenido de referencia de la
 * organización, no un dato de sitio. Si llevara `site_id`, la misma inspección mensual
 * existiría dos veces con dos juegos de `item_key` y "la misma guarda falta en los dos
 * sitios" dejaría de ser consultable»—. La respuesta es idéntica para las dos plantas, y
 * eso es correcto.
 *
 * SOLO LAS PUBLICABLES. El `JOIN` contra `LATEST_PUBLISHED_VERSION_CTE` deja afuera a la
 * plantilla sin ninguna `template_version`, que es exactamente la que
 * `requirePublishedTemplate` rechaza con `template_not_publishable`. Ofrecerla sería
 * ofrecer un error.
 *
 * Y LA VERSIÓN QUE SE INFORMA ES LA QUE SE VA A CONGELAR, porque sale de la misma
 * expresión que usan el planificador y la programación fuera de calendario. Si fueran dos,
 * la pantalla podría decir «versión 2» y la inspección abrir contra la 3 — sin fallar, sin
 * avisar, y dejando escrito en `scheduled_inspection` algo que nadie eligió.
 */
@Injectable()
export class TemplatesService {
  constructor(private readonly db: DbService) {}

  async list(session: SessionScope): Promise<TemplateOption[]> {
    return this.db.withSessionClient(session, async (client) => {
      const { rows } = await client.query<TemplateOption>(
        `WITH latest AS (${LATEST_PUBLISHED_VERSION_CTE})
         SELECT t.id,
                t.name,
                latest.version    AS latest_version,
                latest.version_id AS latest_version_id
           FROM template t
           JOIN latest ON latest.template_id = t.id
          WHERE t.deactivated_at IS NULL
          ORDER BY t.name`,
      );

      return rows;
    });
  }
}
