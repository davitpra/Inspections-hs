import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  isAdministrator,
  type CreateLocation,
  type CreateOrganizationLocation,
  type Location,
  type OrganizationLocation,
} from '@hs/contracts';

import { DbService } from '../db/db.service';
import type { SessionScope } from '../db/site-scope';

/**
 * El catálogo que el coordinador mantiene: leer, dar de alta y mapear.
 *
 * DOS POBLACIONES Y UN PUENTE. `organization_location` es el concepto —"el muelle de
 * carga"—, sin `site_id` y sin política, como `template`. `location` es la fila física de
 * una planta, con `site_id` y con RLS. El puente es `location.organization_location_id`, y
 * es lo que permite que una plantilla de toda la organización nombre un lugar y que la
 * inspección de cada planta lo resuelva contra el suyo.
 *
 * Una compartida sin mapear en una planta no es un error: es una plantilla cuya sección va
 * a resolver a nada en esa planta y un hallazgo que va a nacer sin ubicación. Por eso la
 * pantalla se ordena por compartida y no por física — lo que hay que poder ver es el hueco.
 */
@Injectable()
export class LocationsService {
  constructor(private readonly db: DbService) {}

  async listOrganizationLocations(session: SessionScope): Promise<OrganizationLocation[]> {
    this.requireCoordinator(session);

    return this.db.withSessionClient(session, async (client) => {
      const { rows } = await client.query<OrganizationLocationRow>(
        `SELECT id, code, name, deactivated_at
           FROM organization_location
          WHERE deactivated_at IS NULL
          ORDER BY name`,
      );

      return rows.map(toOrganizationLocation);
    });
  }

  async listLocations(session: SessionScope): Promise<Location[]> {
    this.requireCoordinator(session);

    return this.db.withSessionClient(session, async (client) => {
      const { rows } = await client.query<LocationRow>(
        `SELECT l.id, l.site_id, l.code, l.name, l.deactivated_at,
                ol.code AS organization_location_code
           FROM location l
           LEFT JOIN organization_location ol
             ON ol.id = l.organization_location_id AND ol.deactivated_at IS NULL
          WHERE l.deactivated_at IS NULL
          ORDER BY l.site_id, l.name`,
      );

      return rows.map(toLocation);
    });
  }

