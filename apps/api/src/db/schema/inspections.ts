import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { site } from './catalog';
import { appUser } from './identity';
import { template, templateItem, templateVersion, templateVersionItem } from './templates';

/**
 * ADR-004 — La fuente de verdad de estas tablas es
 * `apps/api/drizzle/0008_inspection_scheduling.sql` y
 * `apps/api/drizzle/0009_inspection_submissions.sql`, no este archivo.
 *
 * Acá solo viven los tipos con los que el repositorio consulta. El SQL lleva además
 * el trigger `hs_scheduling_guard` —que es lo que hace que la versión de plantilla
 * avance de forma monótona—, los de prohibición de DELETE/TRUNCATE, los de auditoría,
 * `hs_apply_site_isolation` y los GRANT por columna. Nada de eso lo sabe expresar un
 * esquema de ORM. Por eso `drizzle-kit generate` está prohibido: regeneraría el
 * `.sql` a partir de esto y se llevaría puesto el mecanismo. Si el SQL cambia, este
 * espejo se actualiza a mano.
 */

/**
 * La regla de recurrencia: qué plantilla debe inspeccionarse en qué planta, cada cuántos
 * meses y anclada en cuál. Es la tabla que lee el trabajo de apertura.
 *
 * `frequency_months` y `anchor_month` llegaron en 0029 y son INMUTABLES —están en el
 * array `frozen` del trigger de guarda y fuera del GRANT UPDATE—. El motivo está escrito
 * en la migración: el CTE `owed` del reporte GENERA los períodos que el sitio debía a
 * partir de la regla, así que cambiarle la frecuencia a una regla viva no cambia el
 * futuro, reescribe el pasado. Cambiar la frecuencia es desactivar y crear otra.
 */
export const inspectionSchedule = pgTable(
  'inspection_schedule',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),
    templateId: uuid('template_id')
      .notNull()
      .references(() => template.id),

    // Nulable: una regla puede existir antes de que el coordinador decida quién la
    // ejecuta. Que el inspector sea `jhsc_member` y tenga alcance vigente en el sitio
    // lo valida el servicio: depende de `user_site_scope`, y una FK no sabe expresar
    // "y además su alcance vigente incluye este sitio".
    defaultInspectorId: uuid('default_inspector_id').references(() => appUser.id),

    /**
     * Cada cuántos meses. Los divisores de 12 y nada más (1, 3, 6, 12): es exactamente
     * el conjunto para el que un ancla de 1 a 12 alcanza para decidir, sin mirar el año,
     * si un mes empieza período. El CHECK vive en 0029.
     */
    frequencyMonths: smallint('frequency_months').notNull(),

    /** El mes 1-12 en el que la serie empieza. Para una regla mensual no significa nada. */
    anchorMonth: smallint('anchor_month').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    // Nulable por el mismo motivo que `audit_log.actor_user_id`.
    createdBy: uuid('created_by').references(() => appUser.id),

    // La baja es lógica: no hay DELETE.
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),

    // El archivo solo retira una regla desactivada de la vista administrativa.
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'inspection_schedule_archive_check',
      sql`${table.archivedAt} IS NULL OR ${table.deactivatedAt} IS NOT NULL`,
    ),
    uniqueIndex('inspection_schedule_active_uq')
      .on(table.siteId, table.templateId)
      .where(sql`${table.deactivatedAt} IS NULL`),
    index('inspection_schedule_active_idx')
      .on(table.siteId)
      .where(sql`${table.deactivatedAt} IS NULL`),
  ],
);

/**
 * La ocurrencia del período: la obligación concreta.
 *
 * **Sin columna de estado, y es deliberado.** "Cumplida" se deriva de la existencia de
 * una `inspection` enviada, que llega en el change de captura. Un `status` hoy sería
 * una máquina de estados que nadie puede hacer avanzar.
 *
   * **`templateVersionId` se fija al programar y solo avanza.** El motor permite moverla
   * a una versión publicada superior de la misma plantilla mientras el período esté vivo
   * y no tenga envío; publicar una versión nueva no la mueve por sí solo.
 */
