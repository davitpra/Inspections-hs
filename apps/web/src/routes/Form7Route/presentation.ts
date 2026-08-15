import type { Form7Field, Incident } from '@hs/contracts';

import {
  BODY_PART_LABELS,
  CLASSIFICATION_LABELS,
  TREATMENT_LABELS,
  formatInstant,
} from '../incident-presentation';

/**
 * El valor de un campo del Form 7, sacado del incidente.
 *
 * Un campo cuya fuente no existía en la versión de este incidente devuelve la constancia
 * de eso y no una cadena vacía, por lo mismo que en el detalle: en un registro inmutable
 * "no aplicaba" y "no existía" son dos cosas distintas.
 */
export function valueOf(incident: Incident, field: Form7Field): string {
  if (field.source === null) return '';

  if (
    field.source !== 'classification' &&
    field.source !== 'subject_person' &&
    field.source !== 'site' &&
    !(incident.fields_of_version as readonly string[]).includes(field.source)
  ) {
    return 'This field did not exist in this version of the form.';
  }

  switch (field.source) {
    case 'classification':
      return CLASSIFICATION_LABELS[incident.classification];
    case 'subject_person':
      return incident.subject_person_id;
    case 'site':
      return incident.site_id;
    case 'occurred_at':
      return formatInstant(incident.occurred_at);
    case 'location_id':
      return incident.location_id;
    case 'task_performed':
      return incident.task_performed;
    case 'equipment_involved':
      return incident.equipment_involved;
    case 'what_happened':
      return incident.what_happened;
    case 'body_part':
      return BODY_PART_LABELS[incident.body_part];
    case 'on_site_treatment':
      return TREATMENT_LABELS[incident.on_site_treatment];
    case 'immediate_action':
      return incident.immediate_action;
    case 'witnesses':
      return incident.witnesses
        .map((witness) => `${witness.first_name} ${witness.last_name} (${witness.employee_number})`)
        .join(', ');
    default:
      return '';
  }
}
