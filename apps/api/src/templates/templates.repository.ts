import type { PoolClient } from 'pg';
import type { TemplateDocument, TemplateDraftDocument } from '@hs/contracts';

/**
 * Los accesos a `template_draft`.
 *
 * Nada de esto toca `template`, `template_item` ni `template_version`, salvo el único
 * `SELECT` de `isNameTaken` / `isNameTakenByAnother`, que solo preguntan. Es la propiedad que hace que la autoría no
 * necesite ni un permiso sobre el modelo publicado (migración 0016, cabecera).
 *
 * Sin aislamiento por sitio y sin `WHERE site_id`: la tabla no tiene la columna. Lo que
 * protege estos accesos es el rol, y lo comprueba el servicio antes de llegar acá.
 */

export interface TemplateDraftRecord extends Record<string, unknown> {
  id: string;
  key: string;
  name: string;
  document: TemplateDraftDocument;
  updated_at: Date;
  site_ids: string[];
  /** La plantilla que este borrador corrige, o `null` si va a crear una (0028 §1). */
  template_id: string | null;
  /** `max + 1` de la plantilla, o `1` cuando no hay ninguna. Lectura, no reserva. */
  next_version: number;
}

const DRAFT_COLUMNS = 'id, key, name, document, updated_at, site_ids, template_id';

/**
 * El número que va a tener la versión que publique este borrador.
 *
 * `LEFT JOIN LATERAL` y no un subselect en la lista de columnas para que la lectura sea una
 * sola por fila y no una por columna el día que haga falta más de un campo de la plantilla.
 *
 * NO ES UNA RESERVA. Entre esta lectura y la publicación puede aparecer otra versión —solo
 * puede ponerla un seed, porque hay una sola revisión viva por plantilla—, y el número que
 * queda escrito lo decide `hs_template_version_next()` bajo su advisory lock.
 */
const NEXT_VERSION_LATERAL = `LEFT JOIN LATERAL (
         SELECT coalesce(max(tv.version), 0) + 1 AS next_version
           FROM template_version tv
          WHERE tv.template_id = d.template_id
       ) v ON true`;

const NEXT_VERSION_COLUMN = 'coalesce(v.next_version, 1)::int AS next_version';

/** Los borradores vivos, el más trabajado primero. */
export async function findDrafts(client: PoolClient): Promise<TemplateDraftRecord[]> {
  const { rows } = await client.query<TemplateDraftRecord>(
    `SELECT ${DRAFT_COLUMNS}, ${NEXT_VERSION_COLUMN}
       FROM template_draft d
       ${NEXT_VERSION_LATERAL}
      WHERE d.discarded_at IS NULL
        AND d.published_at IS NULL
      ORDER BY d.updated_at DESC`,
  );

  return rows;
}

export async function findDraft(
  client: PoolClient,
  id: string,
): Promise<TemplateDraftRecord | null> {
  const { rows } = await client.query<TemplateDraftRecord>(
    `SELECT ${DRAFT_COLUMNS}, ${NEXT_VERSION_COLUMN}
       FROM template_draft d
       ${NEXT_VERSION_LATERAL}
      WHERE d.id = $1 AND d.discarded_at IS NULL AND d.published_at IS NULL`,
    [id],
  );

  return rows[0] ?? null;
}

/**
 * Las plantas activas dentro de un conjunto declarado.
 *
 * Es la misma lectura que `roster/apply-roster.ts:116`. `site` no tiene política RLS
 * (0004), así que este `WHERE` es selección de plantas activas, no aislamiento por sitio.
 */
export async function activeSiteIds(
  client: PoolClient,
  siteIds: readonly string[],
): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(
    'SELECT id FROM site WHERE id = ANY($1::uuid[]) AND deactivated_at IS NULL',
    [[...siteIds]],
  );

  return rows.map((row) => row.id);
}

