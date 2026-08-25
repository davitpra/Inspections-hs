import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  draftFromDocument,
  draftIssues,
  emptyDraftDocument,
  normalizeDraft,
  templateDocumentSchema,
  type CreateTemplateDraft,
  type PublishedTemplate,
  type PublishedTemplateSummary,
  type PublishedTemplateVersion,
  type SaveTemplateDraft,
  type TemplateDraft,
  type TemplateDraftSummary,
  type TemplateOption,
} from '@hs/contracts';

import { DbService } from '../db/db.service';
import type { SessionScope } from '../db/site-scope';
import { LATEST_PUBLISHED_VERSION_CTE } from './published-version.sql';
import { templateKeyFromName } from './template-key';
import {
  templateDraftForbidden,
  templateDraftNameLocked,
  templateDraftNotPublishable,
  templateDraftNameTaken,
  templateDraftNameUnusable,
  templateDraftNotFound,
  templateDraftSiteDeactivated,
  templateDraftSiteOutOfScope,
  templateItemDeactivated,
  templateItemKeyTaken,
  templateKeyTaken,
  templateAlreadyDeactivated,
  templateAlreadyArchived,
  templateArchived,
  templateNotDeactivated,
  templateNotDeactivatedForArchive,
  templateNotArchived,
  templateNotFound,
  templateVersionNotFound,
} from './templates.errors';
import {
  activeSiteIds,
  discardDraft,
  findDraft,
  findDrafts,
  findLiveRevisionDraft,
  findRegisteredItems,
  findTemplateForRevision,
  insertDraft,
  insertTemplate,
  insertVersion,
  isDraftUniqueViolation,
  isTemplateItemKeyUniqueViolation,
  isTemplateKeyUniqueViolation,
  isNameTaken,
  isNameTakenByAnother,
  markDraftPublished,
  registerItems,
  updateDraft,
  type TemplateDraftRecord,
} from './templates.repository';

