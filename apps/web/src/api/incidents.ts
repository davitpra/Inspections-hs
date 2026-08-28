import {
  incidentListSchema,
  incidentSchema,
  type Form7Mapping,
  type Incident,
  type IncidentTransitionRequest,
  type RecordCauseRequest,
  type ReportIncidentRequest,
} from '@hs/contracts';
import { z } from 'zod';

import { get, post } from './request';

/**
 * El cliente de incidentes (etapa 6).
 *
 * Lo que vuelve se parsea contra el contrato (ver `request.ts`): una clasificación o un
 * `kind` que el servidor tenga y el cliente no —una migración a medio desplegar— falla
 * donde alguien lo ve.
 *
 * **Esto es ONLINE, y sin Dexie ni outbox** (design D14). Un accidente se reporta desde
 * una oficina o un teléfono con señal; el offline existe porque una inspección ocurre en
 * 48 acres sin cobertura, y cargar un incidente no tiene esa restricción. Un incidente
 * esperando sincronización sería además peor que uno cargado veinte minutos más tarde:
 * los relojes del MLITSD corren desde el evento y un reporte demorado en un dispositivo
 * sería invisible para todos mientras tanto.
 *
 * **No hay función para subir una foto, y esa ausencia es deliberada**: el incidente no
 * acepta adjuntos. La evidencia de la remediación vive en las acciones correctivas de la
 * investigación, que sí las tienen.
 */

export async function listIncidents(): Promise<Incident[]> {
  return get('/incidents', (value) => incidentListSchema.parse(value));
}

export async function getIncident(id: string): Promise<Incident> {
  return get(`/incidents/${id}`, (value) => incidentSchema.parse(value));
}

export async function reportIncident(body: ReportIncidentRequest): Promise<Incident> {
  return post('/incidents', body, (value) => incidentSchema.parse(value));
}

export async function transitionIncident(
  id: string,
  body: IncidentTransitionRequest,
): Promise<Incident> {
  return post(`/incidents/${id}/transitions`, body, (value) => incidentSchema.parse(value));
}

export async function recordCause(id: string, body: RecordCauseRequest): Promise<Incident> {
  return post(`/incidents/${id}/investigation/causes`, body, (value) =>
    incidentSchema.parse(value),
  );
}

const form7ResponseSchema = z.object({
  incident: incidentSchema,
  mapping: z.array(
    z.object({
      label: z.string(),
      source: z.string().nullable(),
      notStored: z.literal(true).optional(),
      note: z.string().optional(),
    }),
  ),
});

/**
 * Los valores del incidente mapeados al Form 7.
 *
 * **No descarga nada.** Es una pantalla de solo lectura con copiar-al-portapapeles
 * (riesgo H, cerrado en v1.2): el sistema no genera el PDF oficial y no envía nada al
 * WSIB.
 */
export async function getForm7(
  id: string,
): Promise<{ incident: Incident; mapping: Form7Mapping }> {
  return get(`/incidents/${id}/form7`, (value) => {
    const parsed = form7ResponseSchema.parse(value);

    return { incident: parsed.incident, mapping: parsed.mapping as Form7Mapping };
  });
}

/**
 * Una acción correctiva colgada de una investigación (§4, el segundo padre).
 *
 * Vive acá y no en `api/actions.ts` porque la ruta es del incidente; el recurso que
 * devuelve sigue siendo una acción y el que la avanza sigue siendo el cliente de
 * acciones.
 */
export async function createInvestigationAction(
  investigationId: string,
  body: {
    assignee_person_id: string;
    description: string;
    due_at: string;
    remediation_group_id?: string;
  },
): Promise<unknown> {
  return post(`/investigations/${investigationId}/actions`, body, (value) => value);
}

export type { Incident };