/**
 * ¿Está tomado este nombre, o la clave que se deriva de él?
 *
 * Mira las dos poblaciones: los borradores vivos y las plantillas publicadas, por nombre y
 * por clave. Los índices parciales de 0016 §2 y 0017 §1 cubren la primera por su cuenta; la
 * segunda no la puede cubrir ninguna restricción, porque son dos tablas.
 *
 * Esta consulta es una cortesía —que el autor se entere al elegir el nombre y no al terminar
 * la plantilla—, no una garantía: entre esta lectura y el INSERT el nombre puede quedar
 * tomado, y por eso el servicio traduce igual el `23505` que devuelvan los índices. La
 * refutación autoritativa contra lo publicado es el `UNIQUE` de `template.key` al publicar.
 *
 * `lower(btrim(...))` es la misma expresión del índice de 0017: comparar de otra forma haría
 * que esta comprobación dijera "libre" sobre un nombre que el índice después rechaza.
 *
 * LOS BORRADORES DE REVISIÓN NO CUENTAN (`template_id IS NULL`), igual que en los índices de
 * 0028 §3: llevan a propósito la clave y el nombre de su plantilla, y esa plantilla ya está
 * en la mitad de abajo de este `UNION`. Contarlos sería contar dos veces al mismo dueño, y el
 * mensaje hablaría de un borrador cuando lo que ocupa el nombre es la plantilla publicada.
 */
export async function isNameTaken(
  client: PoolClient,
  name: string,
  key: string,
): Promise<boolean> {
  const { rows } = await client.query<{ taken: boolean }>(
    `SELECT EXISTS (
              SELECT 1 FROM template_draft
                WHERE discarded_at IS NULL
                  AND published_at IS NULL
                  AND template_id IS NULL
                 AND (lower(btrim(name)) = lower(btrim($1)) OR key = $2)
              UNION ALL
              SELECT 1 FROM template
               WHERE lower(btrim(name)) = lower(btrim($1)) OR key = $2
            ) AS taken`,
    [name, key],
  );

  return rows[0]?.taken ?? false;
}

/**
 * Lo mismo pero SOLO por nombre, ignorando la clave. Dos usos:
 *
 *   - un RENOMBRE, que no mueve la clave (`id` excluye al propio borrador);
 *   - distinguir, al crear, si la colisión fue por el nombre o por dos nombres distintos
 *     que derivan a la misma clave. Cambia el mensaje: "ya existe una llamada así" sobre un
 *     nombre que se ve distinto deja al autor buscando una fila que no va a encontrar.
 */
export async function isNameTakenByAnother(
  client: PoolClient,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const { rows } = await client.query<{ taken: boolean }>(
    `SELECT EXISTS (
              SELECT 1 FROM template_draft
                WHERE discarded_at IS NULL
                  AND published_at IS NULL
                  AND template_id IS NULL
                 AND ($2::uuid IS NULL OR id <> $2::uuid)
                 AND lower(btrim(name)) = lower(btrim($1))
              UNION ALL
              SELECT 1 FROM template WHERE lower(btrim(name)) = lower(btrim($1))
            ) AS taken`,
    [name, exceptId ?? null],
  );

  return rows[0]?.taken ?? false;
}

/**
 * El `23505` de cualquiera de los dos índices parciales de `template_draft`.
 *
 * Se mira el `code` de `pg` y no el texto del mensaje, como en `inspections.service.ts` y
 * `findings.service.ts`. Existe porque las comprobaciones de arriba son una lectura previa y
 * el INSERT ocurre después: entre las dos, el nombre puede quedar tomado.
 */
export function isDraftUniqueViolation(caught: unknown): boolean {
  const candidate = caught as { code?: unknown; constraint?: unknown };

  return (
    candidate?.code === '23505' &&
    (candidate.constraint === 'template_draft_key_live_idx' ||
      candidate.constraint === 'template_draft_name_live_idx')
  );
}

export function isTemplateKeyUniqueViolation(caught: unknown): boolean {
  const candidate = caught as { code?: unknown; constraint?: unknown };

  return candidate?.code === '23505' && candidate.constraint === 'template_key_key';
}

export function isTemplateItemKeyUniqueViolation(caught: unknown): boolean {
  const candidate = caught as { code?: unknown; constraint?: unknown };

  return candidate?.code === '23505' && candidate.constraint === 'template_item_pkey';
}

/**
 * La plantilla que se va a revisar, con la última versión publicada que le sirve de origen.
 *
 * Se lee `template` y `template_version` en una sola consulta porque la revisión necesita las
 * dos cosas juntas —la identidad de la plantilla y el documento a copiar— y separarlas dejaría
 * un hueco entre las dos lecturas.
 *
 * Una plantilla dada de baja no aparece: no se puede programar, así que corregirla sería
 * escribir una versión que nadie va a poder usar.
 *
 * `DISTINCT ON` no hace falta: `ORDER BY version DESC LIMIT 1` sobre una sola plantilla usa el
 * mismo índice `template_version_current_idx` que `LATEST_PUBLISHED_VERSION_CTE`.
 */