export const scheduledInspection = pgTable(
  'scheduled_inspection',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),

    // El período como fecha civil, no como instante: el primer día del mes que cubre.
    periodStart: date('period_start').notNull(),

    // Cuánto dura ESTE período, copiado de la regla al abrir — igual que `templateId` e
    // `inspectorId`, y por el mismo motivo: la regla es una fábrica, no un padre.
    // Desactivarla no puede reescribir la forma de un período que ya se inspeccionó.
    periodMonths: smallint('period_months').notNull(),

    // Generada por el motor. Nunca se escribe desde acá — febrero de un año bisiesto
    // no puede estar mal porque nadie lo calcula dos veces.
    periodEnd: date('period_end').notNull().generatedAlwaysAs(
      sql`(period_start + (period_months * INTERVAL '1 month') - INTERVAL '1 day')::date`,
    ),

    // Copiado de la regla, no leído por join: desactivar una regla no puede alterar
    // retroactivamente qué se inspeccionó. La FK compuesta con `templateVersionId`
    // impide que la versión sea de otra plantilla.
    templateId: uuid('template_id')
      .notNull()
      .references(() => template.id),
    templateVersionId: uuid('template_version_id')
      .notNull()
      .references(() => templateVersion.id),

    // Nulable: el trabajo abre con el inspector por defecto de la regla, que puede no
    // haber. El coordinador asigna después.
    inspectorId: uuid('inspector_id').references(() => appUser.id),

    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull().defaultNow(),

    // NULL es el trabajo automático. Distingue en la propia tabla lo que abrió el
    // calendario de lo que programó el coordinador a mano.
    scheduledBy: uuid('scheduled_by').references(() => appUser.id),

    // Cancelar es esto, nunca un DELETE, y exige motivo.
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),

    // Decidida al abrir el período a mano y nunca después — igual que `templateId`, no
    // lleva UPDATE. Sin ella, el pendiente del inspector no puede distinguir un período
    // que ya empezó de uno que el coordinador adelantó a propósito.
    visibleEarly: boolean('visible_early').notNull().default(false),
  },
  (table) => [
    check(
      'scheduled_inspection_cancellation_check',
      sql`(${table.cancelledAt} IS NULL) = (${table.cancellationReason} IS NULL)`,
    ),

    // LA GARANTÍA DE IDEMPOTENCIA de la apertura mensual. Sobre `template_id` y no
    // sobre la versión: si fuera sobre la versión, publicar a mitad de mes permitiría
    // abrir una segunda inspección del mismo período.
    uniqueIndex('scheduled_inspection_open_period_uq')
      .on(table.siteId, table.templateId, table.periodStart)
      .where(sql`${table.cancelledAt} IS NULL`),

    // La pantalla de inicio del miembro del JHSC.
    index('scheduled_inspection_pending_idx')
      .on(table.inspectorId, table.periodEnd)
      .where(sql`${table.cancelledAt} IS NULL`),
  ],
);

/**
 * El envío congelado (migración 0009). ADR-008, costura crítica 1.
 *
 * **Íntegramente inmutable**: 0009 no tiene un solo `GRANT UPDATE`, así que no hay un
 * tipo `InspectionUpdate` acá abajo y esa ausencia es deliberada. Corregir una
 * inspección enviada es un `RegistroSuplementario` que la supera, no un UPDATE.
 *
 * `clientSubmissionId` es la clave de idempotencia del sistema entero (ADR-001) y su
 * único es lo que absorbe un reintento del outbox. `signedAt` es el reloj del
 * dispositivo y `receivedAt` el del servidor: el riesgo C de §5 pide los dos.
 */
