import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import type { ScheduledInspection } from '@hs/contracts';

import { assignInspector, listInspectorCandidates } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { PersonIcon } from '../../components/icons';
import { candidateLabel, inspectorLabel } from '../../presentation/scheduling';

/**
 * Elegir el inspector de un período, con confirmación separada.
 *
 * Era un `<select>` dentro de la celda «Inspector»: la columna del registro y el control
 * que la cambia eran la misma cosa, y la carga y el error de los candidatos engordaban
 * cada fila. Acá la celda vuelve a decir solo quién es, y elegir es un paso aparte.
 *
 * **Reasignar le saca el período a alguien.** El diálogo nombra al inspector actual
 * porque quien reasigna tiene que ver de quién lo está sacando; la lista de pendientes de
 * esa persona cambia sin que nadie se lo pregunte.
 *
 * SIN ACTUALIZACIÓN OPTIMISTA: si el servidor rechaza —el candidato dejó de ser
 * elegible—, la elección vuelve a lo que hay y el error se lee acá adentro.
 */
export function AssignInspectorDialog({
  inspection,
  siteId,
  label,
  onClose,
}: {
  inspection: ScheduledInspection;
  siteId: string;
  label: string;
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const id = useId();
  const assigned = inspection.inspector_id ?? '';
  const [chosen, setChosen] = useState(assigned);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.showModal();
  }, []);

  const candidates = useQuery({
    queryKey: queryKeys.inspectorCandidates(siteId),
    queryFn: () => listInspectorCandidates(siteId),
    retry: false,
  });

  const assign = useMutation({
    mutationFn: (inspectorId: string) => assignInspector(inspection.id, inspectorId),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.scheduledInspections() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.pendingInspections() });

      dialogRef.current?.close();
    },
    onError: (caught: Error) => {
      setChosen(assigned);
      setError(caught.message);
    },
  });

  const options = candidates.data ?? [];
  const currentListed = options.some((candidate) => candidate.id === inspection.inspector_id);
  const reassigning = inspection.inspector_id !== null;

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-label={reassigning ? 'Reassign inspector' : 'Assign inspector'}
      onClose={() => { onClose(); returnFocusRef.current?.focus(); }}
    >
      <div className="modal__head"><h2>{reassigning ? 'Reassign inspector' : 'Assign inspector'}</h2></div>

      <p className="modal__text">
        {reassigning
          ? `${label} is with ${inspectorLabel(inspection)}. Reassigning removes it from their pending list.`
          : `${label} has no inspector and appears in nobody's pending list.`}
      </p>

      <div className="modal__form modal__form--spaced">
        <label htmlFor={`${id}-assign`}>Inspector</label>
        <div className="field-select">
          <span className="field-select__icon"><PersonIcon /></span>
          <select
            id={`${id}-assign`}
            aria-label={`Assign inspector for ${label}`}
            value={chosen}
            disabled={assign.isPending}
            onChange={(event) => setChosen(event.target.value)}
          >
            <option value="">No inspector yet</option>
            {/* La cuenta asignada puede tener su persona en otra planta y no aparecer entre
                los candidatos: se conserva como opción para no borrarla al abrir el diálogo. */}
            {inspection.inspector_id !== null && !currentListed ? (
              <option value={inspection.inspector_id}>{inspectorLabel(inspection)}</option>
            ) : null}
            {options.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidateLabel(candidate)}</option>
            ))}
          </select>
        </div>
        {candidates.isLoading ? <p className="note">Loading eligible inspectors…</p> : null}
        {candidates.isError ? <p className="notice notice--warn" role="alert">Eligible inspectors could not be loaded.</p> : null}
      </div>

      {error ? <p className="notice notice--warn" role="alert">{error}</p> : null}

      <div className="modal__actions">
        <button
          type="button"
          className="button--primary"
          disabled={assign.isPending || chosen === '' || chosen === assigned}
          onClick={() => assign.mutate(chosen)}
        >
          {assign.isPending ? 'Assigning…' : 'Confirm assignment'}
        </button>
        <button type="button" onClick={() => dialogRef.current?.close()}>Cancel</button>
      </div>
    </dialog>
  );
}