/**
 * Las plantillas: el catálogo de las publicadas y la autoría de las que todavía no lo son.
 *
 * Las dos mitades no se tocan. `list` responde por `template` + `template_version`; los
 * borradores viven en `template_draft` y no escriben una fila allá hasta que alguien
 * publique. Un borrador nunca aparece
 * en `list`, y eso no es un filtro: es que no hay de dónde sacarlo.
 *
 * Lo que sigue describe `list`.
 *
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
                 t.key,
                 t.name,
                 latest.version    AS latest_version,
                 latest.version_id AS latest_version_id,
                 latest.published_at AS latest_published_at
           FROM template t
           JOIN latest ON latest.template_id = t.id
          WHERE t.deactivated_at IS NULL
          ORDER BY t.name`,
      );

      return rows;
    });
  }

  /**
   * El MISMO catálogo, para administrarlo en vez de para elegir de él.
   *
   * La única diferencia con `list()` es el `WHERE` que no está, y es toda la diferencia:
   * acá vienen también las retiradas. Si no vinieran, retirar una plantilla la borraría de
   * la pantalla que la retiró y no habría forma de volver a activarla nunca.
   *
   * `list()` no se toca ni se le agrega un parámetro: lo consumen cinco puntos de
   * `/scheduling` y lo que ofrece tiene que seguir siendo lo programable. Dos consumidores
   * con dos preguntas distintas son dos consultas, no una con una bandera.
   *
   * El `JOIN latest` sí se conserva: una plantilla sin ninguna versión publicada no es una
   * plantilla publicada, esté activa o no.
   */
  async listPublished(session: SessionScope): Promise<PublishedTemplateSummary[]> {
    requireCoordinator(session);

    return this.db.withSessionClient(session, async (client) => {
      const { rows } = await client.query<PublishedTemplateSummary>(
        `WITH latest AS (${LATEST_PUBLISHED_VERSION_CTE})
          SELECT t.id,
                 t.key,
                 t.name,
                 latest.version    AS latest_version,
                  latest.version_id AS latest_version_id,
                  latest.published_at AS latest_published_at,
                  t.deactivated_at,
                  t.archived_at
           FROM template t
           JOIN latest ON latest.template_id = t.id
          ORDER BY t.name`,
      );

      return rows;
    });
  }

  /**
   * Retirar una plantilla del catálogo. Nunca DELETE: `deactivated_at` (ADR-002).
   *
   * QUÉ SIGNIFICA Y QUÉ NO. Deja de ofrecerse al crear una regla de recurrencia y al
   * programar fuera de calendario, porque `list()` filtra por esta columna. NO frena las
   * reglas que ya la nombran ni toca una sola inspección abierta: el planificador congela
   * la versión más alta publicada y no vuelve a mirar la cabecera. Para frenar una regla
   * está la baja de la regla.
   *
   * SIN `SELECT ... FOR UPDATE`, por la misma razón que la baja de una planta
   * (`sites.service.ts`): el motor concede UPDATE sobre `template` POR COLUMNA (0033) y
   * bloquear la fila exige el privilegio de tabla entero. La propia baja arbitra la
   * carrera — la segunda pestaña no encuentra fila y se entera de que llegó tarde.
   */
  async deactivate(session: SessionScope, templateId: string): Promise<void> {
    requireCoordinator(session);

    await this.db.withSessionClient(session, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE template
            SET deactivated_at = now()
          WHERE id = $1 AND deactivated_at IS NULL
          RETURNING id`,
        [templateId],
      );

      if (rowCount === 0) {
        throw (await templateExists(client, templateId))
          ? templateAlreadyDeactivated()
          : templateNotFound();
      }
    });
  }

  /** El simétrico exacto. Vuelve a ofrecerse desde el próximo listado, sin más efecto. */
  async reactivate(session: SessionScope, templateId: string): Promise<void> {
    requireCoordinator(session);

    await this.db.withSessionClient(session, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE template
           SET deactivated_at = NULL
          WHERE id = $1 AND deactivated_at IS NOT NULL AND archived_at IS NULL
          RETURNING id`,
        [templateId],
      );

      if (rowCount === 0) {
        const state = await templateState(client, templateId);

        if (!state) throw templateNotFound();
        if (state.archived_at !== null) throw templateArchived();

        throw templateNotDeactivated();
      }
    });
  }

  /** Archivar solo cambia la visibilidad de una plantilla ya retirada. */
  async archive(session: SessionScope, templateId: string): Promise<void> {
    requireCoordinator(session);

    await this.db.withSessionClient(session, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE template
            SET archived_at = now()
          WHERE id = $1
            AND deactivated_at IS NOT NULL
            AND archived_at IS NULL
          RETURNING id`,
        [templateId],
      );

      if (rowCount === 0) {
        const state = await templateState(client, templateId);

        if (!state) throw templateNotFound();
        if (state.archived_at !== null) throw templateAlreadyArchived();

        throw templateNotDeactivatedForArchive();
      }
    });
  }

  /** Restaurar devuelve la fila a la tabla, pero no la vuelve programable. */
  async restore(session: SessionScope, templateId: string): Promise<void> {
    requireCoordinator(session);

    await this.db.withSessionClient(session, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE template
            SET archived_at = NULL
          WHERE id = $1 AND archived_at IS NOT NULL
          RETURNING id`,
        [templateId],
      );

      if (rowCount === 0) {
        throw (await templateExists(client, templateId))
          ? templateNotArchived()
          : templateNotFound();
      }
    });
  }

  /**
   * Lee la versión por su propio id y nunca resuelve "la más alta publicada", para que un
   * enlace guardado siga mostrando el mismo documento. Vive acá y no en `templates.repository.ts`
   * porque ese archivo está deliberadamente limitado a la autoría del borrador y sus SELECT
   * de unicidad.
   */
  async getPublishedVersion(
    session: SessionScope,
    versionId: string,
  ): Promise<PublishedTemplateVersion> {
    return this.db.withSessionClient(session, async (client) => {
      const { rows } = await client.query<PublishedTemplateVersion>(
        `SELECT tv.template_id,
                tv.id AS template_version_id,
                t.key,
                t.name,
                tv.version,
                tv.published_at::text AS published_at,
                tv.document
           FROM template_version tv
           JOIN template t ON t.id = tv.template_id
          WHERE tv.id = $1`,
        [versionId],
      );

      const row = rows[0];
      if (!row) throw templateVersionNotFound();

      return row;
    });
  }

  // -------------------------------------------------------------------------
  // Los borradores (etapa 8, primera mitad).
  //
  // Los métodos de autoría mantienen separado el borrador del modelo publicado. Publicar es
  // la única excepción y escribe las cuatro consecuencias dentro de una transacción.
  //
  // Los cinco abren igual, con la comprobación de rol: `template_draft` no lleva
  // `site_id` y por lo tanto no tiene política RLS que la respalde (0016 §5), así
  // que acá el `if` no es comodidad como en otros módulos — es lo único que hay.
  // Todos pasan por `withSessionClient`, que es el camino HTTP; `withSiteScope`
  // fabricaría un alcance que el request no trae.

  async listDrafts(session: SessionScope): Promise<TemplateDraftSummary[]> {
    requireCoordinator(session);

    return this.db.withSessionClient(session, async (client) => {
      const drafts = await findDrafts(client);

      return drafts.map(toSummary);
    });
  }

  /**
   * Crear un borrador es elegir cómo se va a llamar, y nada más.
   *
   * **La `key` la deriva el servidor**, no la manda el cliente: es un identificador
   * técnico y pedírselo al coordinador es pedirle una decisión que no tiene forma
   * de tomar bien. Un nombre del que no sale ninguna clave —`"???"`— se rechaza
   * nombrando el nombre, que es lo único que él puede cambiar.
   *
   * **La colisión se reporta sobre el NOMBRE aunque el índice que salte sea el de
   * la clave.** Desde que la clave no se escribe, hablarle al autor de ella sería
   * hablarle de un campo que su pantalla no tiene.
   *
   * Se chequea antes de insertar por cortesía y se vuelve a chequear solo en el
   * motor: los índices parciales de 0016 §2 y 0017 §1 cubren la carrera contra otro
   * borrador, y por eso el INSERT también traduce su `23505`. Lo que ninguno cubre
   * es que una plantilla publicada reclame la clave después — la refutación
   * autoritativa vive en el `UNIQUE` de `template.key`, al publicar.
   */
  async createDraft(session: SessionScope, input: CreateTemplateDraft): Promise<TemplateDraft> {
    requireCoordinator(session);

    const name = input.name.trim();
    const key = templateKeyFromName(name);

    if (key === null) throw templateDraftNameUnusable();

    return this.db.withSessionClient(session, async (client) => {
      const siteIds = await activeSiteIds(client, session.siteIds);

      if (await isNameTaken(client, name, key)) {
        // Si el nombre solo no choca, chocó la clave derivada: dos nombres distintos
        // que producen la misma. El mensaje lo dice, porque son cosas distintas de
        // buscar en el listado.
        throw templateDraftNameTaken(name, !(await isNameTakenByAnother(client, name)));
      }

      try {
        const created = await insertDraft(client, {
          key,
          name,
          document: emptyDraftDocument(),
          createdBy: session.userId,
          // TODO EL ALCANCE ACTIVO DE LA CUENTA, y el autor lo achica después si quiere.
          // Una planta dada de baja ya no se puede inspeccionar, y pedir la decisión más
          // difícil —«¿esto vale para las dos plantas?»— antes de escribir una pregunta
          // sigue siendo la pregunta equivocada.
          siteIds,
        });

        return toDraft(created);
      } catch (caught) {
        if (isDraftUniqueViolation(caught)) throw templateDraftNameTaken(name);

        throw caught;
      }
    });
  }

  /**
   * Revisar una plantilla publicada: un borrador sembrado con la última versión.
   *
   * **La versión N+1 se escribe editando la N.** Empezar de cero sería empezar con `item_key`
   * nuevos, y ahí la serie de recurrencia se parte: «la misma guarda falta otra vez» dejaría de
   * ser una pregunta que se puede hacer, que es lo único que el modelo de identidad dual existe
   * para garantizar. Por eso se siembra, y por eso el editor no deja tocar la clave de un ítem.
   *
   * **La clave y el nombre se HEREDAN, no se derivan.** `templateKeyFromName` podría dar otra
   * —el nombre pudo cambiar de estilo, o la clave pudo venir de un seed escrito a mano— y la
   * clave de la plantilla ya existe: derivarla de nuevo sería inventar una segunda respuesta.
   *
   * **Es idempotente.** Si ya hay una revisión viva, se devuelve esa. Hay a lo sumo una y lo
   * garantiza `template_draft_revision_live_idx` (0028 §2); un `409` obligaría a la pantalla a
   * buscar en el listado cuál era, cuando lo que el coordinador quiere es llegar a su trabajo
   * en curso.
   *
   * El alcance inicial es el de la sesión, igual que al crear: la plantilla publicada no lleva
   * ninguno (`### Requirement: The plants a draft named do not travel to the published
   * template`), así que no hay nada que heredar.
   */
  async reviseTemplate(session: SessionScope, templateId: string): Promise<TemplateDraft> {
    requireCoordinator(session);

    return this.db.withSessionClient(session, async (client) => {
      const template = await findTemplateForRevision(client, templateId);

      if (!template) throw templateNotFound();

      // Existe y no publicó nada: no hay versión de la cual salir. Es un caso que solo puede
      // dejar un seed a medio cargar, y `list` ya la deja afuera por el mismo motivo.
      if (!template.document || template.version_id === null) throw templateVersionNotFound();

      const live = await findLiveRevisionDraft(client, templateId);

      if (live) return toDraft(live);

      const siteIds = await activeSiteIds(client, session.siteIds);

      const created = await insertDraft(client, {
        key: template.key,
        name: template.name,
        document: draftFromDocument(template.document),
        createdBy: session.userId,
        siteIds,
        templateId: template.id,
      });

      return toDraft(created);
    });
  }

  async getDraft(session: SessionScope, id: string): Promise<TemplateDraft> {
    requireCoordinator(session);

    return this.db.withSessionClient(session, async (client) => {
      const draft = await findDraft(client, id);

      if (!draft) throw templateDraftNotFound();

      return toDraft(draft);
    });
  }

  /**
   * Publica la próxima versión que describe el borrador y lo consume en la misma transacción.
   *
   * DOS RAMAS Y UNA SOLA DIFERENCIA: un borrador que no nombra plantilla la crea primero; uno
   * de revisión no escribe nada en `template`. Todo lo demás —las reglas de publicabilidad, el
   * documento normalizado, el registro de los `item_key` nuevos, la versión, el consumo del
   * borrador— es exactamente lo mismo, y por eso es un `if` de tres líneas y no dos métodos.
   *
   * EL NÚMERO DE VERSIÓN NO SE DECIDE ACÁ. `insertVersion` propone `max + 1` y
   * `hs_template_version_next()` lo recalcula bajo su advisory lock. Una plantilla recién
   * insertada tiene máximo cero, así que la primera versión sale 1 sin ninguna rama.
   *
   * `draftIssues` y `templateDocumentSchema` son las mismas reglas que usa el builder y el motor.
   */
  async publishDraft(session: SessionScope, id: string): Promise<PublishedTemplate> {
    requireCoordinator(session);

    return this.db.withSessionClient(session, async (client) => {
      const draft = await findDraft(client, id);

      if (!draft) throw templateDraftNotFound();

      const issues = draftIssues(draft.document);

      if (issues.length > 0) throw templateDraftNotPublishable(issues);

      const document = templateDocumentSchema.parse(normalizeDraft(draft.document));
      const itemKeys = document.sections.flatMap((section) =>
        section.items.map((item) => item.item_key),
      );

      const templateId = draft.template_id ?? (await createTemplate(client, draft)).id;

      await registerNewItems(client, templateId, itemKeys);

      const version = await insertVersion(client, {
        templateId,
        document,
        publishedBy: session.userId,
      });

      if (!(await markDraftPublished(client, id, version.id))) {
        throw templateDraftNotFound();
      }

      return {
        template_id: templateId,
        template_version_id: version.id,
        version: version.version,
      };
    });
  }

  /**
   * Guardar.
   *
   * El documento NO se rechaza por estar incompleto: una sección sin ítems o un
   * texto vacío son el estado normal de algo que se está escribiendo, y `issues`
   * los reporta en la respuesta en lugar de impedir el guardado. Lo único que se
   * rechazó antes de llegar acá es lo imposible —un `response_type` inventado, un
   * campo que le sobra al tipo—, y lo rechazó `saveTemplateDraftSchema` en el
   * controller.
   *
   * Cero filas afectadas solo significa que el borrador no existe o fue descartado.
   */
  async saveDraft(
    session: SessionScope,
    id: string,
    input: SaveTemplateDraft,
  ): Promise<TemplateDraft> {
    requireCoordinator(session);
    requireSitesInScope(session, input.site_ids);

    const name = input.name.trim();

    return this.db.withSessionClient(session, async (client) => {
      const activeIds = new Set(await activeSiteIds(client, input.site_ids));

      if (input.site_ids.some((siteId) => !activeIds.has(siteId))) {
        throw templateDraftSiteDeactivated();
      }

      // Primero se comprueba que el borrador siga vivo. Así un borrador publicado o descartado
      // siempre devuelve `template_draft_not_found`, sin que una colisión de nombre oculte su
      // estado terminal.
      const live = await findDraft(client, id);

      if (!live) throw templateDraftNotFound();

      if (live.template_id !== null) {
        // UNA REVISIÓN NO RENOMBRA. `template.name` no lo puede actualizar nadie —`hs_app` no
        // tiene UPDATE sobre `template` desde 0003 §9—, así que un nombre distinto se guardaría
        // en el borrador, se mostraría en el builder y la publicación lo ignoraría: dos
        // respuestas a la misma pregunta. El editor lo muestra de solo lectura; llegar acá con
        // otro nombre es un cliente desincronizado.
        if (name !== live.name) throw templateDraftNameLocked();
      } else if (await isNameTakenByAnother(client, name, id)) {
        // Renombrar tiene que respetar la misma unicidad que crear: el nombre es la
        // identidad de un borrador (0017), y dos renglones iguales en el listado no se
        // distinguen por nada que el autor vea. La `key` no se revisa porque no se
        // mueve — no está en el GRANT UPDATE de 0016 §4.
        throw templateDraftNameTaken(name);
      }

      const saved = await updateDraft(client, {
        id,
        name,
        document: input.document,
        siteIds: input.site_ids,
      }).catch((caught: unknown) => {
        if (isDraftUniqueViolation(caught)) throw templateDraftNameTaken(name);

        throw caught;
      });

      if (saved) return toDraft(saved);

      throw templateDraftNotFound();
    });
  }

  /** Descartar es `discarded_at`. La fila queda, y con ella se libera la `key`. */
  async discardDraft(session: SessionScope, id: string): Promise<void> {
    requireCoordinator(session);

    await this.db.withSessionClient(session, async (client) => {
      if (!(await discardDraft(client, id))) {
        throw templateDraftNotFound();
      }
    });
  }
}

