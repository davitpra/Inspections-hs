import { Injectable } from '@nestjs/common';
import type {
  CreateInspectionSchedule,
  CreateScheduledInspection,
  InspectionSchedule,
  InspectorOption,
  LocationPackage,
  PendingInspection,
  PeriodStatus,
  Role,
  RosterPackage,
  ScheduledInspection,
  TemplateVersionPackage,
  UpdateInspectionSchedule,
} from '@hs/contracts';
import type { TemplateDocument } from '@hs/forms';
import type { PoolClient } from 'pg';

import { DbService } from '../db/db.service';
import { forbidden } from '../auth/auth.errors';
import type { SessionScope } from '../db/site-scope';
import { findActiveInspection, type ActiveInspection } from './active-inspection';
import { SITE_TIME_ZONE } from '../jobs/job-registry';
import { LATEST_PUBLISHED_VERSION_CTE } from '../templates/published-version.sql';
import { ACCOUNT_IS_ACTIVE, isEligibleInspector, siteScopeIsActive } from './inspector-eligibility';
import { periodStatusCase } from './period-status.sql';
import { civilDate } from './period';
import {
  inspectionNotFound,
  inspectorInvalid,
  scheduleAlreadyActive,
  templateNotPublishable,
} from './inspections.errors';

/**
 * Requisitos §4 — La obligación de inspeccionar: quién la crea, quién la reasigna,
 * quién la cancela y qué ve cada inspector como pendiente.
 *
 * TRES REGLAS QUE ESTE SERVICIO **NO** APLICA, porque las aplica el motor y aplicarlas
 * dos veces es la forma de que una de las dos copias envejezca:
 *
 *   - El aislamiento por planta. No hay un solo `WHERE site_id IN (...)` acá: la
 *     política de `hs_apply_site_isolation` recorta, y una transacción sin alcance no
 *     ve nada. Es también lo que hace que un `site_id` del cuerpo fuera del alcance de
 *     la sesión no inserte nada, en vez de necesitar una comprobación.
 *   - El congelamiento de `template_version_id`. No hay método que la cambie porque el
 *     GRANT por columna y el trigger de guarda la rechazan; escribir la comprobación
 *     acá sugeriría que sin ella se podría.
 *   - La unicidad del período abierto. Es un único parcial, y el trabajo de apertura se
 *     apoya en él con `ON CONFLICT DO NOTHING`.
 *
 * Lo que sí aplica: el rol del actor y la validez del inspector. Ninguna de las dos la
 * puede expresar una FK — dependen de `user_site_scope`, que cambia con el tiempo.
 */
@Injectable()
export class InspectionsService {
  constructor(private readonly db: DbService) {}

  // -------------------------------------------------------------------------
  // Reglas de recurrencia

  async listSchedules(session: SessionScope): Promise<InspectionSchedule[]> {
    return this.db.withSessionClient(session, async (client) => {
      const { rows } = await client.query<ScheduleRow>(`${SCHEDULE_SELECT} ORDER BY t.name`);
      return rows.map(toSchedule);
    });
  }

