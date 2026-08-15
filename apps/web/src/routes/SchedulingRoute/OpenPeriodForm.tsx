import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

import {
  createScheduledInspection,
  listInspectorCandidates,
  listTemplates,
} from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { PersonIcon } from './icons';
import { candidateLabel, type UnopenedPeriod } from './presentation';

/**
 * Abrir un mes: elegir inspector —o ninguno— y programarlo.
 *
 * Lo usan los DOS casos en los que un mes del calendario no tiene una inspección viva: la
 * casilla que nunca se abrió (`UnopenedPeriodRow`) y el mes cancelado (`PeriodRow`). Son
 * la misma operación contra el mismo endpoint: `POST /inspections/scheduled` inserta una
 * fila nueva, y el índice parcial de 0008 la deja pasar justamente porque el período
 * cancelado no ocupa el lugar. Lo único que cambia es cómo se llama el botón.
 *
 * Nombra la versión publicada hoy ANTES de abrir, porque es la que la fila va a llevar
 * para siempre: acá se muestra como la promesa de lo que el clic va a congelar, no como
 * el estado de un período que todavía no existe.
 */
export function OpenPeriodForm({
  period,
  siteId,
  action,
  onOpened,
}: {
  period: UnopenedPeriod;
  siteId: string;
  /** El verbo del botón. Abrir por primera vez y volver a programar no se llaman igual. */
  action: string;
  /** Para quien lo monta en un diálogo: el mes ya existe, no hay nada más que hacer acá. */
  onOpened?: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const controlId = useId();
  const [inspectorId, setInspectorId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const candidates = useQuery({
    queryKey: queryKeys.inspectorCandidates(siteId),
    queryFn: () => listInspectorCandidates(siteId),
    enabled: siteId !== '',
    retry: false,
  });

  const templates = useQuery({
    queryKey: queryKeys.templates(),
    queryFn: listTemplates,
    retry: false,
  });

  const version = templates.data?.find((template) => template.id === period.template_id)
    ?.latest_version;

  const open = useMutation({
    mutationFn: () =>
      createScheduledInspection({
        site_id: period.site_id,
        template_id: period.template_id,
        period_start: period.period_start,
        inspector_id: inspectorId === '' ? null : inspectorId,
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.scheduledInspections() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.pendingInspections() });

      onOpened?.();
    },
    onError: (caught: Error) => setError(caught.message),
  });

  return (
    <>
      <label htmlFor={`${controlId}-inspector`} className="field-label">
        Inspector
      </label>
      <div className="field-select">
        <span className="field-select__icon">
          <PersonIcon />
        </span>
        <select
          id={`${controlId}-inspector`}
          value={inspectorId}
          disabled={open.isPending}
          onChange={(event) => setInspectorId(event.target.value)}
        >
          <option value="">No inspector yet</option>
          {(candidates.data ?? []).map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidateLabel(candidate)}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        className="period__action button--primary"
        disabled={open.isPending}
        onClick={() => open.mutate()}
      >
        {open.isPending
          ? 'Opening…'
          : version
            ? `${action} (freezes version ${version})`
            : action}
      </button>

      {error ? <p className="notice">{error}</p> : null}
    </>
  );
}