function requireCoordinator(session: SessionScope): void {
  if (session.role !== 'hs_coordinator') throw templateDraftForbidden();
}

/**
 * Solo para DISTINGUIR el error después de que la baja no encontró fila.
 *
 * No es una comprobación previa —eso sería el `SELECT` que la carrera vuelve mentira—:
 * corre cuando la escritura ya falló, y lo único que decide es cuál de los dos `4xx`
 * describe lo que pasó.
 */
async function templateExists(client: PoolClient, templateId: string): Promise<boolean> {
  const { rowCount } = await client.query('SELECT 1 FROM template WHERE id = $1', [templateId]);

  return rowCount === 1;
}

async function templateState(
  client: PoolClient,
  templateId: string,
): Promise<{ deactivated_at: Date | null; archived_at: Date | null } | null> {
  const { rows } = await client.query<{
    deactivated_at: Date | null;
    archived_at: Date | null;
  }>('SELECT deactivated_at, archived_at FROM template WHERE id = $1', [templateId]);

  return rows[0] ?? null;
}

/**
 * El alcance declarado tiene que estar dentro del de la sesión.
 *
 * **Esto es lo único que hay**, y conviene que quede dicho: el motor no puede sostenerlo
 * porque PostgreSQL no admite FK sobre el elemento de un arreglo (0020 §1). Que estos uuid
 * sean sitios, y sitios que esta cuenta administra, se decide acá.
 *
 * `session.siteIds` sale de `user_site_scope` en cada request y nunca del token
 * (`db.service.ts`), así que un id inventado no pasa por más que el cliente insista.
 *
 * Que el arreglo no esté vacío ya lo garantizan dos capas: `saveTemplateDraftSchema` con
 * su `.min(1)` y el CHECK de 0020 §3. No se repite acá.
 */