  async createSchedule(
    session: SessionScope,
    input: CreateInspectionSchedule,
  ): Promise<InspectionSchedule> {
    this.requireCoordinator(session);

    return this.db.withSiteScopeClient(sessionScope(session), async (client) => {
      // Una regla sobre una plantilla sin versión publicada no tiene nada que abrir: el
      // trabajo la miraría todos los días y no produciría nada, en silencio.
      await this.requirePublishedTemplate(client, input.template_id);

      if (input.default_inspector_id) {
        await this.requireInspector(client, input.default_inspector_id, input.site_id);
      }

      // El único parcial de 0008 es quien rechaza la segunda regla activa; acá solo se
      // traduce. Comprobar antes del INSERT no serviría: dos altas concurrentes pasarían
      // las dos comprobaciones y chocarían igual contra el índice.
      const rows = await client
        .query<{ id: string }>(
          `INSERT INTO inspection_schedule (site_id, template_id, default_inspector_id, created_by)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [input.site_id, input.template_id, input.default_inspector_id ?? null, session.userId],
        )
        .then((result) => result.rows)
        .catch((caught: unknown) => {
          if (isUniqueViolation(caught)) {
            throw scheduleAlreadyActive(input.site_id, input.template_id);
          }
          throw caught;
        });

      return this.scheduleById(client, requireRow(rows).id);
    });
  }

  async updateSchedule(
    session: SessionScope,
    id: string,
    input: UpdateInspectionSchedule,
  ): Promise<InspectionSchedule> {
    this.requireCoordinator(session);

    return this.db.withSiteScopeClient(sessionScope(session), async (client) => {
      const current = await this.scheduleById(client, id);

      if (input.default_inspector_id) {
        await this.requireInspector(client, input.default_inspector_id, current.site_id);
      }

      // Reactivar (deactivated: false) vuelve a chocar contra el mismo parcial de 0008
      // si mientras tanto se creó otra regla activa para la misma plantilla y sitio.
      const { rowCount } = await client
        .query(
          `UPDATE inspection_schedule
              SET default_inspector_id = CASE WHEN $2::bool
                                              THEN $3::uuid ELSE default_inspector_id END,
                  deactivated_at = CASE WHEN $4::bool
                                        THEN CASE WHEN $5::bool THEN now() ELSE NULL END
                                        ELSE deactivated_at END
            WHERE id = $1`,
          [
            id,
            input.default_inspector_id !== undefined,
            input.default_inspector_id ?? null,
            input.deactivated !== undefined,
            input.deactivated ?? false,
          ],
        )
        .catch((caught: unknown) => {
          if (isUniqueViolation(caught)) {
            throw scheduleAlreadyActive(current.site_id, current.template_id);
          }
          throw caught;
        });

      if (rowCount === 0) throw inspectionNotFound();

      return this.scheduleById(client, id);
    });
  }

  /**
   * Las cuentas que pueden recibir una inspección en esa planta.
   *
   * MISMO PREDICADO QUE LA ASIGNACIÓN, importado de `inspector-eligibility.ts`. La
   * propiedad que sostiene: todo lo que esta lista ofrece, `assignInspector` lo acepta.
   * Si fueran dos consultas parecidas, la pantalla ofrecería cuentas que el servidor
   * rechaza con `inspector_invalid` — provocado por el coordinador haciendo lo único que
   * la pantalla le pide hacer.
   *
   * DOS COMPROBACIONES EXPLÍCITAS, y la segunda es la incómoda:
   *
   *   - `requireCoordinator`: es la única lectura del sistema que proyecta la tabla de
   *     cuentas, y existe solo para alimentar una operación que ya es del coordinador.
   *   - Que el sitio esté en el alcance de la sesión. **Acá el endpoint SÍ es la
   *     frontera**: a diferencia de todo lo demás en este servicio, `app_user` y
   *     `user_site_scope` no llevan `hs_apply_site_isolation`, así que no hay motor
   *     detrás y sin esta línea un coordinador de Glencoe podría enumerar el JHSC de
   *     St. Thomas. Se dice en voz alta en vez de dejar creer que RLS cubre algo.
   */
  async listInspectorCandidates(
    session: SessionScope,
    siteId: string,
  ): Promise<InspectorOption[]> {
    this.requireCoordinator(session);

    if (!session.siteIds.includes(siteId)) throw inspectionNotFound();

    return this.db.withSessionClient(session, async (client) => {
      const { rows } = await client.query<InspectorOption>(
        `SELECT u.id,
                p.employee_number,
                p.first_name,
                p.last_name
           FROM app_user u
           LEFT JOIN person p ON p.id = u.person_id
          WHERE ${isEligibleInspector('$1')}
          ORDER BY p.last_name NULLS LAST, p.first_name NULLS LAST, u.id`,
        [siteId],
      );

      return rows;
    });
  }

  // -------------------------------------------------------------------------
  // Inspecciones programadas

  async listScheduled(session: SessionScope): Promise<ScheduledInspection[]> {
    return this.db.withSessionClient(session, async (client) => {
      const { rows } = await client.query<ScheduledRow>(
        `${SCHEDULED_SELECT} ORDER BY si.period_start DESC, t.name`,
      );

      return rows.map(toScheduled);
    });
  }

  /**
   * Programa fuera del calendario. La versión NO viene del cliente: se resuelve como la
   * más alta publicada en este instante, y a partir de acá queda congelada.
   */
  async schedule(
    session: SessionScope,
    input: CreateScheduledInspection,
  ): Promise<ScheduledInspection> {
    this.requireCoordinator(session);

    return this.db.withSiteScopeClient(sessionScope(session), async (client) => {
      const versionId = await this.requirePublishedTemplate(client, input.template_id);

      if (input.inspector_id) {
        await this.requireInspector(client, input.inspector_id, input.site_id);
      }

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO scheduled_inspection
           (site_id, period_start, template_id, template_version_id, inspector_id, scheduled_by)
         VALUES ($1, $2::date, $3, $4, $5, $6)
         RETURNING id`,
        [
          input.site_id,
          input.period_start,
          input.template_id,
          versionId,
          input.inspector_id ?? null,
          session.userId,
        ],
      );

      return this.scheduledById(client, requireRow(rows).id);
    });
  }

