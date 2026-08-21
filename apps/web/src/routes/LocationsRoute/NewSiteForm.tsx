import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { createSite } from '../../api/catalog';
import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { canCreate, suggestCode } from './presentation';

/**
 * Alta de una planta desde la consola. No lleva `SitePicker`: no hay una planta que elegir
 * cuando la operación está creando justamente la planta.
 */
export function NewSiteForm(): React.JSX.Element {
  const queryClient = useQueryClient();
  const { reload } = useAppSession();
  const controlId = useId();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createSite({ code, name: name.trim() }),
    onSuccess: async () => {
      setName('');
      setCode('');
      setCodeTouched(false);
      setError(null);

      await queryClient.invalidateQueries({ queryKey: queryKeys.sites() });
      await reload();
    },
    onError: (caught: Error) => setError(caught.message),
  });

  const onNameChange = (value: string): void => {
    setName(value);
    if (!codeTouched) setCode(suggestCode(value));
  };

  return (
    <div className="card">
      <div className="card__head">
        <h3>Add a site</h3>
      </div>

      <p className="note">
        The code is permanent. This site will be reachable only by the account that registers it;
        grant access to other accounts from the account console.
      </p>

      <div className="filters">
        <label htmlFor={`${controlId}-name`}>Name</label>
        <input
          id={`${controlId}-name`}
          type="text"
          value={name}
          placeholder="North plant"
          onChange={(event) => onNameChange(event.target.value)}
        />
      </div>

      <div className="filters">
        <label htmlFor={`${controlId}-code`}>Code</label>
        <input
          id={`${controlId}-code`}
          type="text"
          value={code}
          placeholder="north-plant"
          onChange={(event) => {
            setCodeTouched(true);
            setCode(event.target.value);
          }}
        />
        <button
          type="button"
          className="button--primary"
          onClick={() => create.mutate()}
          disabled={!canCreate(name, code) || create.isPending}
        >
          {create.isPending ? 'Adding…' : 'Add'}
        </button>
      </div>

      {error ? <p className="notice">{error}</p> : null}
    </div>
  );
}
