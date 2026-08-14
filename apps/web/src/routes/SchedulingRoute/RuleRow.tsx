import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { InspectionSchedule } from '@hs/contracts';

import { updateSchedule } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';

export function RuleRow({
  rule,
  canAdminister,
}: {
  rule: InspectionSchedule;
  canAdminister: boolean;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const deactivate = useMutation({
    mutationFn: () => updateSchedule(rule.id, { deactivated: true }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.inspectionSchedules() });
    },
    onError: (caught: Error) => setError(caught.message),
  });

  const active = rule.deactivated_at === null;

  return (
    <li className="list__row">
      <span>{rule.template_name}</span>

      <span className="note">
        Default inspector: {rule.default_inspector_name ?? 'none'}
      </span>

      {active ? null : <span className="badge badge--closed">Deactivated</span>}

      {canAdminister && active ? (
        <button
          type="button"
          onClick={() => {
            // La confirmación dice QUÉ DEJA DE PASAR. «¿Estás seguro?» no informa nada:
            // desactivar corta la apertura de períodos futuros y hace que el reporte de
            // cobertura deje de contarlos como debidos.
            const confirmed = window.confirm(
              `Deactivate this rule? No further monthly period will be opened for ` +
                `${rule.template_name}, and future months will stop counting as owed. ` +
                `Periods already opened are unaffected.`,
            );

            if (confirmed) deactivate.mutate();
          }}
          disabled={deactivate.isPending}
        >
          {deactivate.isPending ? 'Deactivating…' : 'Deactivate'}
        </button>
      ) : null}

      {error ? <p className="notice">{error}</p> : null}
    </li>
  );
}