  async assignInspector(
    session: SessionScope,
    id: string,
    inspectorId: string,
  ): Promise<ScheduledInspection> {
    this.requireCoordinator(session);

    return this.db.withSiteScopeClient(sessionScope(session), async (client) => {
      const current = await this.scheduledById(client, id);

      await this.requireInspector(client, inspectorId, current.site_id);

      // El trigger de auditoría escribe `inspection.reassigned` con el anterior y el
      // nuevo. No se escribe desde acá: una segunda vía de reasignación —un script de
      // corrección, por ejemplo— produciría el mismo registro sin acordarse de nada.
      await client.query('UPDATE scheduled_inspection SET inspector_id = $2 WHERE id = $1', [
        id,
        inspectorId,
      ]);

      return this.scheduledById(client, id);
    });
  }

  async cancel(session: SessionScope, id: string, reason: string): Promise<ScheduledInspection> {
    this.requireCoordinator(session);

    return this.db.withSiteScopeClient(sessionScope(session), async (client) => {
      await this.scheduledById(client, id);

      // Los dos campos juntos: el CHECK del motor exige que sean ambos o ninguno, y
      // que no se pueda deshacer lo garantiza el trigger de guarda.
      await client.query(
        `UPDATE scheduled_inspection
            SET cancelled_at = now(), cancellation_reason = $2
          WHERE id = $1 AND cancelled_at IS NULL`,
        [id, reason],
      );

      return this.scheduledById(client, id);
    });
  }

  /**
   * Lo que el solicitante todavía debe.
   *
   * Sin `WHERE site_id`: recorta la política. Lo único que agrega el endpoint es "es
   * mío" y "no está cancelada", que no son alcance sino filtro de la pantalla.
   */
  async pendingFor(session: SessionScope): Promise<PendingInspection[]> {
    const today = civilDate(new Date(), SITE_TIME_ZONE);

    return this.db.withSessionClient(session, async (client) => {
      const { rows } = await client.query<PendingRow>(
        `SELECT si.id,
                si.site_id,
                si.period_start::text AS period_start,
                si.period_end::text AS period_end,
                t.name AS template_name,
                si.template_version_id,
                (si.period_end < $2::date) AS overdue
           FROM scheduled_inspection si
           JOIN template t ON t.id = si.template_id
          WHERE si.inspector_id = $1
            AND si.cancelled_at IS NULL
          ORDER BY si.period_end`,
        [session.userId, today],
      );

      return rows.map((row) => ({
        id: row.id,
        site_id: row.site_id,
        period_start: row.period_start,
        period_end: row.period_end,
        template_name: row.template_name,
        template_version_id: row.template_version_id,
        overdue: row.overdue,
      }));
    });
  }

  // -------------------------------------------------------------------------
  // El paquete de campo: lo que el dispositivo baja antes de perder señal.
  //
  // Las tres lecturas son SEPARADAS y no una sola respuesta, y eso es el requisito: un
  // dispositivo que obtiene dos de las tres tiene que poder nombrar cuál le falta. Con
  // una respuesta única el único fallo posible sería "todo o nada", y la pantalla de
  // preparación no podría decir "falta el roster".

  /**
   * El documento CONGELADO contra el que se va a capturar.
   *
   * Se une por el `template_version_id` de la inspección y NUNCA se resuelve "la más
   * alta publicada": publicar la v3 no mueve una inspección atada a la v2, y este
   * método es donde esa garantía se sostiene o se pierde. Es la misma razón por la que
   * `schedule()` resuelve la versión una sola vez, al programar.
   *
   * El documento sale de la columna `template_version.document` tal cual. No se
   * reconstruye desde `template_version_item`: esas filas las proyecta un trigger DESDE
   * el documento y existen para consultar la recurrencia de un ítem entre versiones. La
   * fuente de verdad para validar es la columna, y reconstruirla sería una segunda
   * representación del mismo documento que puede divergir.
   */
  async templateVersionPackage(
    session: SessionScope,
    id: string,
  ): Promise<TemplateVersionPackage> {
    return this.db.withSessionClient(session, async (client) => {
      const inspection = await this.requireActive(client, id);

      const { rows } = await client.query<{ version: number; document: TemplateDocument }>(
        `SELECT version, document
           FROM template_version
          WHERE id = $1`,
        [inspection.template_version_id],
      );

      // La FK garantiza que exista: si no está, la base está rota y el 404 es honesto.
      const row = rows[0];
      if (!row) throw inspectionNotFound();

      return {
        site_id: inspection.site_id,
        template_version_id: inspection.template_version_id,
        version: row.version,
        document: row.document,
        inspector_id: inspection.inspector_id,
      };
    });
  }