export async function findTemplateForRevision(
  client: PoolClient,
  templateId: string,
): Promise<TemplateForRevision | null> {
  const { rows } = await client.query<TemplateForRevision>(
    `SELECT t.id,
            t.key,
            t.name,
            tv.id       AS version_id,
            tv.version,
            tv.document
       FROM template t
       LEFT JOIN LATERAL (
              SELECT id, version, document
                FROM template_version
               WHERE template_id = t.id
               ORDER BY version DESC
               LIMIT 1
            ) tv ON true
      WHERE t.id = $1 AND t.deactivated_at IS NULL`,
    [templateId],
  );

  return rows[0] ?? null;
}

export interface TemplateForRevision extends Record<string, unknown> {
  id: string;
  key: string;
  name: string;
  /** Nulos juntos: la plantilla existe y todavía no publicó nada. */
  version_id: string | null;
  version: number | null;
  document: TemplateDocument | null;
}

/**
 * El borrador de revisión vivo de una plantilla, si lo hay.
 *
 * Hay a lo sumo uno y lo garantiza `template_draft_revision_live_idx` (0028 §2). Esta lectura
 * existe para devolverlo en vez de crear un segundo: el coordinador que aprieta «Revise» sobre
 * una plantilla que ya está revisando quiere llegar a su trabajo en curso, no a un conflicto.
 */
export async function findLiveRevisionDraft(
  client: PoolClient,
  templateId: string,
): Promise<TemplateDraftRecord | null> {
  const { rows } = await client.query<TemplateDraftRecord>(
    `SELECT ${DRAFT_COLUMNS}, ${NEXT_VERSION_COLUMN}
       FROM template_draft d
       ${NEXT_VERSION_LATERAL}
      WHERE d.template_id = $1
        AND d.discarded_at IS NULL
        AND d.published_at IS NULL`,
    [templateId],
  );

  return rows[0] ?? null;
}

/**
 * Qué se sabe ya de cada `item_key` que el documento declara.
 *
 * Devuelve una fila por clave YA REGISTRADA; las que no vuelven son las nuevas. El servicio
 * decide con eso: registra las nuevas, deja como están las de esta plantilla, y rechaza las de
 * otra plantilla o las desactivadas.
 *
 * Un `INSERT ... ON CONFLICT DO NOTHING` habría sido más corto y habría aceptado en silencio
 * un `item_key` de otra plantilla — el error más caro que hay acá, porque fundiría las
 * historias de dos preguntas distintas y no se puede deshacer.
 */
export async function findRegisteredItems(
  client: PoolClient,
  itemKeys: readonly string[],
): Promise<RegisteredItem[]> {
  const { rows } = await client.query<RegisteredItem>(
    `SELECT item_key,
            template_id,
            deactivated_at IS NOT NULL AS deactivated
       FROM template_item
      WHERE item_key = ANY($1::text[])`,
    [[...itemKeys]],
  );

  return rows;
}

export interface RegisteredItem extends Record<string, unknown> {
  item_key: string;
  template_id: string;
  deactivated: boolean;
}

export async function insertTemplate(
  client: PoolClient,
  template: { key: string; name: string },
): Promise<{ id: string }> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO template (key, name)
          VALUES ($1, $2)
       RETURNING id`,
    [template.key, template.name],
  );

  return rows[0] as { id: string };
}

export async function registerItems(
  client: PoolClient,
  templateId: string,
  itemKeys: readonly string[],
): Promise<void> {
  await client.query(
    `INSERT INTO template_item (item_key, template_id)
     SELECT item_key, $1
       FROM unnest($2::text[]) AS item_key`,
    [templateId, [...itemKeys]],
  );
}

/**
 * La versión siguiente de la plantilla, sea la primera o la quinta.
 *
 * El `coalesce(max(version), 0) + 1` NO es la garantía: es el número que este request propone.
 * La garantía es `hs_template_version_next()` (0003 §5), que toma un advisory lock sobre la
 * plantilla, lo recalcula y levanta `HS002` si no coincide. Dos publicaciones concurrentes se
 * serializan en ese lock y la segunda muere en vez de pisar a la primera.
 *
 * Una plantilla recién insertada tiene máximo cero y sale 1, así que no hay una rama para la
 * primera versión: es el caso general con la tabla vacía.
 */
export async function insertVersion(
  client: PoolClient,
  version: {
    templateId: string;
    document: TemplateDocument;
    publishedBy: string;
  },
): Promise<{ id: string; version: number }> {
  const { rows } = await client.query<{ id: string; version: number }>(
    `INSERT INTO template_version (template_id, version, document, published_by)
     SELECT $1, coalesce(max(version), 0) + 1, $2::jsonb, $3
       FROM template_version
      WHERE template_id = $1
       RETURNING id, version`,
    [version.templateId, JSON.stringify(version.document), version.publishedBy],
  );

  return rows[0] as { id: string; version: number };
}

export async function markDraftPublished(
  client: PoolClient,
  id: string,
  templateVersionId: string,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE template_draft
        SET published_at = now(), template_version_id = $2, updated_at = now()
      WHERE id = $1
        AND discarded_at IS NULL
        AND published_at IS NULL`,
    [id, templateVersionId],
  );

  return (rowCount ?? 0) > 0;
}

