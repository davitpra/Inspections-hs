import { useMutation, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '../api/query-keys';
import { prefetchInspection } from '../offline/prefetch';

/**
 * El paquete de campo, del lado de la pantalla: cómo se nombra lo que falta y cómo se
 * baja.
 *
 * Vive en `components/` y no en una ruta porque hacen falta las dos cosas en dos lugares
 * —la lista de pendientes y la captura abierta sin paquete— y son el mismo control.
 * Antes esto era una pantalla intermedia propia; la descarga ahora ocurre donde el
 * inspector ya está parado.
 */

/** El nombre de cada pieza, en el idioma del inspector y no en el de la tabla. */
export function readableKind(kind: string): string {
  switch (kind) {
    case 'template_version':
      return 'the inspection form';
    case 'locations':
      return 'the location list';
    case 'roster':
      return 'the roster';
    default:
      return kind;
  }
}

/**
 * El botón que baja las tres piezas.
 *
 * No consulta qué falta: eso ya lo sabe quien lo dibuja, y lo usa para decidir si este
 * botón corresponde. Acá solo está la acción, y la invalidación de `fieldReady` que hace
 * que la pantalla se entere de que ya está.
 *
 * Un fallo parcial se NOMBRA (`result.missing`): la descarga guarda lo que sí llegó, así
 * que reintentar completa lo que falta sin volver a bajar lo caro.
 */
export function DownloadForField({ id }: { id: string }): React.JSX.Element {
  const queryClient = useQueryClient();

  const download = useMutation({
    mutationFn: () => prefetchInspection(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.fieldReady(id) }),
  });

  return (
    <>
      <button type="button" onClick={() => download.mutate()} disabled={download.isPending}>
        {download.isPending ? 'Downloading…' : 'Download for the field'}
      </button>

      {download.data && download.data.missing.length > 0 ? (
        <p className="notice notice--warn">
          Still missing {download.data.missing.map(readableKind).join(', ')}. Try again while you
          have a connection.
        </p>
      ) : null}
    </>
  );
}
