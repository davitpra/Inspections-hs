import type { PoolClient } from 'pg';
import type { TemplateDraftDocument } from '@hs/contracts';

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
  revision: number;
  updated_at: Date;
}

const DRAFT_COLUMNS = 'id, key, name, document, revision, updated_at';

/** Los borradores vivos, el más trabajado primero. */
export async function findDrafts(client: PoolClient): Promise<TemplateDraftRecord[]> {
  const { rows } = await client.query<TemplateDraftRecord>(
    `SELECT ${DRAFT_COLUMNS}
       FROM template_draft
      WHERE discarded_at IS NULL
      ORDER BY updated_at DESC`,
  );

  return rows;
}

export async function findDraft(
  client: PoolClient,
  id: string,
): Promise<TemplateDraftRecord | null> {
  const { rows } = await client.query<TemplateDraftRecord>(
    `SELECT ${DRAFT_COLUMNS}
       FROM template_draft
      WHERE id = $1 AND discarded_at IS NULL`,
    [id],
  );

  return rows[0] ?? null;
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

export async function insertDraft(
  client: PoolClient,
  draft: { key: string; name: string; document: TemplateDraftDocument; createdBy: string },
): Promise<TemplateDraftRecord> {
  const { rows } = await client.query<TemplateDraftRecord>(
    `INSERT INTO template_draft (key, name, document, created_by)
          VALUES ($1, $2, $3, $4)
       RETURNING ${DRAFT_COLUMNS}`,
    [draft.key, draft.name, JSON.stringify(draft.document), draft.createdBy],
  );

  // El INSERT devuelve fila o tira; no hay caso vacío.
  return rows[0] as TemplateDraftRecord;
}

/**
 * El guardado, con el lock optimista adentro del `WHERE`.
 *
 * `revision = revision + 1` y `revision = $4` en la misma sentencia: no hay lectura previa
 * que pueda quedar vieja entre el chequeo y la escritura. Cero filas significa una de dos
 * cosas —la revisión ya no es esa, o el borrador fue descartado— y el servicio las
 * distingue con una lectura de seguimiento, porque el autor merece saber cuál de las dos le
 * pasó.
 *
 * `key` no se toca, y tampoco podría: no está en el `GRANT UPDATE` de 0016 §4.
 */
export async function updateDraft(
  client: PoolClient,
  update: { id: string; name: string; document: TemplateDraftDocument; revision: number },
): Promise<TemplateDraftRecord | null> {
  const { rows } = await client.query<TemplateDraftRecord>(
    `UPDATE template_draft
        SET name = $2,
            document = $3,
            revision = revision + 1,
            updated_at = now()
      WHERE id = $1
        AND revision = $4
        AND discarded_at IS NULL
  RETURNING ${DRAFT_COLUMNS}`,
    [update.id, update.name, JSON.stringify(update.document), update.revision],
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
      WHERE id = $1 AND discarded_at IS NULL`,
    [id],
  );

  return (rowCount ?? 0) > 0;
}
