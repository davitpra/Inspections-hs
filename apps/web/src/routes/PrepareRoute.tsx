import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';

import { missingForField, prefetchInspection } from '../offline/prefetch';
import { readableKind } from './PendingRoute';

/**
 * Prepararse para el campo: bajar el paquete completo antes de perder señal.
 *
 * Las tres piezas —el documento congelado, el catálogo cerrado de ubicaciones, y el
 * subconjunto activo del roster— se bajan acá y se guardan en Dexie. Falta cualquiera y
 * la inspección no está lista, y esta pantalla lo dice con la red todavía puesta.
 */
export function PrepareRoute(): React.JSX.Element {
  const { id } = useParams({ from: '/inspections/$id/prepare' });
  const queryClient = useQueryClient();

  const missing = useQuery({
    queryKey: ['field-ready', id],
    queryFn: () => missingForField(id),
  });

  const prepare = useMutation({
    mutationFn: () => prefetchInspection(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['field-ready', id] }),
  });

  const ready = missing.data?.length === 0;

  return (
    <>
      <h1>Prepare for the field</h1>

      <p>
        Everything this inspection needs is downloaded to this device now, while you have a
        connection. After that the walkthrough runs with no network at all.
      </p>

      <ul className="list">
        {['template_version', 'locations', 'roster'].map((kind) => (
          <li key={kind} className="list__row">
            {readableKind(kind)}:{' '}
            {missing.data?.includes(kind as never) ? 'not downloaded' : 'downloaded'}
          </li>
        ))}
      </ul>

      <button type="button" onClick={() => prepare.mutate()} disabled={prepare.isPending}>
        {prepare.isPending ? 'Downloading…' : 'Download for the field'}
      </button>

      {prepare.data && prepare.data.missing.length > 0 ? (
        <p className="notice notice--warn">
          Still missing {prepare.data.missing.map(readableKind).join(', ')}. Try again while you
          have a connection.
        </p>
      ) : null}

      {ready ? (
        <p>
          <Link to="/inspections/$id/capture" params={{ id }}>
            Start the walkthrough
          </Link>
        </p>
      ) : null}
    </>
  );
}
