import { Injectable } from '@nestjs/common';
import type { AcceptedSubmission, InspectionSubmission } from '@hs/contracts';
import { validateAnswers, type TemplateDocument } from '@hs/forms';
import type { DatabaseError } from 'pg';
import type { PoolClient } from 'pg';

import { DbService } from '../db/db.service';
import type { SessionScope } from '../db/site-scope';
import { foreignObjectKeys, mergePhotoAnswers, objectKeysOf } from './submission';
import {
  alreadySubmitted,
  invalidSubmission,
  notTheAssignedInspector,
  submissionInspectionNotFound,
  validationFailed,
} from './submissions.errors';

/**
 * ADR-008, COSTURA CRÍTICA 1 — La ingesta del envío.
 *
 * Todo lo que sigue ocurre dentro de UNA llamada a `withSessionClient`, que es una
 * transacción. Ese es el requisito de "todo o nada", y no el orden de los pasos: si
 * mañana alguien mueve la validación después del insert, el envío inválido sigue sin
 * dejar estado parcial porque la transacción no comete. Validar primero es para
 * devolver el error barato, no para que la garantía se cumpla.
 *
 * QUÉ NO APLICA ESTE SERVICIO, porque lo aplica el motor (migración 0009 §5–§8):
 *
 *   - Que la versión enviada sea la congelada → `hs_inspection_freeze_guard`.
 *   - Que el período no esté cancelado → la misma guarda.
 *   - Que cada respuesta pertenezca a la versión enviada → `hs_inspection_answer_guard`.
 *   - Que un `client_submission_id` produzca un solo registro → el único.
 *   - Que una planta no vea la otra → la política RLS. No hay un `WHERE site_id` acá.
 *
 * Las comprobaciones que sí están escritas duplican tres de esas a propósito: existen
 * para devolverle al dispositivo un código que su outbox sabe clasificar, en vez de un
 * `HS002` que solo sabría reintentar. Si el servicio se equivoca, el motor rechaza
 * igual; si el motor rechaza, el dispositivo no entiende por qué. Hacen falta las dos.
 */
@Injectable()
export class SubmissionsService {
  constructor(private readonly db: DbService) {}

  async ingest(
    session: SessionScope,
    payload: InspectionSubmission,
  ): Promise<AcceptedSubmission> {
    return this.db.withSessionClient(session, async (client) => {
      const scheduled = await this.resolveScheduled(client, payload.scheduled_inspection_id);

      // El actor sale de la sesión y NUNCA del cuerpo. Un dueño, un dispositivo, un
      // firmante (§4): el envío es de quien lo tiene asignado. Una inspección sin
      // inspector no le corresponde a nadie y por eso `null` también cae acá.
      if (scheduled.inspector_id === null || scheduled.inspector_id !== session.userId) {
        throw notTheAssignedInspector(
          'Only the inspector this inspection is assigned to can submit it',
        );
      }

      if (scheduled.cancelled_at !== null) {
        throw invalidSubmission('The scheduled inspection was cancelled');
      }

      // El dispositivo DECLARA con qué versión interpretó el formulario; no la elige.
      // Rechazar el desacuerdo es lo que impide que el registro legal diga que se
      // preguntó algo que el inspector nunca vio.
      if (payload.template_version_id !== scheduled.template_version_id) {
        throw invalidSubmission(
          'The submission was built against a template version this inspection is not frozen to',
        );
      }

      const answers = this.prepareAnswers(payload, scheduled.site_id);
      const document = await this.frozenDocument(client, scheduled.template_version_id);

      // ADR-007: el MISMO código que corrió en el dispositivo antes de dejar firmar.
      // Que sean el mismo es el punto entero — si divergieran, el inspector recorre 48
      // acres, firma, sincroniza y el servidor lo rechaza.
      const validation = validateAnswers(document, answers);

      if (!validation.ok) throw validationFailed(validation.violations);

      const entries = Object.entries(answers);
      const created = await this.insertInspection(
        client,
        payload,
        scheduled,
        session.userId,
        entries.length,
      );

      // El reenvío termina acá: no se escriben respuestas, no se escribe auditoría —el
      // trigger es AFTER INSERT y no hubo insert—, y se devuelve lo que ya existía.
      if (!created.inserted) return toAccepted(created.row, false);

      await this.insertAnswers(client, created.row, entries);

      // AQUÍ VA LA DERIVACIÓN DE HALLAZGOS (etapa 4, change `findings`).
      //
      // Lee las filas de `inspection_answer` que se acaban de escribir, dentro de ESTA
      // transacción y antes del commit, y escribe los hallazgos de las respuestas
      // negativas. Va acá y no en un manejador de eventos posterior porque la costura
      // de ADR-008 es una sola transacción: un hallazgo que se derive después puede
      // faltar, y lo que falta es la mitad de R2.
      //
      // No hay interfaz, ni hook, ni puerto vacío esperándolo: un punto de extensión
      // sin segundo implementador es la ceremonia contra la que advierte el riesgo B.
      // El change que lo necesite escribe la llamada en esta línea.

      return toAccepted(created.row, true);
    });
  }

