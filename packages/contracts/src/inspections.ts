import { z } from 'zod';

import { periodMonthsSchema, periodStatusSchema } from './compliance.js';

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
 *
 * **El `status` y la FRECUENCIA se importan de `compliance.js` y no se redefinen acá.** Los cuatro
 * estados son uno solo en todo el sistema: si el listado tuviera su propio enum,
 * tendríamos dos definiciones de lo mismo y la que lleva digest sería la que envejece.
 * La dirección del import es la única acíclica —`compliance.ts` no conoce este archivo—
 * y conviene que siga así. `periodMonthsSchema` llegó en 0029 por el mismo camino y por
 * la misma razón: viaja dentro del payload que se hashea.
 */

const reasonSchema = z.string().trim().min(1).max(500);

/** El período: siempre el primer día de un mes. */
export const periodStartSchema = z
  .iso
  .date()
  .refine((value) => value.endsWith('-01'), 'period_start: el primer día del mes');

/** El mes en el que la serie de una regla empieza. Para una mensual no significa nada. */
export const anchorMonthSchema = z.number().int().min(1).max(12);

/**
 * La regla de recurrencia. Una regla activa por planta y plantilla significa que esa
 * planta debe una inspección de esa plantilla cada `frequency_months` meses, contados
 * desde `anchor_month`.
 */
export const inspectionScheduleSchema = z.strictObject({
  id: z.uuid(),
  site_id: z.uuid(),
  template_id: z.uuid(),
  template_name: z.string().min(1),
  frequency_months: periodMonthsSchema,
  anchor_month: anchorMonthSchema,
  default_inspector_id: z.uuid().nullable(),
  /** Ver `inspector_name` en `scheduledInspectionSchema`: mismo criterio, mismo nulo. */
  default_inspector_name: z.string().nullable(),
  /** Desde cuándo la regla debe períodos — el otro extremo de la ventana que cierra `deactivated_at`. */
  created_at: z.iso.datetime({ offset: true }),
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

  /** Mensual si no se dice otra cosa: es el default del dominio, no un relleno. */
  frequency_months: periodMonthsSchema.optional(),

  /**
   * OPCIONAL A PROPÓSITO, y cuando falta **lo resuelve el servidor** con el mes civil de
   * Ontario. El cliente no tiene por qué saber la zona de la planta, y si la calculara
   * con el reloj del dispositivo una regla creada el 31 a las 21:00 nacería anclada al
   * mes siguiente.
   */
  anchor_month: anchorMonthSchema.optional(),
});

export type CreateInspectionSchedule = z.infer<typeof createInspectionScheduleSchema>;

/**
 * Lo único que se puede cambiar de una regla: a quién le toca por defecto, y si sigue
 * abriendo períodos. `site_id` y `template_id` no están — una regla no se muda de
 * planta ni de plantilla, se desactiva y se crea otra.
 *
 * **`frequency_months` y `anchor_month` tampoco están, y ahí el motivo es más fuerte que
 * la coherencia.** El CTE `owed` del reporte de cumplimiento no cuenta las inspecciones
 * que existen: GENERA los períodos que el sitio DEBÍA a partir de la regla. Cambiarle la
 * frecuencia a una regla viva no cambiaría el futuro, reescribiría el pasado — un año que
 * se reportó como «12 de 12» pasaría a leerse «4 de 12» sin que nadie tocara una
 * inspección. Desactivar y crear otra deja las dos ventanas contiguas, que es lo que el
 * reporte necesita para decir la verdad sobre los dos tramos.
 *
 * El motor lo hace cumplir por partida doble (0029): fuera del `GRANT UPDATE` y dentro
 * del array `frozen` del trigger de guarda.
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
  /**
   * Cuánto dura ESTE período, copiado de la regla al abrirlo.
   *
   * Viaja hasta acá y no se deduce de la regla porque la pantalla tiene que poder
   * escribir «Q1 2026» sobre una fila cuya regla quizás ya se desactivó — y porque la
   * regla de hoy puede tener otra frecuencia que la que abrió esta fila.
   */
  period_months: periodMonthsSchema,
  period_end: z.iso.date(),
  template_id: z.uuid(),
  template_name: z.string().min(1),
  template_version_id: z.uuid(),
  template_version: z.int().positive(),
  inspector_id: z.uuid().nullable(),
  /**
   * El nombre del asignado, resuelto por el servidor.
   *
   * NULO POR DOS MOTIVOS DISTINTOS y conviene no confundirlos: o la inspección no tiene
   * inspector —y entonces `inspector_id` también es nulo—, o lo tiene pero su fila de
   * `person` no es visible para quien lee. `person` está aislada por sitio y su
   * `site_id` es una columna propia y mutable, distinta del alcance de la cuenta, así
   * que un asignado legítimo puede tener la persona en la otra planta. El nombre falta;
   * la asignación no.
   *
   * SE RESUELVE EN EL SERVIDOR y no contra la lista de candidatos, porque una
   * asignación es un hecho histórico: al asignado que se desactivó o perdió el alcance
   * hay que seguir nombrándolo, y justamente ya no está entre los candidatos.
   */
  inspector_name: z.string().nullable(),
  scheduled_at: z.iso.datetime({ offset: true }),
  /** `null` es el trabajo automático: el calendario, no una persona. */
  scheduled_by: z.uuid().nullable(),
  cancelled_at: z.iso.datetime({ offset: true }).nullable(),
  cancellation_reason: z.string().nullable(),
  /**
   * El estado del período, derivado por el motor y nunca almacenado. Acompaña a la
   * inspección donde sea que se liste — no solo dentro del reporte de cobertura, que
   * exige un sitio y un rango de meses enteros.
   */
  status: periodStatusSchema,
  /**
   * El envío que cerró el período, cuando existe. Nulo en la mayoría de las filas: es el
   * `LEFT JOIN` del que ya sale `status`, leído una vez más.
   *
   * Viaja aunque todavía nadie lo lea. Es el asa con la que se va a pedir el reporte de
   * una inspección enviada, y agregarlo después sería romper el contrato dos veces por la
   * misma consulta.
   */
  inspection_id: z.uuid().nullable(),
  /**
   * Cuándo se cerró, y **cuál de los dos relojes es**.
   *
   * Es `inspection.signed_at`: el instante en que el inspector FIRMÓ el recorrido, tomado
   * del reloj del dispositivo. NO es `received_at`, que es cuando el servidor lo recibió.
   * Los dos se separan por todo lo que el dispositivo haya estado sin señal —hasta los
   * siete días que presupone ADR-010—, y el mes es lo que identifica la obligación ante el
   * regulador: una inspección caminada y firmada el 29 de marzo que sincroniza el 2 de
   * abril se fecha en marzo, que es cuando pasó.
   *
   * Es el mismo instante que `compliance.sql.ts` llama `occurred_at` y que heredan los
   * hallazgos derivados del envío. Que sea un reloj de dispositivo se dice acá a propósito:
   * quien lea `completed_at` sin saberlo va a suponer que es del servidor.
   */
  completed_at: z.iso.datetime({ offset: true }).nullable(),
});

