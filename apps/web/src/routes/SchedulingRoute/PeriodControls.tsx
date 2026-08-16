import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { ScheduledInspection } from '@hs/contracts';

import { assignInspector, listInspectorCandidates } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { PersonIcon } from '../../components/icons';
import { candidateLabel, inspectorLabel } from './presentation';

/**
 * Elegir el inspector de un período abierto. Cancelar ya no está acá: vive en el menú de
 * la fila (`PeriodMenu`), que es donde va lo que se hace una vez y no se deshace.
 *
 * EL SELECTOR MUESTRA A QUIÉN ESTÁ ASIGNADO, no una lista vacía: la fila ya no repite el
 * nombre en una línea aparte, así que el control es también el estado. Cuando la persona
 * asignada no está entre los candidatos —vive en otra planta y la cuenta no la ve— se
 * agrega igual como opción con el texto de `inspectorLabel`, porque un `<select>` sin
 * opción para su propio valor se dibuja vacío y eso se lee como "sin inspector".
 *
 * ASIGNAR NECESITA EL BOTÓN. Elegir en la lista no manda nada: el `change` de un `<select>`
 * lo dispara también el teclado al recorrer las opciones, y acá cada paso de esa recorrida
 * era una asignación real.
 *
 * SIN ACTUALIZACIÓN OPTIMISTA, a propósito. Si el servidor rechaza la asignación —la
 * cuenta perdió el alcance entre que se cargó la lista y se hizo click—, la fila tiene
 * que volver a mostrar al inspector anterior y el motivo tiene que verse. Pintar el
 * cambio y deshacerlo después es peor que esperar.
 */
export function PeriodControls({
  inspection,
  siteId,
}: {
  inspection: ScheduledInspection;
  siteId: string;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const controlId = useId();
  const assigned = inspection.inspector_id ?? '';
  const [chosen, setChosen] = useState(assigned);
  const [error, setError] = useState<string | null>(null);

  const candidates = useQuery({
    queryKey: queryKeys.inspectorCandidates(siteId),
    queryFn: () => listInspectorCandidates(siteId),
    enabled: siteId !== '',
    retry: false,
  });

  const options = candidates.data ?? [];
  const listed = options.some((candidate) => candidate.id === inspection.inspector_id);

  const assign = useMutation({
    mutationFn: (inspectorId: string) => assignInspector(inspection.id, inspectorId),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.scheduledInspections() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.pendingInspections() });
    },
    onError: (caught: Error) => {
      setChosen(assigned);
      setError(caught.message);
    },
  });

  return (
    <>
      {/*
        `aria-label` y no un `<label>` visible: el nombre del mes y la plantilla ya están
        arriba, y envolver el control en un `<label>` haría que su texto accesible
        incluya el de todas las opciones.
      */}
      <div className="field-select">
        <span className="field-select__icon">
          <PersonIcon />
        </span>
        <select
          id={`${controlId}-assign`}
          aria-label="Assign"
          value={chosen}
          disabled={assign.isPending}
          onChange={(event) => setChosen(event.target.value)}
        >
          <option value="">No inspector yet</option>
          {inspection.inspector_id !== null && !listed ? (
            <option value={inspection.inspector_id}>{inspectorLabel(inspection)}</option>
          ) : null}
          {options.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidateLabel(candidate)}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        className="period__action button--outline"
        disabled={assign.isPending || chosen === '' || chosen === assigned}
        onClick={() => assign.mutate(chosen)}
      >
        {assign.isPending
          ? 'Assigning…'
          : inspection.inspector_id === null
            ? 'Assign inspector'
            : 'Change inspector'}
      </button>

      {error ? <p className="notice">{error}</p> : null}
    </>
  );
}