function requireSitesInScope(session: SessionScope, siteIds: readonly string[]): void {
  const allowed = new Set(session.siteIds);

  if (siteIds.some((siteId) => !allowed.has(siteId))) throw templateDraftSiteOutOfScope();
}

/**
 * `publishable` e `issues` los calcula `draftIssues` de `@hs/forms` (ADR-007): la
 * misma función que corre en el dispositivo mientras el autor escribe. Que sean
 * dos implementaciones es exactamente cómo la pantalla termina diciendo que un
 * borrador está listo y el servidor diciendo que no.
 */
function toSummary(row: TemplateDraftRecord): TemplateDraftSummary {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    updated_at: row.updated_at.toISOString(),
    publishable: draftIssues(row.document).length === 0,
    site_ids: row.site_ids,
    template_id: row.template_id,
    next_version: row.next_version,
  };
}

/**
 * La plantilla que va a llevar la primera versión.
 *
 * Solo corre para un borrador que no nombra ninguna. La refutación autoritativa de la clave es
 * este `UNIQUE`: la comprobación al nombrar el borrador es una cortesía, porque entre las dos
 * otra publicación pudo tomarla.
 */
async function createTemplate(
  client: PoolClient,
  draft: TemplateDraftRecord,
): Promise<{ id: string }> {
  try {
    return await insertTemplate(client, { key: draft.key, name: draft.name });
  } catch (caught) {
    if (isTemplateKeyUniqueViolation(caught)) throw templateKeyTaken();

    throw caught;
  }
}

