import { z } from 'zod';

import { severitySchema } from './findings.js';
import { periodMonthsSchema } from './compliance.js';
import { incidentClassificationSchema } from './incidents.js';

/**
 * La bandeja in-app.
 *
 * ADR-011 design D9 cerró que no hay servidor de correo y no se agrega uno. Todo lo
 * que este sistema tenga para decirle a alguien se lo dice acá, o no se lo dice.
 *
 * La lista de `kind` está cerrada y agregar uno es una migración: el consumidor tiene
 * que saber leer el payload, así que un tipo nuevo no puede aparecer sin que alguien
 * escriba cómo se muestra.
 */
export const NOTIFICATION_KINDS = [
  'inspection_period_opened',
  'corrective_action_assigned',
  'corrective_action_overdue_supervisor',
  'corrective_action_overdue_management',
  'incident_reported',
] as const;

export const notificationKindSchema = z.enum(NOTIFICATION_KINDS);

export type NotificationKind = z.infer<typeof notificationKindSchema>;

/**
 * El payload de `inspection_period_opened`: qué se abrió en esa planta y con qué.
 *
 * **EL PERÍODO ESTÁ EN CADA ENTRADA Y NO ARRIBA**, y desde 0029 no puede ser de otra
 * manera: dos reglas de la misma planta pueden tener frecuencias distintas, así que una
 * corrida que abre la mensual de agosto y el trimestre que empieza en agosto produce dos
 * períodos que no terminan el mismo día. Un `period_start` al tope tendría que mentir
 * sobre uno de los dos.
 *
 * Lo que queda arriba es `opened_for_month`: el mes que la corrida estaba resolviendo, que
 * es lo que la deduplicación usa como clave y lo que la tarjeta lee para titular. No es el
 * período de nadie en particular — es la corrida.
 */
export const inspectionPeriodOpenedPayloadSchema = z.strictObject({
  opened_for_month: z.iso.date(),
  opened: z.array(
    z.strictObject({
      scheduled_inspection_id: z.uuid(),
      template_id: z.uuid(),
      template_name: z.string().min(1),
      inspector_id: z.uuid().nullable(),
      period_start: z.iso.date(),
      period_end: z.iso.date(),
      period_months: periodMonthsSchema,
    }),
  ),
});

export type InspectionPeriodOpenedPayload = z.infer<typeof inspectionPeriodOpenedPayloadSchema>;

/**
 * El payload de `corrective_action_assigned`: qué te tocó y para cuándo.
 *
 * Lleva `due_at` y no solo el id porque la bandeja tiene que poder decir "vence el
 * 17" sin ir a buscar la acción, que es la diferencia entre una notificación que
 * sirve y un aviso de que hay algo que mirar.
 */
export const correctiveActionAssignedPayloadSchema = z.strictObject({
  action_id: z.uuid(),
  finding_id: z.uuid(),
  description: z.string().min(1),
  severity: severitySchema,
  due_at: z.iso.datetime({ offset: true }),
});

export type CorrectiveActionAssignedPayload = z.infer<
  typeof correctiveActionAssignedPayloadSchema
>;

/**
 * El payload de los dos escalamientos de §3 R3.
 *
 * Los dos niveles comparten forma —cambia quién lo recibe, no qué dice— pero son
 * dos `kind` distintos y no uno con un campo `level`: quién recibe qué es la
 * decisión de R3, y un solo `kind` haría que la bandeja de gerencia y la del
 * supervisor se distingan por el contenido en vez de por el destinatario.
 */
export const correctiveActionOverduePayloadSchema = z.strictObject({
  action_id: z.uuid(),
  finding_id: z.uuid(),
  description: z.string().min(1),
  assignee_person_id: z.uuid(),
  due_at: z.iso.datetime({ offset: true }),
  days_overdue: z.number().int().min(0),
});

export type CorrectiveActionOverduePayload = z.infer<typeof correctiveActionOverduePayloadSchema>;

/**
 * El payload de `incident_reported`: qué pasó, dónde y de qué gravedad. §3 R4 pide
 * que el sistema notifique al coordinador de HS.
 *
 * **No lleva el nombre ni el número de empleado del sujeto, y esa ausencia es el
 * requisito** (design D11). `notification` no tiene la política de visibilidad
 * angosta del incidente —la lee su destinatario y punto—, así que un payload con la
 * identidad de la persona accidentada saltearía por una tabla adyacente la regla RLS
 * que 0012 acaba de escribir. Seguir el enlace vuelve a pasar por la política, y a
 * quien no puede ver el incidente no le devuelve nada.
 *
 * Tampoco lleva narrativa, por lo mismo. Lleva la clasificación porque es lo que le
 * dice al coordinador si tiene que dejar lo que está haciendo.
 */
export const incidentReportedPayloadSchema = z.strictObject({
  incident_id: z.uuid(),
  classification: incidentClassificationSchema,
  occurred_at: z.iso.datetime({ offset: true }),
  reported_at: z.iso.datetime({ offset: true }),
});

export type IncidentReportedPayload = z.infer<typeof incidentReportedPayloadSchema>;

/**
 * **La notificación, discriminada por `kind`.**
 *
 * Hasta la etapa 5 hubo un solo `kind` y el `payload` tenía una sola forma. Ahora
 * son cinco, y el comentario de arriba —"el consumidor tiene que saber leer el
 * payload"— se cobra acá: una unión discriminada hace que agregar un `kind` sin
 * decir cómo se lee sea un error de compilación en la UI, y que un `kind`
 * desconocido llegado de la base falle ruidoso al parsear en vez de renderizar una
 * tarjeta vacía.
 *
 * **BREAKING**: `Notification['payload']` ya no es `InspectionPeriodOpenedPayload`.
 * Quien lo lea tiene que estrechar por `kind` primero.
 */
const notificationBase = {
  id: z.uuid(),
  site_id: z.uuid(),
  created_at: z.iso.datetime({ offset: true }),
  read_at: z.iso.datetime({ offset: true }).nullable(),
};

export const notificationSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...notificationBase,
    kind: z.literal('inspection_period_opened'),
    payload: inspectionPeriodOpenedPayloadSchema,
  }),
  z.strictObject({
    ...notificationBase,
    kind: z.literal('corrective_action_assigned'),
    payload: correctiveActionAssignedPayloadSchema,
  }),
  z.strictObject({
    ...notificationBase,
    kind: z.literal('corrective_action_overdue_supervisor'),
    payload: correctiveActionOverduePayloadSchema,
  }),
  z.strictObject({
    ...notificationBase,
    kind: z.literal('corrective_action_overdue_management'),
    payload: correctiveActionOverduePayloadSchema,
  }),
  z.strictObject({
    ...notificationBase,
    kind: z.literal('incident_reported'),
    payload: incidentReportedPayloadSchema,
  }),
]);

export type Notification = z.infer<typeof notificationSchema>;