  /**
   * La inspección programada, con lo que hace falta para decidir los tres rechazos.
   *
   * No reusa `findActiveInspection`: esa función devuelve `null` para "cancelada" y
   * para "no existe" indistintamente, que es lo correcto donde se usa —el presign no
   * puede ser un oráculo— pero acá hacen falta separadas. Una cancelada tiene que
   * responder `invalid_submission` y no `inspection_not_found`, porque el inspector
   * hizo el trabajo y alguien tiene que mirarlo.
   *
   * SIN `WHERE site_id` (ADR-002): el recorte lo hace la política sobre la transacción.
   */
  private async resolveScheduled(client: PoolClient, id: string): Promise<ScheduledRow> {
    const { rows } = await client.query<ScheduledRow>(
      `SELECT id, site_id, template_version_id, inspector_id, cancelled_at
         FROM scheduled_inspection
        WHERE id = $1`,
      [id],
    );

    const row = rows[0];

    // La de otra planta no devuelve cero filas porque se la filtre: la transacción no
    // la ve. Por eso responde igual que una que no existe.
    if (!row) throw submissionInspectionNotFound();

    return row;
  }

  /**
   * Funde las fotos en el conjunto de respuestas y verifica que toda object key sea de
   * esta inspección. Las dos cosas ANTES de validar: comprobar el prefijo después de
   * aceptar la forma sería aceptar primero y preguntar después.
   */
  private prepareAnswers(
    payload: InspectionSubmission,
    siteId: string,
  ): Record<string, unknown> {
    const foreign = foreignObjectKeys(
      objectKeysOf(payload.answers, payload.photos),
      siteId,
      payload.scheduled_inspection_id,
    );

    if (foreign.length > 0) {
      // El detalle no se devuelve: qué prefijo se esperaba es información sobre cómo
      // se nombran los objetos de otra inspección.
      throw invalidSubmission('The submission references files that do not belong to it');
    }

    const merged = mergePhotoAnswers(payload.answers, payload.photos);

    if (!merged.ok) {
      throw invalidSubmission(
        `Answered twice, as answer and as photo: ${merged.collisions.join(', ')}`,
      );
    }

    return merged.answers;
  }

  /**
   * El documento congelado, de la columna `template_version.document` tal cual.
   *
   * No se reconstruye desde `template_version_item`: esas filas las proyecta un
   * trigger DESDE el documento y existen para consultar la recurrencia. La fuente de
   * verdad para validar es la columna. Mismo criterio que `templateVersionPackage`.
   */
  private async frozenDocument(
    client: PoolClient,
    templateVersionId: string,
  ): Promise<TemplateDocument> {
    const { rows } = await client.query<{ document: TemplateDocument }>(
      `SELECT document FROM template_version WHERE id = $1`,
      [templateVersionId],
    );

    const row = rows[0];

    // La FK garantiza que exista: si no está, la base está rota.
    if (!row) throw submissionInspectionNotFound();

    return row.document;
  }

