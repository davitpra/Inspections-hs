import type {
  BodyPart,
  ClockObligation,
  Incident,
  IncidentClassification,
  IncidentState,
  OnSiteTreatment,
  RegulatoryClockDto,
} from '@hs/contracts';

import { formatInstant } from './dates';

/**
 * Cómo se nombra cada cosa en las pantallas de incidentes.
 *
 * Aparte del componente para que se pueda probar sin renderizar.
 *
 * **Toda la interfaz es en inglés** (§1). Que un incidente guarde su narrativa en
 * español no localiza nada: es un dato sobre el texto, no una preferencia de interfaz.
 */

/** El estado en palabras. Sale del stream del servidor; la UI no lo deriva. */
export const INCIDENT_STATE_LABELS: Readonly<Record<IncidentState, string>> = {
  reported: 'Reported',
  under_investigation: 'Under investigation',
  closed: 'Closed',
};

/**
 * El texto del botón por PAR y no por destino, por lo mismo que en acciones:
 * `reported → closed` y `under_investigation → closed` llegan al mismo estado y son
 * cosas distintas — "cerrar sin investigar" y "cerrar la investigación".
 */
export const INCIDENT_TRANSITION_LABELS: Readonly<Record<string, string>> = {
  'reported->under_investigation': 'Open an investigation',
  'reported->closed': 'Close without investigating',
  'under_investigation->closed': 'Close the investigation',
  'closed->under_investigation': 'Reopen',
};

export function incidentTransitionLabel(from: IncidentState, to: IncidentState): string {
  return INCIDENT_TRANSITION_LABELS[`${from}->${to}`] ?? INCIDENT_STATE_LABELS[to];
}

export const CLASSIFICATION_LABELS: Readonly<Record<IncidentClassification, string>> = {
  first_aid: 'First aid',
  health_care: 'Health care',
  lost_time_or_modified_work: 'Lost time or modified work',
  critical_injury: 'Critical injury',
  occupational_illness: 'Occupational illness',
};

export const BODY_PART_LABELS: Readonly<Record<BodyPart, string>> = {
  head: 'Head',
  eye: 'Eye',
  face: 'Face',
  neck: 'Neck',
  shoulder: 'Shoulder',
  arm_or_elbow: 'Arm or elbow',
  hand_or_finger: 'Hand or finger',
  back: 'Back',
  torso: 'Torso',
  hip_or_groin: 'Hip or groin',
  leg_or_knee: 'Leg or knee',
  foot_or_toe: 'Foot or toe',
  multiple: 'Multiple',
  not_applicable: 'Not applicable',
};

export const TREATMENT_LABELS: Readonly<Record<OnSiteTreatment, string>> = {
  none: 'None',
  first_aid_on_site: 'First aid on site',
  sent_to_clinic: 'Sent to a clinic',
  sent_to_hospital: 'Sent to hospital',
  emergency_services_called: 'Emergency services called',
  sent_home: 'Sent home',
};

/**
 * Qué obligación es cada reloj, en palabras.
 *
 * El texto dice **qué hay que hacer**, no solo cómo se llama la regla: quien mira esta
 * pantalla acaba de enterarse de que alguien se lastimó y necesita saber qué le toca.
 */
export const OBLIGATION_LABELS: Readonly<Record<ClockObligation, string>> = {
  mlitsd_immediate_notice: 'Notify the Ministry immediately, by phone or other direct means',
  mlitsd_written_report: 'Send the Ministry a written report',
  mlitsd_written_notice: 'Send written notice to the JHSC and the union',
  wsib_form7: 'File the WSIB Form 7',
};

/**
 * Cómo se lee un reloj: su plazo, o que es inmediato.
 *
 * **Un reloj vencido se muestra vencido y no se esconde.** Una cuenta administrativa que carga el
 * lunes un accidente del martes anterior tiene obligaciones del MLITSD ya pasadas, y
 * ocultarlas sería peor que mostrarlas: quien tiene que responder ante el organismo
 * necesita saberlo hoy, no descubrirlo en una auditoría.
 */
export function clockStatus(clock: RegulatoryClockDto): string {
  if (clock.immediate) return 'Immediately';
  if (clock.due_at === null) return 'No deadline recorded';

  return `${clock.overdue ? 'Was due' : 'Due'} ${formatInstant(clock.due_at)}`;
}

/** El origen de un reloj, dicho en voz alta porque los dos no cuentan de lo mismo. */
export function clockOrigin(clock: RegulatoryClockDto): string {
  return clock.counts_from === 'occurrence'
    ? 'counted from when it happened'
    : 'counted from when it was reported';
}

/**
 * Si un campo existía en la versión del formulario de ESTE incidente.
 *
 * Lo que hace que la pantalla pueda decir "este campo no existía cuando se escribió"
 * en vez de mostrarlo vacío — que en un registro inmutable son dos cosas distintas y no
 * se pueden distinguir después (pregunta cerrada 10).
 */
export function hadField(incident: Incident, field: string): boolean {
  return (incident.fields_of_version as readonly string[]).includes(field);
}