  async mapLocation(
    session: SessionScope,
    locationId: string,
    organizationLocationId: string | null,
  ): Promise<Location> {
    this.requireCoordinator(session);

    return this.db.withSessionClient(session, async (client) => {
      if (organizationLocationId !== null) {
        const target = await client.query<{ id: string }>(
          `SELECT id
             FROM organization_location
            WHERE id = $1 AND deactivated_at IS NULL`,
          [organizationLocationId],
        );

        if (!target.rows[0]) {
          throw new BadRequestException('The organization location is not active');
        }
      }

      try {
        const updated = await client.query(
          `UPDATE location
              SET organization_location_id = $2
            WHERE id = $1`,
          [locationId, organizationLocationId],
        );

        if (updated.rowCount === 0) throw new NotFoundException('Location not found');

        const { rows } = await client.query<LocationRow>(
          `SELECT l.id, l.site_id, l.code, l.name, l.deactivated_at,
                  ol.code AS organization_location_code
             FROM location l
             LEFT JOIN organization_location ol
               ON ol.id = l.organization_location_id AND ol.deactivated_at IS NULL
            WHERE l.id = $1`,
          [locationId],
        );

        const row = rows[0];
        if (!row) throw new NotFoundException('Location not found');

        return toLocation(row);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new BadRequestException(
            'This organization location is already mapped in this plant',
          );
        }

        throw error;
      }
    });
  }

  /**
   * Retira el concepto compartido y las físicas activas que lo representan.
   *
   * `organization_location` no tiene RLS, así que la baja vale para toda la organización;
   * `location` sí tiene RLS y esta segunda sentencia solo alcanza las plantas del alcance de
   * quien ejecuta. Un coordinador de una sola planta puede dejar una física activa en otra,
   * que entonces aparece correctamente como huérfana.
   */
  async deactivateOrganizationLocation(
    session: SessionScope,
    organizationLocationId: string,
  ): Promise<void> {
    this.requireCoordinator(session);

    await this.db.withSessionClient(session, async (client) => {
      const deactivated = await client.query(
        `UPDATE organization_location
            SET deactivated_at = now()
          WHERE id = $1 AND deactivated_at IS NULL`,
        [organizationLocationId],
      );

      if (deactivated.rowCount === 0) {
        throw new NotFoundException('Organization location not found');
      }

      await client.query(
        `UPDATE location
            SET deactivated_at = now()
          WHERE organization_location_id = $1 AND deactivated_at IS NULL`,
        [organizationLocationId],
      );
    });
  }

  /**
   * Alta de una ubicación compartida.
   *
   * Sin planta: es el concepto. Nace sin mapear en ninguna de las dos, así que crear una
   * deja dos huecos nuevos hasta que alguien los llene — y eso es correcto, es exactamente
   * lo que la pantalla tiene que mostrar.
   */
  async createOrganizationLocation(
    session: SessionScope,
    input: CreateOrganizationLocation,
  ): Promise<OrganizationLocation> {
    this.requireCoordinator(session);

    return this.db.withSessionClient(session, async (client) => {
      try {
        const { rows } = await client.query<OrganizationLocationRow>(
          `INSERT INTO organization_location (code, name)
                VALUES ($1, $2)
             RETURNING id, code, name, deactivated_at`,
          [input.code, input.name],
        );

        return toOrganizationLocation(rows[0] as OrganizationLocationRow);
      } catch (error) {
        // `code` es único en toda la organización, no por planta: es el identificador con
        // el que una plantilla la nombra, y dos filas con el mismo harían ambigua esa
        // referencia.
        if (isUniqueViolation(error)) {
          throw new BadRequestException(`The code "${input.code}" is already in use`);
        }

        throw error;
      }
    });
  }

  /**
   * Alta de una ubicación física en una planta.
   *
   * `siteId` viene de la RUTA y es una selección entre las plantas del alcance, no el
   * límite: el coordinador tiene las dos. El límite lo pone la política RLS sobre
   * `location` —un `INSERT` para una planta fuera del alcance lo rechaza el motor— y por
   * eso acá no hay ningún `if` comprobando el sitio. Es el mismo criterio que
   * `locationPackage` documenta para su `WHERE`.
   *
   * Nace SIN mapear. Mapearla es el otro método, y son dos actos distintos: registrar que
   * la planta tiene un lugar, y decir cuál de los conceptos comunes es.
   */
  async createLocation(
    session: SessionScope,
    siteId: string,
    input: CreateLocation,
  ): Promise<Location> {
    this.requireCoordinator(session);

    return this.db.withSessionClient(session, async (client) => {
      try {
        const { rows } = await client.query<LocationRow>(
          `INSERT INTO location (site_id, code, name)
                VALUES ($1, $2, $3)
             RETURNING id, site_id, code, name, deactivated_at,
                       NULL::text AS organization_location_code`,
          [siteId, input.code, input.name],
        );

        return toLocation(rows[0] as LocationRow);
      } catch (error) {
        // Dos únicos distintos, y el mensaje tiene que decir cuál: `location_site_code_uq`
        // sobre `(site_id, code)`, y el parcial `location_site_active_name_uq` sobre el
        // nombre de las ACTIVAS. Un "ya existe" a secas dejaría al coordinador cambiando
        // el campo equivocado.
        if (isUniqueViolation(error)) {
          throw new BadRequestException(
            constraintOf(error) === 'location_site_active_name_uq'
              ? `This plant already has an active location named "${input.name}"`
              : `This plant already has a location with the code "${input.code}"`,
          );
        }

        // EL AISLAMIENTO CONTESTA ANTES QUE LA FK, y eso es lo correcto: una planta fuera
        // del alcance la rechaza la política RLS sobre `location` —«new row violates
        // row-level security policy»— sin que este método tenga que comprobar nada. Es la
        // prueba de que el `siteId` de la ruta es una selección y no el límite.
        //
        // La FK queda como el caso restante: una planta que SÍ está en el alcance pero no
        // existe. No se llega desde la interfaz —el alcance sale de `user_site_scope`, que
        // referencia `site`— y por eso es defensa, no camino.
        if (isRowLevelSecurityViolation(error)) {
          throw new ForbiddenException('That plant is not one you can administer');
        }

        if (isForeignKeyViolation(error)) {
          throw new BadRequestException('That plant does not exist');
        }

        throw error;
      }
    });
  }

  private requireCoordinator(session: SessionScope): void {
    if (!isAdministrator(session.role)) {
      throw new ForbiddenException('Only the coordinator can administer locations');
    }
  }
}

interface OrganizationLocationRow {
  id: string;
  code: string;
  name: string;
  deactivated_at: Date | null;
}

interface LocationRow extends OrganizationLocationRow {
  site_id: string;
  organization_location_code: string | null;
}

function toOrganizationLocation(row: OrganizationLocationRow): OrganizationLocation {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    deactivated_at: row.deactivated_at?.toISOString() ?? null,
  };
}

function toLocation(row: LocationRow): Location {
  return {
    id: row.id,
    site_id: row.site_id,
    code: row.code,
    name: row.name,
    deactivated_at: row.deactivated_at?.toISOString() ?? null,
    organization_location_code: row.organization_location_code,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string }).code === '23505';
}

function isForeignKeyViolation(error: unknown): boolean {
  return (error as { code?: string }).code === '23503';
}

/**
 * `42501` lo usa Postgres para dos cosas: privilegio insuficiente y fila que viola una
 * política RLS. Acá solo puede ser la segunda —`hs_app` tiene `INSERT` sobre `location`—,
 * así que se distingue por el mensaje, que es lo único que las separa.
 */
function isRowLevelSecurityViolation(error: unknown): boolean {
  const cause = error as { code?: string; message?: string };

  return cause.code === '42501' && (cause.message ?? '').includes('row-level security');
}

/** Cuál restricción se violó, para poder decir qué campo cambiar. */
function constraintOf(error: unknown): string | undefined {
  return (error as { constraint?: string }).constraint;
}