/**
 * Registra en `template_item` SOLO los conceptos que el documento estrena.
 *
 * Los que la revisión trae de la versión anterior ya tienen su fila y no se tocan: esa fila es
 * la identidad del concepto y su `created_at` dice cuándo la organización empezó a preguntar
 * eso. Reescribirla sería reescribir el origen de la serie.
 *
 * Antes de escribir, lo ya registrado se parte en dos rechazos:
 *
 *   - DE OTRA PLANTILLA — `item_key` es global y write-once. Aceptarlo fundiría las series de
 *     recurrencia de dos plantillas, y eso no se deshace.
 *   - DESACTIVADO — `deactivated_at` dice «esta pregunta no se vuelve a hacer»; una versión
 *     nueva que la declare la estaría haciendo.
 *
 * El `23505` se sigue traduciendo igual: entre la lectura y el INSERT otra publicación puede
 * registrar la misma clave, y la garantía es la PK, no esta lectura.
 */
async function registerNewItems(
  client: PoolClient,
  templateId: string,
  itemKeys: readonly string[],
): Promise<void> {
  const registered = await findRegisteredItems(client, itemKeys);

  const deactivated = registered.filter((item) => item.deactivated).map((item) => item.item_key);

  if (deactivated.length > 0) throw templateItemDeactivated(deactivated);

  if (registered.some((item) => item.template_id !== templateId)) throw templateItemKeyTaken();

  const known = new Set(registered.map((item) => item.item_key));
  const fresh = itemKeys.filter((itemKey) => !known.has(itemKey));

  if (fresh.length === 0) return;

  try {
    await registerItems(client, templateId, fresh);
  } catch (caught) {
    if (isTemplateItemKeyUniqueViolation(caught)) throw templateItemKeyTaken();

    throw caught;
  }
}

function toDraft(row: TemplateDraftRecord): TemplateDraft {
  const issues = draftIssues(row.document);

  return {
    ...toSummary(row),
    document: row.document,
    issues,
    publishable: issues.length === 0,
  };
}
