import { Injectable } from '@nestjs/common';
import {
  draftIssues,
  emptyDraftDocument,
  type CreateTemplateDraft,
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
  templateDraftNameTaken,
  templateDraftNameUnusable,
  templateDraftNotFound,
  templateDraftSiteOutOfScope,
  templateDraftStale,
} from './templates.errors';
import {
  discardDraft,
  findDraft,
  findDrafts,
  insertDraft,
  isDraftUniqueViolation,
  isNameTaken,
  isNameTakenByAnother,
  updateDraft,
  type TemplateDraftRecord,
} from './templates.repository';

/**
 * Las plantillas: el catálogo de las publicadas y la autoría de las que todavía no lo son.
 *
 * Las dos mitades no se tocan. `list` responde por `template` + `template_version`; los
 * borradores viven en `template_draft` y no escriben una fila allá hasta que alguien
 * publique, que es la segunda mitad de la etapa 8 y otro change. Un borrador nunca aparece
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

  // -------------------------------------------------------------------------
  // Los borradores (etapa 8, primera mitad).
  //
  // Ninguno de estos métodos escribe en `template`, `template_item` ni
  // `template_version`, y por eso ninguno necesita un permiso que la migración
  // 0003 haya revocado. Publicar es otro change.
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
          // TODO EL ALCANCE DE LA CUENTA, y el autor lo achica después si quiere.
          // Pedirlo al crear sería pedir la decisión más difícil —«¿esto vale para
          // las dos plantas?»— antes de haber escrito una sola pregunta.
          siteIds: session.siteIds,
        });

        return toDraft(created);
      } catch (caught) {
        if (isDraftUniqueViolation(caught)) throw templateDraftNameTaken(name);

        throw caught;
      }
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
   * Guardar.
   *
   * El documento NO se rechaza por estar incompleto: una sección sin ítems o un
   * texto vacío son el estado normal de algo que se está escribiendo, y `issues`
   * los reporta en la respuesta en lugar de impedir el guardado. Lo único que se
   * rechazó antes de llegar acá es lo imposible —un `response_type` inventado, un
   * campo que le sobra al tipo—, y lo rechazó `saveTemplateDraftSchema` en el
   * controller.
   *
   * Cero filas afectadas son dos cosas distintas y el autor merece saber cuál:
   * si el borrador sigue vivo, la revisión quedó vieja; si no está, lo descartaron
   * mientras editaba. Por eso la lectura de seguimiento.
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
      // Renombrar tiene que respetar la misma unicidad que crear: el nombre es la
      // identidad de un borrador (0017), y dos renglones iguales en el listado no se
      // distinguen por nada que el autor vea. La `key` no se revisa porque no se
      // mueve — no está en el GRANT UPDATE de 0016 §4.
      if (await isNameTakenByAnother(client, name, id)) {
        throw templateDraftNameTaken(name);
      }

      const saved = await updateDraft(client, {
        id,
        name,
        document: input.document,
        revision: input.revision,
        siteIds: input.site_ids,
      }).catch((caught: unknown) => {
        if (isDraftUniqueViolation(caught)) throw templateDraftNameTaken(name);

        throw caught;
      });

      if (saved) return toDraft(saved);

      const current = await findDraft(client, id);

      throw current ? templateDraftStale() : templateDraftNotFound();
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
    revision: row.revision,
    updated_at: row.updated_at.toISOString(),
    publishable: draftIssues(row.document).length === 0,
    site_ids: row.site_ids,
  };
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
