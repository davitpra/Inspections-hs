import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { InspectionSchedule } from '@hs/contracts';

import { createSchedule, listTemplates } from '../../api/inspections';

/**
 * Alta de una regla.
 *
 * El selector EXCLUYE las plantillas que ya tienen regla activa en este sitio. Es la
 * mitad cliente de la unicidad: el servidor responde `schedule_already_active` igual, y
 * no ofrecerlo evita que el coordinador provoque ese error haciendo lo único que la
 * pantalla le ofrece.
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
  const [error, setError] = useState<string | null>(null);

  const templates = useQuery({ queryKey: ['templates'], queryFn: listTemplates, retry: false });

  const taken = new Set(
    rules.filter((rule) => rule.deactivated_at === null).map((rule) => rule.template_id),
  );
  const available = (templates.data ?? []).filter((template) => !taken.has(template.id));

  const create = useMutation({
    mutationFn: () => createSchedule({ site_id: siteId, template_id: templateId }),
    onSuccess: () => {
      setTemplateId('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['inspection-schedules'] });
    },
    onError: (caught: Error) => setError(caught.message),
  });

  if (templates.isSuccess && available.length === 0) {
    return <p className="note">Every published template already has an active rule here.</p>;
  }

  return (
    <div className="filters">
      <label htmlFor={`${controlId}-template`}>New rule</label>
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

      <button
        type="button"
        onClick={() => create.mutate()}
        disabled={templateId === '' || create.isPending}
      >
        {create.isPending ? 'Creating…' : 'Create rule'}
      </button>

      {error ? <p className="notice">{error}</p> : null}
    </div>
  );
}
