import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  BODY_PARTS,
  INCIDENT_CLASSIFICATIONS,
  NARRATIVE_LANGUAGES,
  ON_SITE_TREATMENTS,
  reportIncidentRequestSchema,
  type ReportIncidentRequest,
} from '@hs/contracts';

import { reportIncident } from '../../api/incidents';
import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { canReportIncident } from '../../permissions/incidents';
import { BODY_PART_LABELS, CLASSIFICATION_LABELS, TREATMENT_LABELS } from '../../presentation/incidents';
import { LocationPicker } from './LocationPicker';
import { PersonPicker } from './PersonPicker';

/**
 * Cargar un incidente en tercera persona (§3 R4).
 *
 * **Nueve campos cortos y ningún cuadro de texto libre único**, que es exactamente el
 * objetivo del cambio: "un campo corto y concreto es mucho más fácil de completar bien
 * para quien no escribe cómodo en inglés que un cuadro que dice «describa el
 * incidente»".
 *
 * **El selector de personas muestra número de empleado y nombre, y nada más.** §4 dice
 * que quien reporta elige a la persona afectada sin poder ver su perfil, y esta pantalla
 * es donde esa regla se ve o no se ve.
 *
 * **No hay campo de foto ni de adjunto, y no es un olvido**: la foto de una persona
 * accidentada es detalle clínico por otra puerta. Tampoco hay campo de diagnóstico, de
 * parte médico ni de restricción funcional — la parte del cuerpo es una categoría gruesa
 * y ahí termina lo que el sistema guarda.
 *
 * **Esto es online.** No hay outbox: un accidente se carga desde una oficina o un
 * teléfono con señal, y un reporte esperando sincronización sería invisible mientras los
 * plazos del MLITSD ya corren.
 */
export function ReportIncidentRoute(): React.JSX.Element {
  const { account } = useAppSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<Partial<ReportIncidentRequest>>({
    classification: 'first_aid',
    body_part: 'not_applicable',
    on_site_treatment: 'none',
    narrative_language: 'en',
    witness_person_ids: [],
  });
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      // Se valida contra el MISMO esquema que el servidor va a parsear. Un formulario
      // que arma el cuerpo a mano y confía en el servidor para las reglas de forma es un
      // formulario que muestra el error tarde y en peor idioma.
      const parsed = reportIncidentRequestSchema.parse(form);

      return reportIncident(parsed);
    },
    onSuccess: (incident) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.incidents() });
      void navigate({ to: '/incidents/$id', params: { id: incident.id } });
    },
    onError: (caught: Error) => setError(caught.message),
  });

  const set = <K extends keyof ReportIncidentRequest>(
    key: K,
    value: ReportIncidentRequest[K],
  ): void => setForm((previous) => ({ ...previous, [key]: value }));

  if (!canReportIncident(account)) {
    return (
      <>
        <h1>Report an incident</h1>
        <p className="notice">Only H&amp;S coordinators and management can report incidents.</p>
      </>
    );
  }

  return (
    <>
      <h1>Report an incident</h1>

      <p className="notice">
        You are reporting about somebody else. Pick the affected person from the list — you
        will not see their profile, and they do not need an account. Do not record a
        diagnosis, a medical report or any work restriction: this system stores the category
        of the event and nothing about the injury itself.
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          submit.mutate();
        }}
      >
        <label>
          Affected person
          <PersonPicker
            value={form.subject_person_id ?? ''}
            onChange={(value) => set('subject_person_id', value)}
          />
        </label>

        <label>
          Classification
          <select
            value={form.classification}
            onChange={(event) =>
              set('classification', event.target.value as ReportIncidentRequest['classification'])
            }
          >
            {/* Cinco, y no hay una sexta: `near_miss` no está y esa ausencia es el
                requisito. Un casi-accidente se carga como hallazgo manual. */}
            {INCIDENT_CLASSIFICATIONS.map((classification) => (
              <option key={classification} value={classification}>
                {CLASSIFICATION_LABELS[classification]}
              </option>
            ))}
          </select>
        </label>

        <label>
          When it happened
          <input
            type="datetime-local"
            onChange={(event) =>
              set('occurred_at', new Date(event.target.value).toISOString())
            }
          />
        </label>

        <label>
          Where
          <LocationPicker
            value={form.location_id ?? ''}
            onChange={(value) => set('location_id', value)}
          />
        </label>

        <label>
          What was the person doing
          <input
            value={form.task_performed ?? ''}
            onChange={(event) => set('task_performed', event.target.value)}
          />
        </label>

        <label>
          Equipment or material involved
          <input
            value={form.equipment_involved ?? ''}
            onChange={(event) => set('equipment_involved', event.target.value)}
          />
        </label>

        <label>
          What happened
          <input
            value={form.what_happened ?? ''}
            onChange={(event) => set('what_happened', event.target.value)}
          />
        </label>

        <label>
          Part of the body affected
          <select
            value={form.body_part}
            onChange={(event) =>
              set('body_part', event.target.value as ReportIncidentRequest['body_part'])
            }
          >
            {BODY_PARTS.map((part) => (
              <option key={part} value={part}>
                {BODY_PART_LABELS[part]}
              </option>
            ))}
          </select>
        </label>

        <label>
          Treatment at the workplace
          <select
            value={form.on_site_treatment}
            onChange={(event) =>
              set(
                'on_site_treatment',
                event.target.value as ReportIncidentRequest['on_site_treatment'],
              )
            }
          >
            {ON_SITE_TREATMENTS.map((treatment) => (
              <option key={treatment} value={treatment}>
                {TREATMENT_LABELS[treatment]}
              </option>
            ))}
          </select>
        </label>

        <label>
          What was done straight away
          <input
            value={form.immediate_action ?? ''}
            onChange={(event) => set('immediate_action', event.target.value)}
          />
        </label>

        <label>
          {/* Riesgo G: si quien reporta escribe en español, el registro conserva sus
              palabras exactas y anota el idioma. No hay traducción. */}
          Language you wrote in
          <select
            value={form.narrative_language}
            onChange={(event) =>
              set(
                'narrative_language',
                event.target.value as ReportIncidentRequest['narrative_language'],
              )
            }
          >
            {NARRATIVE_LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {language === 'en' ? 'English' : 'Spanish'}
              </option>
            ))}
          </select>
        </label>

        <button type="submit" disabled={submit.isPending}>
          Report
        </button>
      </form>

      {error ? <p className="notice">{error}</p> : null}
    </>
  );
}
