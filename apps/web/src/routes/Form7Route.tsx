import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import type { Form7Field, Incident } from '@hs/contracts';

import { getForm7 } from '../api/incidents';
import {
  BODY_PART_LABELS,
  CLASSIFICATION_LABELS,
  TREATMENT_LABELS,
  formatInstant,
} from './incident-presentation';

/**
 * Los valores del incidente mapeados a los campos del Form 7 del WSIB.
 *
 * **Solo lectura, con copiar-al-portapapeles, y sin PDF** (riesgo H, cerrado en v1.2).
 * Generar el formulario oficial crearía una obligación de mantenimiento permanente sobre
 * un formato que no controlamos y el riesgo de producir un documento desactualizado con
 * apariencia de oficial. El coordinador entra al portal del WSIB de todas formas: lo que
 * esta pantalla le ahorra es transcribir de memoria.
 *
 * **Los campos que el sistema no almacena se muestran etiquetados como tales, no
 * vacíos.** Vacío se lee como "no hubo"; "no almacenado" dice la verdad —hay que
 * buscarlo en otro lado— y deja constancia de que la ausencia es una decisión de alcance
 * y no un olvido (riesgo G-bis).
 *
 * El mapeo sale del `form_version` de ESTE incidente, así que uno viejo se renderiza con
 * el conjunto de campos que tenía.
 */
export function Form7Route(): React.JSX.Element {
  const { id } = useParams({ from: '/incidents/$id/form7' });
  const [copied, setCopied] = useState<string | null>(null);

  const form7 = useQuery({
    queryKey: ['form7', id],
    queryFn: () => getForm7(id),
    retry: false,
  });

  if (form7.isError) return <p className="notice">This screen needs a connection.</p>;
  if (!form7.data) return <p>Loading…</p>;

  const { incident, mapping } = form7.data;

  const copy = async (label: string, text: string): Promise<void> => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
  };

  const everything = mapping
    .filter((field) => !field.notStored)
    .map((field) => `${field.label}: ${valueOf(incident, field)}`)
    .join('\n');

  return (
    <>
      <h1>WSIB Form 7 — fields</h1>

      <p className="notice">
        This is a read-only view of what the platform holds, laid out the way the Form 7 asks
        for it. Nothing is filed from here: you file the form in the WSIB portal. Form version{' '}
        {incident.form_version}.
      </p>

      <button type="button" onClick={() => void copy('all', everything)}>
        Copy everything the system holds
      </button>

      <dl>
        {mapping.map((field) => (
          <div key={field.label}>
            <dt>{field.label}</dt>
            <dd>
              {field.notStored ? (
                <>
                  <em>Not held by this system.</em>
                  {field.note ? <p>{field.note}</p> : null}
                </>
              ) : (
                <>
                  <span>{valueOf(incident, field)}</span>
                  <button
                    type="button"
                    onClick={() => void copy(field.label, valueOf(incident, field))}
                  >
                    Copy
                  </button>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>

      {copied ? <p>Copied {copied === 'all' ? 'all fields' : copied}.</p> : null}
    </>
  );
}

/**
 * El valor de un campo del Form 7, sacado del incidente.
 *
 * Un campo cuya fuente no existía en la versión de este incidente devuelve la constancia
 * de eso y no una cadena vacía, por lo mismo que en el detalle: en un registro inmutable
 * "no aplicaba" y "no existía" son dos cosas distintas.
 */
function valueOf(incident: Incident, field: Form7Field): string {
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
