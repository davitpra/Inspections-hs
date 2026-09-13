import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { isAdministrator, type CreateSite, type Site, type UpdateSite } from '@hs/contracts';

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
        // POR ANTIGÜEDAD, no por nombre: la consola abre en la primera de esta lista y
        // renombrar una planta no tiene por qué mover a nadie de consola. `id` desempata
        // para que dos altas del mismo instante no alternen entre requests.
        `SELECT id, code, name, deactivated_at
           FROM site
          WHERE id = ANY($1::uuid[])
          ORDER BY created_at, id`,
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

  /**
   * Registra una planta y da alcance a quien la registró, en una sola transacción.
   *
   * El sitio nuevo todavía no está en `app.site_ids`, pero el trigger de `site.created`
   * y el de `user.scope_granted` necesitan verlo para escribir en la cadena protegida.
   * Por eso se ensancha el alcance de esta transacción antes del INSERT: solo se agrega
   * el id generado acá, su fila de `user_site_scope` se inserta antes del COMMIT, y el
   * `true` de `set_config` lo hace SET LOCAL. Es la única excepción a que el guard
   * produzca el alcance; no alcanza ningún sitio existente fuera de esta operación.
   */
  async create(session: SessionScope, input: CreateSite): Promise<Site> {
    this.requireCoordinator(session);

    return this.db.withSessionClient(session, async (client) => {
      try {
        const generated = await client.query<{ id: string }>('SELECT gen_random_uuid() AS id');
        const siteId = generated.rows[0]!.id;
        const siteIds = [...new Set([...session.siteIds, siteId])];

        await client.query('SELECT set_config($1, $2, true)', ['app.site_ids', siteIds.join(',')]);

        const { rows } = await client.query<SiteRow>(
          `INSERT INTO site (id, code, name)
                VALUES ($1, $2, $3)
             RETURNING id, code, name, deactivated_at`,
          [siteId, input.code, input.name],
        );

        await client.query(
          'INSERT INTO user_site_scope (user_id, site_id) VALUES ($1, $2)',
          [session.userId, siteId],
        );

        return toSite(rows[0] as SiteRow);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new BadRequestException(`The code "${input.code}" is already in use`);
        }

        throw error;
      }
    });
  }

  async update(session: SessionScope, siteId: string, input: UpdateSite): Promise<Site> {
    this.requireCoordinator(session);

    return this.db.withSessionClient(session, async (client) => {
      const { rows } = await client.query<SiteRow>(
        `UPDATE site
            SET name = $1
          WHERE id = $2
            AND id = ANY($3::uuid[])
          RETURNING id, code, name, deactivated_at`,
        [input.name, siteId, [...session.siteIds]],
      );

      if (rows.length === 0) {
        throw new NotFoundException('Site not found in the current scope');
      }

      return toSite(rows[0] as SiteRow);
    });
  }

  async deactivate(session: SessionScope, siteId: string): Promise<Site> {
    this.requireCoordinator(session);

    return this.db.withSessionClient(session, async (client) => {
      // Sin SELECT ... FOR UPDATE: el motor solo concede UPDATE por columna sobre
      // `site` (0023), y el bloqueo de fila exige el privilegio de tabla completo.
      // La propia baja es la que arbitra la carrera: solo una transacción encuentra
      // la fila todavía activa.
      const updated = await client.query<SiteRow>(
        `UPDATE site
            SET deactivated_at = now()
          WHERE id = $1
            AND id = ANY($2::uuid[])
            AND deactivated_at IS NULL
          RETURNING id, code, name, deactivated_at`,
        [siteId, [...session.siteIds]],
      );

      if (updated.rows.length === 0) {
        const current = await client.query<SiteRow>(
          `SELECT id, code, name, deactivated_at
             FROM site
            WHERE id = $1
              AND id = ANY($2::uuid[])`,
          [siteId, [...session.siteIds]],
        );

        if (current.rows.length === 0) {
          throw new NotFoundException('Site not found in the current scope');
        }

        throw new BadRequestException('Site is already deactivated');
      }

      // RLS sigue siendo el límite de esta actualización: el site_id selecciona la
      // operación, pero la política decide qué filas físicas puede tocar la sesión.
      await client.query(
        `UPDATE location
            SET organization_location_id = NULL
          WHERE site_id = $1
            AND organization_location_id IS NOT NULL`,
        [siteId],
      );

      return toSite(updated.rows[0] as SiteRow);
    });
  }

  async reactivate(session: SessionScope, siteId: string): Promise<Site> {
    this.requireCoordinator(session);

    return this.db.withSessionClient(session, async (client) => {
      // Sin SELECT ... FOR UPDATE: el motor solo concede UPDATE por columna sobre
      // `site` (0023), y el bloqueo de fila exige el privilegio de tabla completo.
      // La propia reactivación es la que arbitra la carrera: solo una transacción
      // encuentra la fila todavía desactivada.
      const updated = await client.query<SiteRow>(
        `UPDATE site
            SET deactivated_at = NULL
          WHERE id = $1
            AND id = ANY($2::uuid[])
            AND deactivated_at IS NOT NULL
          RETURNING id, code, name, deactivated_at`,
        [siteId, [...session.siteIds]],
      );

      if (updated.rows.length === 0) {
        const current = await client.query<SiteRow>(
          `SELECT id, code, name, deactivated_at
             FROM site
            WHERE id = $1
              AND id = ANY($2::uuid[])`,
          [siteId, [...session.siteIds]],
        );

        if (current.rows.length === 0) {
          throw new NotFoundException('Site not found in the current scope');
        }

        throw new BadRequestException('Site is already active');
      }

      return toSite(updated.rows[0] as SiteRow);
    });
  }

  private requireCoordinator(session: SessionScope): void {
    if (!isAdministrator(session.role)) {
      throw new ForbiddenException('Only the coordinator can administer sites');
    }
  }
}

interface SiteRow extends Record<string, unknown> {
  id: string;
  code: string;
  name: string;
  deactivated_at: Date | null;
}

function toSite(row: SiteRow): Site {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    deactivated_at: row.deactivated_at?.toISOString() ?? null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string }).code === '23505';
}
