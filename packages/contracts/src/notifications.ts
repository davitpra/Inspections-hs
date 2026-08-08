import { z } from 'zod';

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
export const NOTIFICATION_KINDS = ['inspection_period_opened'] as const;

export const notificationKindSchema = z.enum(NOTIFICATION_KINDS);

export type NotificationKind = z.infer<typeof notificationKindSchema>;

/** El payload de `inspection_period_opened`: qué período se abrió y con qué. */
export const inspectionPeriodOpenedPayloadSchema = z.strictObject({
  period_start: z.iso.date(),
  period_end: z.iso.date(),
  opened: z.array(
    z.strictObject({
      scheduled_inspection_id: z.uuid(),
      template_id: z.uuid(),
      template_name: z.string().min(1),
      inspector_id: z.uuid().nullable(),
    }),
  ),
});

export type InspectionPeriodOpenedPayload = z.infer<typeof inspectionPeriodOpenedPayloadSchema>;

export const notificationSchema = z.strictObject({
  id: z.uuid(),
  site_id: z.uuid(),
  kind: notificationKindSchema,
  payload: inspectionPeriodOpenedPayloadSchema,
  created_at: z.iso.datetime({ offset: true }),
  read_at: z.iso.datetime({ offset: true }).nullable(),
});

export type Notification = z.infer<typeof notificationSchema>;
