import {
  inspectionScheduleSchema,
  inspectorOptionSchema,
  scheduledInspectionSchema,
  siteSchema,
  templateOptionSchema,
  type InspectionSchedule,
  type InspectorOption,
  type ScheduledInspection,
  type Site,
  type TemplateOption,
} from '@hs/contracts';
import { z } from 'zod';

import { get, send } from './request';

/**
 * El cliente de la consola de programación.
 *
 * Lo que vuelve se parsea contra el contrato, por lo mismo que en el resto (ver
 * `request.ts`).
 *
 * ONLINE, y fuera de Dexie y del service worker. La razón general es la de siempre —se
 * planifica sentado y con conexión, no en 48 acres sin señal—, pero hay una propia y más
 * fuerte: **una asignación en cola sería un inspector que no sabe que fue asignado.** El
 * offline existe para que el trabajo de campo no se pierda; encolar una decisión de
 * coordinación no protege nada y esconde el estado real.
 */

// ---------------------------------------------------------------------------
// Las lecturas de apoyo: lo que convierte identificadores en nombres.

/** Las plantas del alcance de la sesión. No lleva parámetros: el alcance no se pide. */
export async function listSites(): Promise<Site[]> {
  return get('/sites', (value) => z.array(siteSchema).parse(value));
}

/** Las plantillas con versión publicada, a la versión que la programación congelaría. */
export async function listTemplates(): Promise<TemplateOption[]> {
  return get('/templates', (value) => z.array(templateOptionSchema).parse(value));
}

/**
 * A quién se le puede asignar una inspección en esa planta.
 *
 * Es la MISMA regla que valida la asignación, resuelta en el servidor: lo que esta lista
 * devuelve, `assignInspector` lo acepta. Por eso el selector puede ofrecer estas opciones
 * sin comprobar nada por su cuenta.
 */
export async function listInspectorCandidates(siteId: string): Promise<InspectorOption[]> {
  return get(`/inspector-candidates?site_id=${encodeURIComponent(siteId)}`, (value) =>
    z.array(inspectorOptionSchema).parse(value),
  );
}

// ---------------------------------------------------------------------------
// Las reglas de recurrencia.

export async function listSchedules(): Promise<InspectionSchedule[]> {
  return get('/inspection-schedules', (value) =>
    z.array(inspectionScheduleSchema).parse(value),
  );
}

export async function createSchedule(body: {
  site_id: string;
  template_id: string;
  default_inspector_id?: string | null;
}): Promise<InspectionSchedule> {
  return send('POST', '/inspection-schedules', body, (value) =>
    inspectionScheduleSchema.parse(value),
  );
}

/**
 * Lo único que se puede cambiar de una regla: el inspector por defecto, y si sigue
 * abriendo períodos. No se borra nunca — desactivar es el verbo.
 */
export async function updateSchedule(
  id: string,
  body: { default_inspector_id?: string | null; deactivated?: boolean },
): Promise<InspectionSchedule> {
  return send('PATCH', `/inspection-schedules/${id}`, body, (value) =>
    inspectionScheduleSchema.parse(value),
  );
}

// ---------------------------------------------------------------------------
// Las inspecciones programadas.

export async function listScheduled(): Promise<ScheduledInspection[]> {
  return get('/scheduled-inspections', (value) =>
    z.array(scheduledInspectionSchema).parse(value),
  );
}

export async function assignInspector(
  id: string,
  inspectorId: string,
): Promise<ScheduledInspection> {
  return send(
    'PATCH',
    `/scheduled-inspections/${id}/inspector`,
    { inspector_id: inspectorId },
    (value) => scheduledInspectionSchema.parse(value),
  );
}

/** Cancelar exige motivo y no se deshace: un período no se des-cancela, se reprograma. */
export async function cancelScheduledInspection(
  id: string,
  reason: string,
): Promise<ScheduledInspection> {
  return send('POST', `/scheduled-inspections/${id}/cancel`, { reason }, (value) =>
    scheduledInspectionSchema.parse(value),
  );
}

export type { InspectionSchedule, InspectorOption, ScheduledInspection, Site, TemplateOption };