/**
 * `site_ids` llega desde el servicio y no tiene default útil acá: la migración le puso
 * `'{}'` para poder agregar la columna, pero el CHECK de 0020 §3 lo rechaza. Quién decide
 * el alcance inicial es el servicio, con el de la sesión.
 */
export async function insertDraft(
  client: PoolClient,
  draft: {
    key: string;
    name: string;
    document: TemplateDraftDocument;
    createdBy: string;
    siteIds: readonly string[];
    /** La plantilla que el borrador corrige. Ausente en un borrador de plantilla nueva. */
    templateId?: string | null;
  },
): Promise<TemplateDraftRecord> {
  const { rows } = await client.query<TemplateDraftRecord>(
    `WITH saved AS (
       INSERT INTO template_draft (key, name, document, created_by, site_ids, template_id)
            VALUES ($1, $2, $3, $4, $5::uuid[], $6)
         RETURNING ${DRAFT_COLUMNS}
     )
     SELECT ${DRAFT_COLUMNS}, ${NEXT_VERSION_COLUMN}
       FROM saved d
       ${NEXT_VERSION_LATERAL}`,
    [
      draft.key,
      draft.name,
      JSON.stringify(draft.document),
      draft.createdBy,
      draft.siteIds,
      draft.templateId ?? null,
    ],
  );

  // El INSERT devuelve fila o tira; no hay caso vacío.
  return rows[0] as TemplateDraftRecord;
}

/**
 * El guardado de un borrador vivo.
 *
 * Cero filas solo significa que el borrador no existe o fue descartado. El último guardado
 * de una fila viva gana, incluso si el documento se leyó antes en otra ventana.
 *
 * `key` no se toca, y tampoco podría: no está en el `GRANT UPDATE` de 0016 §4.
 *
 * `site_ids` sí entra en ESTA sentencia: cambiar el alcance es una edición como cualquiera y
 * el autor la confirma con el mismo guardado que el documento.
 */
export async function updateDraft(
  client: PoolClient,
  update: {
    id: string;
    name: string;
    document: TemplateDraftDocument;
    siteIds: readonly string[];
  },
): Promise<TemplateDraftRecord | null> {
  const { rows } = await client.query<TemplateDraftRecord>(
    `WITH saved AS (
       UPDATE template_draft
          SET name = $2,
              document = $3,
              updated_at = now(),
              site_ids = $4::uuid[]
        WHERE id = $1
          AND discarded_at IS NULL
          AND published_at IS NULL
    RETURNING ${DRAFT_COLUMNS}
     )
     SELECT ${DRAFT_COLUMNS}, ${NEXT_VERSION_COLUMN}
       FROM saved d
       ${NEXT_VERSION_LATERAL}`,
    [
      update.id,
      update.name,
      JSON.stringify(update.document),
      update.siteIds,
    ],
  );

  return rows[0] ?? null;
}

/**
 * Descartar. Nunca DELETE: el trigger de 0016 §3 lo prohíbe para todos los roles, así que
 * ni siquiera es una decisión que este archivo pueda tomar mal.
 *
 * Idempotente por el `IS NULL`: descartar dos veces no mueve la fecha.
 */
export async function discardDraft(client: PoolClient, id: string): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE template_draft
        SET discarded_at = now(), updated_at = now()
       WHERE id = $1 AND discarded_at IS NULL AND published_at IS NULL`,
    [id],
  );

  return (rowCount ?? 0) > 0;
}
