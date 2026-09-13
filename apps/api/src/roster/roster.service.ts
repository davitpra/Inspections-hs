import { Injectable } from '@nestjs/common';
import {
  isAdministrator,
  type CreatePersonRequest,
  type Person,
  type PersonWithAccount,
  type RosterImportReport,
  type RosterQuery,
  type UpdatePersonRequest,
} from '@hs/contracts';

import { DbService } from '../db/db.service';
import type { SessionScope } from '../db/site-scope';
import { applyRosterRows } from './apply-roster';
import { parseRosterCsv, RosterFileError } from './parse-roster-csv';
import {
  personEmployeeNumberTaken,
  personHasActiveAccount,
  personNotActive,
  personNotFound,
  personSiteOutOfScope,
  rosterFileUnusable,
  rosterForbidden,
  rosterImportForbidden,
} from './roster.errors';
import { deactivatePerson, findRoster, insertPerson, updatePerson } from './roster.repository';

/**
 * La consola del roster: poder ver quién trabaja en cada planta sin abrir `psql`.
 *
 * Además de importar y dar de alta, permite la baja estrecha de una persona sin cuenta y
 * corregir los datos de una persona activa. No transfiere ni reactiva: eso sigue siendo del CSV.
 *
 * **El CSV gana (design D1).** Un alta a mano es un adelanto del archivo — "esta persona
 * ya empezó, el export es el lunes" — no una excepción a él: cuando el próximo CSV traiga
 * ese mismo `employee_number`, el importador lo trata como a cualquier otra fila y la
 * actualiza. `create` de acá abajo por eso solo INSERTA — nunca actualiza — y por eso el
 * número duplicado falla en vez de resolverse.
 *
   * Que el motor conceda `UPDATE (first_name, last_name, site_id, deactivated_at)` a
   * `hs_app` no es una invitación a usarlo sin control desde un endpoint de a una persona:
   * esos privilegios existen para la importación y la corrección de pantalla tiene su propio
   * contrato, validación y auditoría. El siguiente CSV sigue siendo la autoridad sobre esos
   * datos, según la política de importación vigente.
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
    this.requireCoordinator(session, rosterForbidden);

    return this.db.withSessionClient(session, (client) => findRoster(client, query));
  }

  /**
   * El alta de UNA persona (`add-person-to-roster-by-hand`).
   *
   * `session.siteIds.includes(input.site_id)` se comprueba ACÁ, a mano, y no es la misma
   * situación que `list` de arriba (design D4). Aquel LEE: RLS filtra y una planta fuera
   * del alcance devuelve una lista vacía, que es la respuesta correcta. Este ESCRIBE: si
   * se dejara pasar y RLS abortara el INSERT, el llamador vería un 500 — un error del
   * motor por un pedido mal dirigido, cuando la respuesta correcta es decir que el sitio
   * no está en su alcance. El mismo chequeo explícito que ya hace
   * `listInspectorCandidates`, por la misma razón.
   */
  async create(session: SessionScope, input: CreatePersonRequest): Promise<Person> {
    this.requireCoordinator(session, rosterForbidden);

    if (!session.siteIds.includes(input.site_id)) throw personSiteOutOfScope();

    const person = await this.db.withSessionClient(session, (client) =>
      insertPerson(client, input),
    );

    if (person === null) throw personEmployeeNumberTaken(input.employee_number);

    return person;
  }

  async deactivate(session: SessionScope, personId: string): Promise<Person> {
    this.requireCoordinator(session, rosterForbidden);

    const result = await this.db.withSessionClient(session, (client) =>
      deactivatePerson(client, personId),
    );

    if (result.status === 'not_found') throw personNotFound();
    if (result.status === 'has_active_account') throw personHasActiveAccount();
    if (result.status === 'not_active') throw personNotActive();

    return result.person;
  }

  async update(
    session: SessionScope,
    personId: string,
    request: UpdatePersonRequest,
  ): Promise<Person> {
    this.requireCoordinator(session, rosterForbidden);

    try {
      const result = await this.db.withSessionClient(session, (client) =>
        updatePerson(client, personId, request),
      );

      if (result.status === 'not_found') throw personNotFound();
      if (result.status === 'not_active') throw personNotActive();

      return result.person;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw personEmployeeNumberTaken(request.employee_number!);
      }

      throw error;
    }
  }

  async import(
    session: SessionScope,
    file: { text: string; sourceFilename: string },
  ): Promise<RosterImportReport> {
    this.requireCoordinator(session, rosterImportForbidden);

    let parsed;
    try {
      parsed = parseRosterCsv(file.text);
    } catch (error) {
      if (error instanceof RosterFileError) throw rosterFileUnusable(error.message);
      throw error;
    }

    return this.db.withSessionClient(session, (client) =>
      applyRosterRows(client, parsed, session, { sourceFilename: file.sourceFilename }),
    );
  }

  private requireCoordinator(
    session: SessionScope,
    failure: () => Error,
  ): void {
    if (!isAdministrator(session.role)) throw failure();
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string }).code === '23505';
}