  /** El catálogo cerrado de ubicaciones ACTIVAS de la planta de la inspección. */
  async locationPackage(session: SessionScope, id: string): Promise<LocationPackage> {
    return this.db.withSessionClient(session, async (client) => {
      const inspection = await this.requireActive(client, id);

      const { rows } = await client.query<LocationPackage[number]>(
        // EL `site_id` DE ACÁ ES UN FILTRO DE SELECCIÓN, NO EL LÍMITE DE SEGURIDAD.
        //
        // Parece lo que ADR-002 prohíbe y no lo es. El límite lo pone la política RLS:
        // una cuenta sin alcance en la planta no ve la inspección, y sin la inspección
        // esta consulta no llega a correr. Lo que el `WHERE` elige es CUÁL de las plantas
        // del alcance corresponde — el coordinador ve las dos, y devolverle las
        // ubicaciones de St. Thomas para una inspección de Glencoe no sería una fuga,
        // sería un desplegable de la planta equivocada.
        //
        // La prueba que las separa: sin este `WHERE` hay un bug de producto (opciones de
        // más, todas dentro del alcance); sin la política habría uno de seguridad.
        `SELECT id, code, name
           FROM location
          WHERE site_id = $1
            AND deactivated_at IS NULL
          ORDER BY name`,
        [inspection.site_id],
      );

      return rows;
    });
  }

  /**
   * El subconjunto ACTIVO del roster de esa misma planta.
   *
   * Cuatro columnas y ni una más: §4 dice que el operador elige a una persona **sin
   * poder ver su perfil**. `employee_number` viaja porque el nombre no identifica —dos
   * personas activas pueden llamarse igual—, y nada más viaja porque nada más hace falta
   * para elegir.
   */
  async rosterPackage(session: SessionScope, id: string): Promise<RosterPackage> {
    return this.db.withSessionClient(session, async (client) => {
      const inspection = await this.requireActive(client, id);

      const { rows } = await client.query<RosterPackage[number]>(
        // Mismo criterio que en `locationPackage`: selección entre las plantas del
        // alcance, no el límite de seguridad. Ver el comentario largo de arriba.
        `SELECT id, employee_number, first_name, last_name
           FROM person
          WHERE site_id = $1
            AND deactivated_at IS NULL
          ORDER BY last_name, first_name`,
        [inspection.site_id],
      );

      return rows;
    });
  }

  /**
   * La inspección visible y no cancelada, o el mismo 404 para los tres casos.
   *
   * "No existe", "está cancelada" y "es de la otra planta" comparten respuesta a
   * propósito: distinguirlas convertiría estas rutas en un oráculo de qué se inspecciona
   * donde el solicitante no tiene alcance. La política RLS ya hace que las tres se vean
   * igual desde acá; el error solo evita volver a separarlas.
   */
  private async requireActive(client: PoolClient, id: string): Promise<ActiveInspection> {
    const inspection = await findActiveInspection(client, id);
    if (!inspection) throw inspectionNotFound();

    return inspection;
  }

  // -------------------------------------------------------------------------

  private requireCoordinator(session: { role: string }): void {
    if (session.role !== 'hs_coordinator') {
      throw forbidden('Only the HS coordinator can administer inspection scheduling');
    }
  }

  /**
   * La versión más alta publicada de una plantilla. Es lo que se congela al programar.
   *
   * La expresión sale de `LATEST_PUBLISHED_VERSION_CTE` y no está escrita acá, para que
   * lo que el listado de plantillas OFRECE y lo que este método CONGELA no puedan
   * discrepar.
   */
  private async requirePublishedTemplate(client: PoolClient, templateId: string): Promise<string> {
    const { rows } = await client.query<{ version_id: string }>(
      `WITH latest AS (${LATEST_PUBLISHED_VERSION_CTE})
       SELECT version_id FROM latest WHERE template_id = $1`,
      [templateId],
    );

    const row = rows[0];
    if (!row) throw templateNotPublishable(templateId);

    return row.version_id;
  }

