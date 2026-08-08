import { z } from 'zod';

/**
 * Requisitos §4 — InspecciónProgramada: la obligación de inspeccionar.
 *
 * Este archivo es la mitad que ve el cliente. Lo que NO puede validar es todo lo que
 * depende del estado de la base: que la plantilla tenga una versión publicada, que el
 * inspector sea `jhsc_member` con alcance vigente en la planta, que el período no esté
 * ya abierto. Eso son claves foráneas, únicos parciales y triggers en
 * `apps/api/drizzle/0008_inspection_scheduling.sql`, más las comprobaciones del
 * servicio. Zod valida la forma; el motor valida las referencias.
 *
 * **`template_version_id` es de solo lectura en todos los contratos de escritura**, y
 * esa ausencia es el requisito entero del change: la versión se congela al programar y
 * publicar una nueva no mueve una inspección abierta. Un `PATCH` que la aceptara sería
 * una promesa que el motor rechaza con 42501.
 */

const reasonSchema = z.string().trim().min(1).max(500);

/** El período: siempre el primer día de un mes. */
export const periodStartSchema = z
  .iso
  .date()
  .refine((value) => value.endsWith('-01'), 'period_start: el primer día del mes');

/**
 * La regla de recurrencia. Una regla activa por planta y plantilla significa que esa
 * planta debe una inspección de esa plantilla todos los meses.
 */
export const inspectionScheduleSchema = z.strictObject({
  id: z.uuid(),
  site_id: z.uuid(),
  template_id: z.uuid(),
  template_name: z.string().min(1),
  default_inspector_id: z.uuid().nullable(),
  deactivated_at: z.iso.datetime({ offset: true }).nullable(),
});

export type InspectionSchedule = z.infer<typeof inspectionScheduleSchema>;

/**
 * Alta de una regla. `site_id` va en el cuerpo y NO sale de la sesión: el coordinador
 * tiene alcance a las dos plantas y tiene que poder decir cuál. Que la planta esté
 * dentro de su alcance lo aplica la política RLS, no una comprobación del endpoint.
 */
export const createInspectionScheduleSchema = z.strictObject({
  site_id: z.uuid(),
  template_id: z.uuid(),
  default_inspector_id: z.uuid().nullable().optional(),
});

export type CreateInspectionSchedule = z.infer<typeof createInspectionScheduleSchema>;

/**
 * Lo único que se puede cambiar de una regla: a quién le toca por defecto, y si sigue
 * abriendo períodos. `site_id` y `template_id` no están — una regla no se muda de
 * planta ni de plantilla, se desactiva y se crea otra.
 */
export const updateInspectionScheduleSchema = z
  .strictObject({
    default_inspector_id: z.uuid().nullable().optional(),
    deactivated: z.boolean().optional(),
  })
  .refine(
    (value) => value.default_inspector_id !== undefined || value.deactivated !== undefined,
    'un update tiene que cambiar el inspector por defecto, el estado, o los dos',
  );

export type UpdateInspectionSchedule = z.infer<typeof updateInspectionScheduleSchema>;

/** La ocurrencia del período, tal como la devuelve la API. */
export const scheduledInspectionSchema = z.strictObject({
  id: z.uuid(),
  site_id: z.uuid(),
  period_start: periodStartSchema,
  period_end: z.iso.date(),
  template_id: z.uuid(),
  template_name: z.string().min(1),
  template_version_id: z.uuid(),
  template_version: z.int().positive(),
  inspector_id: z.uuid().nullable(),
  scheduled_at: z.iso.datetime({ offset: true }),
  /** `null` es el trabajo automático: el calendario, no una persona. */
  scheduled_by: z.uuid().nullable(),
  cancelled_at: z.iso.datetime({ offset: true }).nullable(),
  cancellation_reason: z.string().nullable(),
});

export type ScheduledInspection = z.infer<typeof scheduledInspectionSchema>;

/**
 * Programación fuera del calendario. La versión NO viaja: la resuelve el servidor
 * como la más alta publicada de la plantilla, en el momento de programar. Dejar que
 * el cliente la eligiera abriría la puerta a abrir una inspección contra una versión
 * vieja sin que quede registrado que fue una decisión.
 */
export const createScheduledInspectionSchema = z.strictObject({
  site_id: z.uuid(),
  template_id: z.uuid(),
  period_start: periodStartSchema,
  inspector_id: z.uuid().nullable().optional(),
});

export type CreateScheduledInspection = z.infer<typeof createScheduledInspectionSchema>;

/** Reasignar. Solo el coordinador, y queda en la cadena de auditoría de la planta. */
export const assignInspectorSchema = z.strictObject({
  inspector_id: z.uuid(),
});

export type AssignInspector = z.infer<typeof assignInspectorSchema>;

/**
 * Cancelar. El motivo es obligatorio y el motor lo exige con un CHECK: una
 * cancelación sin motivo no es un registro, es un agujero.
 */
export const cancelScheduledInspectionSchema = z.strictObject({
  reason: reasonSchema,
});

export type CancelScheduledInspection = z.infer<typeof cancelScheduledInspectionSchema>;

/**
 * Lo que el miembro del JHSC ve en su pantalla de inicio: lo que todavía debe.
 *
 * `overdue` lo calcula el servidor contra la fecha civil de Ontario y no se almacena:
 * una columna `is_overdue` sería un valor que envejece solo, sobre una tabla que casi
 * no admite UPDATE.
 */
export const pendingInspectionSchema = z.strictObject({
  id: z.uuid(),
  site_id: z.uuid(),
  period_start: periodStartSchema,
  period_end: z.iso.date(),
  template_name: z.string().min(1),
  template_version_id: z.uuid(),
  overdue: z.boolean(),
});

export type PendingInspection = z.infer<typeof pendingInspectionSchema>;
