import { Injectable } from '@nestjs/common';
import type { AcceptedSubmission, InspectionSubmission } from '@hs/contracts';
import { validateAnswers, type TemplateDocument } from '@hs/forms';
import type { DatabaseError } from 'pg';
import type { PoolClient } from 'pg';

import { DbService } from '../db/db.service';
import type { SessionScope } from '../db/site-scope';
import { deriveFindings, type DerivedFinding } from '../findings/derive';
import { foreignObjectKeys, mergePhotoAnswers, objectKeysOf } from './submission';
import {
  alreadySubmitted,
  invalidSubmission,
  notTheAssignedInspector,
  submissionInspectionNotFound,
  validationFailed,
  type SubmissionViolation,
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

      // La derivación corre ACÁ y no después del insert, aunque escriba después: es lo
      // que permite devolver en una sola respuesta lo que le falta al envío. Un
      // inspector que descubre de a una las cosas que le faltan vuelve a caminar la
      // planta una vez por cada una.
      const derived = deriveFindings(document, answers, payload.findings);

      if (!validation.ok || !derived.ok) {
        const violations: SubmissionViolation[] = [
          ...(validation.ok ? [] : validation.violations),
          ...(derived.ok ? [] : derived.violations),
        ];

        throw validationFailed(violations);
      }

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

      // LA DERIVACIÓN DE HALLAZGOS (etapa 4). Acá, dentro de ESTA transacción y antes
      // del commit, y no en un manejador posterior: la costura de ADR-008 es una sola
      // transacción, y un hallazgo que se derive después puede faltar. Lo que falta es
      // la mitad de R2.
      //
      // Esta línea es la que hace que `inspections` conozca `findings`, que es la
      // excepción declarada de ADR-008. Lo que no puede pasar nunca es la inversa:
      // `findings` no llama a `inspections`.
      const resolvedFindings = await this.resolveFindingLocations(
        client,
        scheduled.site_id,
        document,
        derived.findings,
      );
      await this.insertFindings(client, created.row, resolvedFindings);

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
      objectKeysOf(payload.answers, payload.photos, payload.findings),
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
   * trigger DESDE el documento y existen para poder consultar los ítems por separado.
   * La fuente de verdad para validar es la columna. Mismo criterio que
   * `templateVersionPackage`.
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

  /**
   * Los hallazgos y sus fotos, EN DOS SENTENCIAS. Mismo criterio que las respuestas:
   * una inspección con cuarenta negativos no puede ser ochenta idas y vueltas dentro
   * de la transacción que va a tomar el lock de la cadena del sitio.
   *
   * `template_version_item_id` sale del mismo JOIN que en las respuestas. Que el
   * `item_key` sea el del ítem referenciado lo defiende además la FK compuesta: la
   * identidad dual no depende de que este SQL esté bien escrito.
   *
   * `occurred_at` es el `signed_at` del envío: el hallazgo ocurrió cuando el inspector
   * lo vio, no cuando el teléfono encontró señal (§5 riesgo C).
   *
   * Las fotos van después y por eso la restricción de "al menos una" es diferida: acá
   * se ve por qué. Si fuera inmediata, no habría orden posible — la foto necesita el
   * `finding_id` que solo existe después de insertar el hallazgo.
   */
  private async insertFindings(
    client: PoolClient,
    inspection: InspectionRow,
    findings: readonly DerivedFinding[],
  ): Promise<void> {
    if (findings.length === 0) return;

    const { rows } = await client.query<{ id: string; item_key: string }>(
      `INSERT INTO finding (site_id, origin, inspection_id, template_version_item_id,
                            item_key, location_id, description, reported_by, occurred_at)
       SELECT $1, 'inspection', $2, v.id, f.item_key, f.location_id, f.description, $3, $4
         FROM unnest($5::text[], $6::uuid[], $7::text[])
              AS f(item_key, location_id, description)
         JOIN template_version_item v
           ON v.template_version_id = $8
          AND v.item_key = f.item_key
       RETURNING id, item_key`,
      [
        inspection.site_id,
        inspection.id,
        inspection.submitted_by,
        inspection.signed_at,
        findings.map((finding) => finding.item_key),
        findings.map((finding) => finding.details.location_id),
        findings.map((finding) => finding.details.description),
        inspection.template_version_id,
      ],
    );

    // Misma comprobación que en las respuestas y por el mismo motivo: no defiende
    // contra el payload —`deriveFindings` ya lo comparó contra el documento— sino
    // contra una divergencia entre el documento y las filas proyectadas.
    if (rows.length !== findings.length) {
      throw new Error(
        `inspection ${inspection.id}: ${findings.length} findings derived but ${rows.length} rows written`,
      );
    }

    // `RETURNING` no promete orden, así que las fotos se asocian por `item_key` y no
    // por posición. Asociarlas por posición funcionaría casi siempre, que es la peor
    // clase de error para un registro inmutable.
    const idOf = new Map(rows.map((row) => [row.item_key, row.id]));
    const photos = findings.flatMap((finding) =>
      finding.details.photo_object_keys.map((objectKey) => ({
        findingId: idOf.get(finding.item_key) as string,
        objectKey,
      })),
    );

    await client.query(
      `INSERT INTO finding_photo (finding_id, site_id, object_key)
       SELECT p.finding_id, $1, p.object_key
         FROM unnest($2::uuid[], $3::text[]) AS p(finding_id, object_key)`,
      [
        inspection.site_id,
        photos.map((photo) => photo.findingId),
        photos.map((photo) => photo.objectKey),
      ],
    );
  }

  /** Resuelve la ubicación conceptual de la sección contra el catálogo de esta planta. */
  private async resolveFindingLocations(
    client: PoolClient,
    siteId: string,
    document: TemplateDocument,
    findings: readonly DerivedFinding[],
  ): Promise<readonly DerivedFinding[]> {
    const sectionByItem = new Map(
      document.sections.flatMap((section) =>
        section.items.map((item) => [item.item_key, section.organization_location_code] as const),
      ),
    );
    const codes = [
      ...new Set(
        findings
          .map((finding) => sectionByItem.get(finding.item_key))
          .filter((code): code is string => code !== undefined),
      ),
    ];
    const { rows } = await client.query<{ id: string; code: string }>(
      `SELECT l.id, ol.code
         FROM location l
         JOIN organization_location ol ON ol.id = l.organization_location_id
        WHERE l.site_id = $1
          AND l.deactivated_at IS NULL
          AND ol.deactivated_at IS NULL
          AND ol.code = ANY($2::text[])`,
      [siteId, codes],
    );
    const locationByCode = new Map(rows.map((row) => [row.code, row.id]));

    return findings.map((finding) => {
      const code = sectionByItem.get(finding.item_key);
      // Versiones históricas no tenían catálogo conceptual. Conservan la ubicación
      // que ya traían; la revalidación estricta aplica a documentos nuevos que declaran código.
      if (code === undefined) return finding;

      const resolved = locationByCode.get(code) ?? null;
      const supplied = finding.details.location_id;

      if (supplied !== null && supplied !== resolved) {
        throw invalidSubmission(
          `The finding location does not match the location declared by its section`,
        );
      }

      return {
        ...finding,
        details: { ...finding.details, location_id: resolved },
      };
    });
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
  // El reloj del dispositivo. Se lee de vuelta en vez de tomarlo del payload porque es
  // lo que quedó escrito: el `occurred_at` de los hallazgos tiene que ser el mismo
  // instante que el de la inspección, no uno parecido.
  signed_at: Date;
}

const INSPECTION_COLUMNS = `id, site_id, scheduled_inspection_id, template_version_id,
                            client_submission_id, submitted_by, received_at, signed_at`;

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