  /**
   * Un inspector válido es `jhsc_member` con alcance VIGENTE en esa planta.
   *
   * Las condiciones salen de `inspector-eligibility.ts`, compartidas con el listado de
   * candidatos, para que no pueda ofrecerse una cuenta que después se rechace acá.
   *
   * PERO LA FORMA SE CONSERVA: se proyectan el rol y el alcance por separado en vez de
   * preguntar un booleano, porque los tres motivos de rechazo dan tres mensajes
   * distintos y son ellos los que hacen accionable el error. `inspection-period.int-spec`
   * los afirma. Un `WHERE isEligibleInspector(...)` devolvería cero filas y las tres
   * causas colapsarían en «no existe».
   *
   * **Sin join a `person`**, y no es un olvido: la persona de una cuenta puede estar en
   * otra planta que su alcance, `person` está aislada por sitio, y el join convertiría
   * «no tiene alcance en el sitio» en «no existe» — perdiendo justo el mensaje que la
   * spec exige.
   */
  private async requireInspector(
    client: PoolClient,
    inspectorId: string,
    siteId: string,
  ): Promise<void> {
    const { rows } = await client.query<{ role: Role; in_scope: boolean }>(
      `SELECT u.role,
              ${siteScopeIsActive('$2')} AS in_scope
         FROM app_user u
        WHERE u.id = $1 AND ${ACCOUNT_IS_ACTIVE}`,
      [inspectorId, siteId],
    );

    const row = rows[0];
    if (!row) throw inspectorInvalid('The account does not exist or is deactivated');

    if (row.role !== 'jhsc_member') {
      throw inspectorInvalid(`Role ${row.role} cannot be assigned an inspection`);
    }

    if (!row.in_scope) {
      throw inspectorInvalid(`The account has no active access to site ${siteId}`);
    }
  }

  private async scheduleById(client: PoolClient, id: string): Promise<InspectionSchedule> {
    const { rows } = await client.query<ScheduleRow>(`${SCHEDULE_SELECT} AND s.id = $1`, [id]);

    const row = rows[0];
    if (!row) throw inspectionNotFound();

    return toSchedule(row);
  }

  private async scheduledById(client: PoolClient, id: string): Promise<ScheduledInspection> {
    const { rows } = await client.query<ScheduledRow>(`${SCHEDULED_SELECT} AND si.id = $1`, [id]);

    const row = rows[0];
    if (!row) throw inspectionNotFound();

    return toScheduled(row);
  }
}

/**
 * El alcance de la sesión, para los métodos que escriben con el cliente crudo.
 *
 * `withSiteScopeClient` pide un `SiteScope` DECLARADO, que es la vía de los seeds y los
 * comandos. Se construye acá a partir de la sesión —nunca de un parámetro del request—
 * y el `userId` viaja para que `app.user_id` quede fijado y los triggers de auditoría
 * sepan quién actuó.
 */
function sessionScope(session: SessionScope): { siteIds: readonly string[]; userId: string } {
  return { siteIds: session.siteIds, userId: session.userId };
}

/**
 * El nombre del asignado, y por qué se resuelve acá y no en el cliente.
 *
 * Una asignación es un HECHO HISTÓRICO. Si la cuenta se desactivó o perdió el alcance,
 * correctamente ya no está entre los candidatos — así que un mapa armado en el cliente a
 * partir de esa lista imprimiría un UUID crudo justo en las filas que el coordinador más
 * necesita ver. El nombre del sitio sí se resuelve en el cliente: son dos filas fijas.
 *
 * `LEFT JOIN` EN LOS DOS SALTOS, y el segundo es el que importa: `person` lleva política
 * de aislamiento por sitio y su `site_id` es una columna propia y mutable, distinta del
 * alcance de la cuenta. Una cuenta asignada legítimamente puede tener su persona en la
 * otra planta —alguien que cubre las dos, alguien que se mudó—, y un `INNER JOIN` haría
 * desaparecer la fila entera de la lista. Se pierde el nombre, nunca la asignación.
 */
