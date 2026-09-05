import {
  transitionsFrom,
  type Action,
  type ActionState,
  type EvidenceInput,
  type Session,
} from '@hs/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { transitionAction, uploadEvidence } from '../../api/actions';
import { queryKeys } from '../../api/query-keys';
import { canAttempt } from '../../permissions/actions';
import { EvidencePicker } from './EvidencePicker';
import { stepForm, type StepFields } from './presentation';

/**
 * Los campos y los botones que avanzan una acción, sin el marco que los envuelve.
 *
 * `FindingNextStep` lo dibuja, a la vista, dentro de la ficha del hallazgo: la mutación, los
 * campos que la etapa exige y el rechazo del servidor quedan juntos para que el paso no tenga
 * dos implementaciones.
 *
 * **QUÉ SE MUESTRA EN CADA ETAPA —Y CUÁL SALIDA SE PLIEGA— LO DECIDE `stepForm`, no este
 * archivo.** Acá estaba escrito como tres predicados sueltos sobre la lista de transiciones
 * —uno de ellos con un estado literal adentro—, y con eso no había dónde leer "en Verification
 * se pide una razón y hay dos salidas": la respuesta solo existía dibujada. Ahora la decisión
 * tiene nombre, se prueba sin renderizar y este componente la lee. Lo único que este archivo
 * decide es CUÁL de las salidas plegadas está abierta, que es estado de la pantalla y de nada
 * más.
 *
 * Lo que sí vive acá es lo que solo se puede hacer contra el servidor: subir la evidencia
 * antes de la transición, invalidar lo que la transición movió y mostrar lo que el servidor
 * rechazó —la regla del verificador (ADR-019) se comprueba allá, y su error se lee acá—. Que
 * el confirmar del rechazo espere a que la razón tenga texto es comodidad por lo mismo: el
 * servidor la vuelve a exigir (`requires: ['reason']`).
 *
 * `action` pide solo lo que `canAttempt` y `transitionsFrom` necesitan, así que entra tanto un
 * `Action` completo como el `ActionSummary` sin eventos que trae el listado de la ruta.
 */
export function AdvanceActionForm({
  action,
  session,
  onDone,
}: {
  action: Pick<Action, 'id' | 'state' | 'assignee_person_id'>;
  session: Session | null;
  onDone?: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<{ kind: EvidenceInput['kind']; file: File }[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** La salida plegada que se está escribiendo, o `null` si ninguna. */
  const [opened, setOpened] = useState<ActionState | null>(null);

  const available = transitionsFrom(action.state).filter((transition) =>
    canAttempt(transition, action, session),
  );
  const form = stepForm(action.state, available);

  const move = useMutation({
    mutationFn: async (to: ActionState) => {
      const evidence: EvidenceInput[] = [];

      for (const item of files) {
        evidence.push({
          kind: item.kind,
          object_key: await uploadEvidence(action.id, item.file),
        });
      }

      return transitionAction(action.id, {
        to,
        note: note.trim() === '' ? undefined : note.trim(),
        reason: reason.trim() === '' ? undefined : reason.trim(),
        evidence,
      });
    },
    onSuccess: async () => {
      setReason('');
      setNote('');
      setFiles([]);
      setError(null);
      setOpened(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.action(action.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.actions() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.findings() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.submittedInspection() }),
      ]);
      onDone?.();
    },
    onError: (caught: Error) => setError(caught.message),
  });

  if (!form) {
    return (
      <p className="notice finding__step-waiting">
        Nothing for you to do here: someone else has to move this one along.
      </p>
    );
  }

  const opening = form.folded.find((choice) => choice.to === opened) ?? null;

  /*
    Los mismos campos para las dos formas del paso —lo que está a la vista y lo que revela una
    salida plegada—, porque son los mismos campos: cambia cuáles pide cada una, no cómo se
    escriben. La razón lleva el foco al aparecer: el botón que la reveló se fue con el bloque
    que lo contenía, y el foco tiene que quedar en lo que se acaba de mostrar.
  */
  const fields = (spec: StepFields): React.JSX.Element => (
    <>
      {spec.evidence ? <EvidencePicker files={files} onChange={setFiles} /> : null}

      {spec.reason ? (
        <label className="finding__step-field">
          <span>Reason</span>
          <textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
      ) : null}

      {spec.note ? (
        <label className="finding__step-field">
          <span>
            Note <span className="finding__step-optional">Optional</span>
          </span>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
      ) : null}
    </>
  );

  return (
    <div className="finding__step-fields">
      {opening ? (
        <div className="finding__step-folded">
          {fields(opening.fields)}

          <div className="finding__step-folded-actions">
            <button
              type="button"
              className="button--primary"
              disabled={move.isPending || (opening.fields.reason && reason.trim() === '')}
              onClick={() => move.mutate(opening.to)}
            >
              {opening.label}
            </button>
            <button
              type="button"
              className="button--outline"
              disabled={move.isPending}
              onClick={() => {
                setOpened(null);
                setReason('');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {fields(form.fields)}

          <div className="finding__step-actions">
            {form.choices.map((choice, index) => (
              <button
                key={choice.to}
                type="button"
                className={index === 0 ? 'button--primary' : 'button--outline'}
                disabled={move.isPending}
                onClick={() => move.mutate(choice.to)}
              >
                {choice.label}
              </button>
            ))}

            {form.folded.map((choice) => (
              <button
                key={choice.to}
                type="button"
                className="button--outline"
                disabled={move.isPending}
                onClick={() => setOpened(choice.to)}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </>
      )}

      {error ? (
        <p role="alert" className="notice notice--warn finding__step-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