  /**
   * EL INSERT IDEMPOTENTE (ADR-001).
   *
   * `ON CONFLICT (client_submission_id) DO NOTHING` y, si no vuelve fila, se lee la
   * existente. Un `SELECT` previo tendría una ventana entre la lectura y la escritura,
   * y el outbox puede robar su propio lock y mandar el mismo id dos veces a la vez: la
   * mitad que corre en el dispositivo delega en el motor precisamente esta corrección.
   *
   * Bajo concurrencia real el `INSERT` de la segunda transacción se BLOQUEA en el
   * único hasta que la primera comete, y recién entonces devuelve cero filas; el
   * `SELECT` que sigue ve la fila cometida porque la transacción es READ COMMITTED.
   * Las dos responden con el mismo `id`.
   *
   * El conflicto del OTRO único —un `client_submission_id` nuevo para una inspección
   * que ya tiene envío— NO lo absorbe el `ON CONFLICT`, que nombra una sola restricción.
   * Llega como 23505 y se traduce a `already_submitted`, que es lo correcto: eso no es
   * un reintento, es un segundo envío.
   */
  private async insertInspection(
    client: PoolClient,
    payload: InspectionSubmission,
    scheduled: ScheduledRow,
    submittedBy: string,
    answerCount: number,
  ): Promise<{ inserted: boolean; row: InspectionRow }> {
    let inserted: InspectionRow | undefined;

    try {
      const { rows } = await client.query<InspectionRow>(
        `INSERT INTO inspection (site_id, scheduled_inspection_id, template_version_id,
                                 client_submission_id, submitted_by, signed_at, answer_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (client_submission_id) DO NOTHING
         RETURNING ${INSPECTION_COLUMNS}`,
        [
          scheduled.site_id,
          scheduled.id,
          scheduled.template_version_id,
          payload.client_submission_id,
          // De la sesión, no del cuerpo y no de la fila que se acaba de leer: la
          // comprobación de arriba ya garantiza que son el mismo, y escribir el de la
          // sesión deja en el diff de dónde sale.
          submittedBy,
          payload.signed_at,
          answerCount,
        ],
      );

      inserted = rows[0];
    } catch (error) {
      if (isUniqueViolation(error, 'inspection_scheduled_uq')) throw alreadySubmitted();

      throw error;
    }

    if (inserted) return { inserted: true, row: inserted };

    const { rows } = await client.query<InspectionRow>(
      `SELECT ${INSPECTION_COLUMNS} FROM inspection WHERE client_submission_id = $1`,
      [payload.client_submission_id],
    );

    const existing = rows[0];

    // Solo puede faltar si la fila que produjo el conflicto es de otra planta —un UUID
    // repetido entre sitios, que no ocurre— y la política la esconde. Se responde como
    // conflicto y no se filtra que exista.
    if (!existing) throw alreadySubmitted();

    return { inserted: false, row: existing };
  }

  /**
   * Las respuestas, EN UNA SOLA SENTENCIA.
   *
   * No una por ítem: doscientas sentencias dentro de una transacción que va a tomar el
   * lock de la cadena de auditoría alargan la sección crítica del log del sitio entero.
   *
   * El `template_version_item_id` lo resuelve el JOIN por `(template_version_id,
   * item_key)`, que es único. La comparación de `rowCount` no es defensa contra un
   * payload —`validateAnswers` ya rechazó cualquier `item_key` que el documento no
   * tenga— sino contra una divergencia entre el documento y las filas proyectadas: si
   * alguna vez no coincidieran, esto aborta la transacción en vez de escribir una
   * inspección a la que le faltan respuestas.
   */
  private async insertAnswers(
    client: PoolClient,
    inspection: InspectionRow,
    entries: readonly [string, unknown][],
  ): Promise<void> {
    if (entries.length === 0) return;

    const { rowCount } = await client.query(
      `INSERT INTO inspection_answer (inspection_id, site_id, template_version_item_id,
                                      item_key, value)
       SELECT $1, $2, v.id, a.item_key, a.value
         FROM unnest($3::text[], $4::jsonb[]) AS a(item_key, value)
         JOIN template_version_item v
           ON v.template_version_id = $5
          AND v.item_key = a.item_key`,
      [
        inspection.id,
        inspection.site_id,
        entries.map(([itemKey]) => itemKey),
        entries.map(([, value]) => JSON.stringify(value)),
        inspection.template_version_id,
      ],
    );

    if (rowCount !== entries.length) {
      throw new Error(
        `inspection ${inspection.id}: ${entries.length} answers submitted but ${rowCount} rows written`,
      );
    }
  }
}

interface ScheduledRow {
  id: string;
  site_id: string;
  template_version_id: string;
  inspector_id: string | null;
  cancelled_at: Date | null;
}

interface InspectionRow {
  id: string;
  site_id: string;
  scheduled_inspection_id: string;
  template_version_id: string;
  client_submission_id: string;
  submitted_by: string;
  received_at: Date;
}

const INSPECTION_COLUMNS = `id, site_id, scheduled_inspection_id, template_version_id,
                            client_submission_id, submitted_by, received_at`;

/**
 * `submitted_at` es `received_at`, el reloj del SERVIDOR, y no `signed_at`.
 *
 * El dispositivo ya sabe cuándo firmó —lo mandó él— y lo que no sabe es cuándo quedó
 * registrado. Devolverle su propio reloj sería devolverle su propio dato.
 *
 * `created` distingue la aceptación del reenvío sin cambiar el status ni la forma:
 * para el outbox los dos significan lo mismo —el registro existe, la entrada se puede
 * borrar— y por eso un reenvío no es un `409` (ADR-001).
 */
function toAccepted(row: InspectionRow, created: boolean): AcceptedSubmission {
  return {
    id: row.id,
    client_submission_id: row.client_submission_id,
    scheduled_inspection_id: row.scheduled_inspection_id,
    template_version_id: row.template_version_id,
    submitted_at: row.received_at.toISOString(),
    submitted_by: row.submitted_by,
    created,
  };
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const candidate = error as DatabaseError | undefined;

  return candidate?.code === '23505' && candidate.constraint === constraint;
}