function INSPECTOR_NAME_JOIN(idColumn: string, userAlias: string, personAlias: string): string {
  return `LEFT JOIN app_user ${userAlias} ON ${userAlias}.id = ${idColumn}
    LEFT JOIN person ${personAlias} ON ${personAlias}.id = ${userAlias}.person_id`;
}

/** `NULL` cuando no hay asignado, y también cuando su persona no es visible. */
function INSPECTOR_NAME_EXPR(personAlias: string): string {
  return `NULLIF(TRIM(COALESCE(${personAlias}.first_name, '') || ' ' ||
                       COALESCE(${personAlias}.last_name, '')), '')`;
}

const SCHEDULE_SELECT = `
  SELECT s.id,
         s.site_id,
         s.template_id,
         t.name AS template_name,
         s.default_inspector_id,
         ${INSPECTOR_NAME_EXPR('dp')} AS default_inspector_name,
         s.created_at,
         s.deactivated_at
    FROM inspection_schedule s
    JOIN template t ON t.id = s.template_id
    ${INSPECTOR_NAME_JOIN('s.default_inspector_id', 'du', 'dp')}
   WHERE true`;

const SCHEDULED_SELECT = `
  SELECT si.id,
         si.site_id,
         si.period_start::text AS period_start,
         si.period_end::text AS period_end,
         si.template_id,
         t.name AS template_name,
         si.template_version_id,
         tv.version AS template_version,
         si.inspector_id,
         ${INSPECTOR_NAME_EXPR('ip')} AS inspector_name,
         si.scheduled_at,
         si.scheduled_by,
         si.cancelled_at,
         si.cancellation_reason,
         ${periodStatusCase({
           scheduled: 'si',
           inspection: 'insp',
           periodEnd: 'si.period_end',
         })} AS status
    FROM scheduled_inspection si
    JOIN template t ON t.id = si.template_id
    JOIN template_version tv ON tv.id = si.template_version_id
    ${INSPECTOR_NAME_JOIN('si.inspector_id', 'iu', 'ip')}
    LEFT JOIN inspection insp ON insp.scheduled_inspection_id = si.id
   WHERE true`;

interface ScheduleRow extends Record<string, unknown> {
  id: string;
  site_id: string;
  template_id: string;
  template_name: string;
  default_inspector_id: string | null;
  default_inspector_name: string | null;
  created_at: Date;
  deactivated_at: Date | null;
}

interface ScheduledRow extends Record<string, unknown> {
  id: string;
  site_id: string;
  period_start: string;
  period_end: string;
  template_id: string;
  template_name: string;
  template_version_id: string;
  template_version: number;
  inspector_id: string | null;
  inspector_name: string | null;
  scheduled_at: Date;
  scheduled_by: string | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  status: PeriodStatus;
}

interface PendingRow extends Record<string, unknown> {
  id: string;
  site_id: string;
  period_start: string;
  period_end: string;
  template_name: string;
  template_version_id: string;
  overdue: boolean;
}

function toSchedule(row: ScheduleRow): InspectionSchedule {
  return {
    id: row.id,
    site_id: row.site_id,
    template_id: row.template_id,
    template_name: row.template_name,
    default_inspector_id: row.default_inspector_id,
    default_inspector_name: row.default_inspector_name,
    created_at: row.created_at.toISOString(),
    deactivated_at: row.deactivated_at?.toISOString() ?? null,
  };
}

function toScheduled(row: ScheduledRow): ScheduledInspection {
  return {
    id: row.id,
    site_id: row.site_id,
    period_start: row.period_start,
    period_end: row.period_end,
    template_id: row.template_id,
    template_name: row.template_name,
    template_version_id: row.template_version_id,
    template_version: row.template_version,
    inspector_id: row.inspector_id,
    inspector_name: row.inspector_name,
    scheduled_at: row.scheduled_at.toISOString(),
    scheduled_by: row.scheduled_by,
    cancelled_at: row.cancelled_at?.toISOString() ?? null,
    cancellation_reason: row.cancellation_reason,
    status: row.status,
  };
}

/**
 * `23505` — violación de único. Se mira el `code` de `pg` y no el texto del mensaje, que
 * cambia con la versión del servidor y con el idioma del `lc_messages`.
 */
function isUniqueViolation(caught: unknown): boolean {
  return typeof caught === 'object' && caught !== null && 'code' in caught
    ? (caught as { code?: unknown }).code === '23505'
    : false;
}

function requireRow<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (!row) throw new Error('La sentencia no devolvió ninguna fila.');
  return row;
}
