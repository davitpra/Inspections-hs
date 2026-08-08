import { sql } from 'drizzle-orm';
import { check, date, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { site } from './catalog';
import { appUser } from './identity';
import { template, templateVersion } from './templates';

/**
 * ADR-004 — La fuente de verdad de estas tablas es
 * `apps/api/drizzle/0008_inspection_scheduling.sql`, no este archivo.
 *
 * Acá solo viven los tipos con los que el repositorio consulta. El SQL lleva además
 * el trigger `hs_scheduling_guard` —que es lo que hace que la versión de plantilla
 * quede congelada—, los de prohibición de DELETE/TRUNCATE, los de auditoría,
 * `hs_apply_site_isolation` y los GRANT por columna. Nada de eso lo sabe expresar un
 * esquema de ORM. Por eso `drizzle-kit generate` está prohibido: regeneraría el
 * `.sql` a partir de esto y se llevaría puesto el mecanismo. Si el SQL cambia, este
 * espejo se actualiza a mano.
 */

/**
 * La regla de recurrencia: qué plantilla debe inspeccionarse mensualmente en qué
 * planta. Es la tabla que lee el trabajo de apertura.
 *
 * Sin campo de frecuencia. La mensualidad está en el período y en el trabajo; el día
 * que haya semanal, ese change agrega la columna.
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

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    // Nulable por el mismo motivo que `audit_log.actor_user_id`.
    createdBy: uuid('created_by').references(() => appUser.id),

    // La baja es lógica: no hay DELETE.
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  },
  (table) => [
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
 * **`templateVersionId` se fija al programar y no se mueve nunca.** No está en el
 * `GRANT UPDATE` de la migración y el trigger de guarda la rechaza para todos los
 * roles: publicar una versión nueva no puede tocar una inspección ya abierta.
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

    // Generada por el motor. Nunca se escribe desde acá — febrero de un año bisiesto
    // no puede estar mal porque nadie lo calcula dos veces.
    periodEnd: date('period_end').notNull().generatedAlwaysAs(
      sql`(period_start + INTERVAL '1 month' - INTERVAL '1 day')::date`,
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

export type InspectionSchedule = typeof inspectionSchedule.$inferSelect;
export type ScheduledInspection = typeof scheduledInspection.$inferSelect;

/**
 * Lo que un caller puede cambiar de una regla. `site_id` y `template_id` no están: una
 * regla no se muda de planta ni de plantilla, se desactiva y se crea otra.
 */
export type InspectionScheduleUpdate = Partial<
  Pick<InspectionSchedule, 'defaultInspectorId' | 'deactivatedAt'>
>;

/**
 * Lo que un caller puede cambiar de una inspección programada. `template_version_id`
 * no está, y esa ausencia es el requisito entero del change: el GRANT por columna se
 * lo niega a hs_app y el trigger `scheduled_inspection_guard` se lo niega a todos.
 */
export type ScheduledInspectionUpdate = Partial<
  Pick<ScheduledInspection, 'inspectorId' | 'cancelledAt' | 'cancellationReason'>
>;
