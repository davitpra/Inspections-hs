import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import {
  PERIOD_MONTHS,
  PERIOD_MONTHS_LABELS,
  type InspectionSchedule,
  type PeriodMonths,
} from '@hs/contracts';

import { createSchedule, listTemplates } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';

/**
 * Alta de una regla.
 *
 * El selector EXCLUYE las plantillas que ya tienen regla activa en este sitio. Es la
 * mitad cliente de la unicidad: el servidor responde `schedule_already_active` igual, y
 * no ofrecerlo evita que el coordinador provoque ese error haciendo lo único que la
 * pantalla le ofrece. La exclusión NO mira la frecuencia: sigue siendo una regla activa
 * por planta y plantilla, cualquiera sea cada cuánto abre.
 *
 * EL MES ANCLA SOLO APARECE CUANDO SIGNIFICA ALGO. Para una regla mensual todos los meses
 * empiezan período, así que ofrecerlo sería pedir una decisión sin consecuencia — y el
 * coordinador que la tomara creería haber configurado algo. Cuando no se manda, el
 * servidor lo resuelve con el mes civil de Ontario, que es el calendario en el que abre el
 * trabajo automático; el navegador no lo calcula porque su reloj es el del dispositivo.
 *
 * LA FRECUENCIA NO SE PUEDE CAMBIAR DESPUÉS. Se dice acá, en el alta, porque es el único
 * momento en que se puede elegir: el motor rechaza el UPDATE con HS001 y el reporte de
 * cumplimiento depende de que no se mueva.
 */
export function NewRuleForm({
  siteId,
  rules,
}: {
  siteId: string;
  rules: readonly InspectionSchedule[];
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const controlId = useId();
  const [templateId, setTemplateId] = useState('');
  const [frequencyMonths, setFrequencyMonths] = useState<PeriodMonths>(1);
  const [anchorMonth, setAnchorMonth] = useState('');
  const [error, setError] = useState<string | null>(null);

  const templates = useQuery({
    queryKey: queryKeys.templates(),
    queryFn: listTemplates,
    retry: false,
  });

  const taken = new Set(
    rules.filter((rule) => rule.deactivated_at === null).map((rule) => rule.template_id),
  );
  const available = (templates.data ?? []).filter((template) => !taken.has(template.id));

  const create = useMutation({
    mutationFn: () =>
      createSchedule({
        site_id: siteId,
        template_id: templateId,
        frequency_months: frequencyMonths,
        // Sin ancla lo resuelve el servidor; con mensual no significa nada y no se manda.
        ...(frequencyMonths !== 1 && anchorMonth !== ''
          ? { anchor_month: Number(anchorMonth) }
          : {}),
      }),
    onSuccess: () => {
      setTemplateId('');
      setFrequencyMonths(1);
      setAnchorMonth('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.inspectionSchedules() });
    },
    onError: (caught: Error) => setError(caught.message),
  });

  if (templates.isSuccess && available.length === 0) {
    return <p className="note">Every published template already has an active rule here.</p>;
  }

  return (
    <div className="filters">
      <label htmlFor={`${controlId}-template`}>Add inspection requirement</label>
      <select
        id={`${controlId}-template`}
        value={templateId}
        onChange={(event) => setTemplateId(event.target.value)}
      >
        <option value="">Choose a template…</option>
        {available.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name} (v{template.latest_version})
          </option>
        ))}
      </select>

      <label htmlFor={`${controlId}-frequency`}>Frequency</label>
      <select
        id={`${controlId}-frequency`}
        value={frequencyMonths}
        onChange={(event) => {
          const next = Number(event.target.value) as PeriodMonths;

          setFrequencyMonths(next);
          if (next === 1) setAnchorMonth('');
        }}
      >
        {PERIOD_MONTHS.map((months) => (
          <option key={months} value={months}>
            {PERIOD_MONTHS_LABELS[months]}
          </option>
        ))}
      </select>

      {frequencyMonths === 1 ? null : (
        <>
          <label htmlFor={`${controlId}-anchor`}>Starting in</label>
          <select
            id={`${controlId}-anchor`}
            value={anchorMonth}
            onChange={(event) => setAnchorMonth(event.target.value)}
          >
            <option value="">This month</option>
            {ANCHOR_MONTHS.map((month, index) => (
              <option key={month} value={index + 1}>
                {month}
              </option>
            ))}
          </select>
        </>
      )}

      <button
        type="button"
        onClick={() => create.mutate()}
        disabled={templateId === '' || create.isPending}
      >
        {create.isPending ? 'Adding…' : 'Add requirement'}
      </button>

      <p className="note">
        The frequency and its starting month cannot be changed later. To change them,
        deactivate the rule and create another.
      </p>

      {error ? <p className="notice">{error}</p> : null}
    </div>
  );
}

const ANCHOR_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