export type ScheduledInspection = z.infer<typeof scheduledInspectionSchema>;

/**
 * Programación fuera del calendario. La versión NO viaja: la resuelve el servidor
 * como la más alta publicada de la plantilla, en el momento de programar. Dejar que
 * el cliente la eligiera abriría la puerta a abrir una inspección contra una versión
 * vieja sin que quede registrado que fue una decisión.
 *
 * **`period_months` tampoco viaja, y por el mismo motivo**: lo resuelve el servidor con la
 * frecuencia de la regla activa de esa planta y plantilla, y mensual si no hay regla. Si
 * lo eligiera el cliente, reprogramar un trimestre cancelado podría producir un período de
 * un mes que se solapa con el resto de la serie sin que nadie lo haya decidido.
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
  /** El largo del período, para que la pantalla diga «Q1 2026» y no «January». */
  period_months: periodMonthsSchema,
  period_end: z.iso.date(),
  template_name: z.string().min(1),
  template_version_id: z.uuid(),
  /** La versión a la que esta inspección está atada. */
  template_version: z.int().positive(),
  /** Lectura de lo publicado hoy; no es una promesa hasta que alguien avanza. */
  latest_template_version: z.int().positive(),
  /** Lectura de lo publicado hoy; la inspección no queda atada sin un avance explícito. */
  latest_template_version_id: z.uuid(),
  overdue: z.boolean(),
});

export type PendingInspection = z.infer<typeof pendingInspectionSchema>;

/**
 * Una cuenta elegible para recibir una inspección en una planta: `jhsc_member`, no
 * desactivada, con alcance vigente en ese sitio.
 *
 * **`id` es `app_user.id`, NO `person.id`.** Es lo que viaja como `inspector_id`, y es
 * la razón entera de que este esquema exista al lado de `personOptionSchema`, que tiene
 * los mismos cuatro campos: un selector armado sobre el id de persona daría 400 en cada
 * asignación, y el error no diría por qué. Los dos esquemas se parecen; lo que
 * identifican no.
 *
 * Sin `email` y sin `role`: el rol ya está implícito —si está en esta lista es
 * `jhsc_member`— y el correo no hace falta para elegir a alguien. Mismo criterio de
 * divulgación mínima que el roster del paquete de campo, que tampoco lleva perfil.
 *
 * Los tres campos de nombre son NULOS cuando la fila de `person` no es visible para
 * quien lee. La elegibilidad se define sobre `user_site_scope` y el nombre vive en
 * `person`, que está aislada por sitio: una cuenta elegible cuya persona está en la
 * otra planta se sigue ofreciendo, sin nombre. Perder el nombre es un problema de
 * presentación; perder la opción sería un problema de corrección.
 */
export const inspectorOptionSchema = z.strictObject({
  id: z.uuid(),
  employee_number: z.string().nullable(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
});

export type InspectorOption = z.infer<typeof inspectorOptionSchema>;