export const inspection = pgTable(
  'inspection',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),
    scheduledInspectionId: uuid('scheduled_inspection_id')
      .notNull()
      .references(() => scheduledInspection.id),

    // Copiada de la inspección programada. Que la copia sea fiel —y que la programada
    // no esté cancelada— lo defiende el trigger `hs_inspection_freeze_guard`.
    templateVersionId: uuid('template_version_id')
      .notNull()
      .references(() => templateVersion.id),

    clientSubmissionId: uuid('client_submission_id').notNull(),

    // NOT NULL, a diferencia de `scheduledBy`: nada automático firma una inspección.
    submittedBy: uuid('submitted_by')
      .notNull()
      .references(() => appUser.id),

    signedAt: timestamp('signed_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),

    answerCount: integer('answer_count').notNull(),
  },
  (table) => [
    check('inspection_answer_count_check', sql`${table.answerCount} >= 0`),

    // LA IDEMPOTENCIA. Reenviar el mismo id devuelve el registro existente y no crea
    // otro, y lo garantiza este único, no una comprobación previa del servicio.
    uniqueIndex('inspection_client_submission_uq').on(table.clientSubmissionId),

    // Un envío por inspección programada. Total y no parcial: hoy no existe ningún
    // estado que excluya una fila.
    uniqueIndex('inspection_scheduled_uq').on(table.scheduledInspectionId),

    // Destino de la FK compuesta de `inspectionAnswer`.
    unique('inspection_id_site_uq').on(table.id, table.siteId),

    index('inspection_site_received_idx').on(table.siteId, table.receivedAt),
  ],
);

/**
 * Las respuestas, COMO FILAS y no como un documento (migración 0009).
 *
 * La identidad dual de §4 vive en dos columnas: `templateVersionItemId` es la fila
 * publicada que se contestó —fidelidad legal— e `itemKey` es el concepto estable por
 * el que agrupa la recurrencia de la etapa 7. Que la segunda no mienta sobre la
 * primera lo defiende la FK compuesta contra `template_version_item (id, item_key)`.
 *
 * `value` es jsonb porque UNA respuesta cambia de forma según el `response_type`:
 * booleano, número, cadena, o lista de object keys. Eso no es guardar el conjunto de
 * respuestas como documento, que es justamente lo que esta tabla existe para no hacer.
 */
export const inspectionAnswer = pgTable(
  'inspection_answer',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    inspectionId: uuid('inspection_id')
      .notNull()
      .references(() => inspection.id),

    // Denormalizado: la política RLS necesita el sitio en la fila. La FK compuesta de
    // abajo impide que diga algo distinto del sitio de su inspección.
    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id),

    templateVersionItemId: uuid('template_version_item_id')
      .notNull()
      .references(() => templateVersionItem.id),
    itemKey: text('item_key')
      .notNull()
      .references(() => templateItem.itemKey),

    value: jsonb('value').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.inspectionId, table.siteId],
      foreignColumns: [inspection.id, inspection.siteId],
    }),
    foreignKey({
      columns: [table.templateVersionItemId, table.itemKey],
      foreignColumns: [templateVersionItem.id, templateVersionItem.itemKey],
    }),

    uniqueIndex('inspection_answer_item_uq').on(table.inspectionId, table.itemKey),

    // El índice del GROUP BY de recurrencia de la etapa 7.
    index('inspection_answer_recurrence_idx').on(table.siteId, table.itemKey),
    index('inspection_answer_inspection_idx').on(table.inspectionId),
  ],
);

export type InspectionSchedule = typeof inspectionSchedule.$inferSelect;
export type ScheduledInspection = typeof scheduledInspection.$inferSelect;
export type Inspection = typeof inspection.$inferSelect;
export type InspectionAnswer = typeof inspectionAnswer.$inferSelect;

/**
 * Lo que un caller aporta al insertar un envío. `id` y `receivedAt` no están: los pone
 * la base, y `receivedAt` es el reloj del servidor, que es el punto de que exista.
 */
export type NewInspection = Pick<
  typeof inspection.$inferInsert,
  | 'siteId'
  | 'scheduledInspectionId'
  | 'templateVersionId'
  | 'clientSubmissionId'
  | 'submittedBy'
  | 'signedAt'
  | 'answerCount'
>;

/**
 * Lo que un caller puede cambiar de una regla. `site_id` y `template_id` no están: una
 * regla no se muda de planta ni de plantilla, se desactiva y se crea otra.
 */
export type InspectionScheduleUpdate = Partial<
  Pick<InspectionSchedule, 'defaultInspectorId' | 'deactivatedAt' | 'archivedAt'>
>;

/**
 * Lo que un caller puede cambiar de una inspección programada. `template_version_id`
 * no está: el avance es una operación explícita que pasa por el servicio y por las
 * barreras del motor.
 */
export type ScheduledInspectionUpdate = Partial<
  Pick<ScheduledInspection, 'inspectorId' | 'cancelledAt' | 'cancellationReason'>
>;
