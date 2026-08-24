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
 * No consulta qué falta: eso ya lo sabe quien lo dibuja, y lo usa para decidir cómo se
 * llama este botón. Acá solo está la acción y la invalidación.
 *
 * **Es el mismo control con el paquete completo que sin él**, y por eso `label` es un
 * parámetro y no hay un segundo componente: bajar y volver a bajar son la misma descarga,
 * que pisa lo que haya. Un `RefreshFieldPackage` aparte duplicaría la invalidación, que
 * es justamente donde ya hubo un error.
 *
 * Un fallo parcial se NOMBRA (`result.missing`): la descarga guarda lo que sí llegó, así
 * que reintentar completa lo que falta sin volver a bajar lo caro.
 */
export function DownloadForField({
  id,
  label = 'Download for the field',
  className,
}: {
  id: string;
  label?: string;
  className?: string;
}): React.JSX.Element {
  const queryClient = useQueryClient();

  /**
   * LAS CUATRO CLAVES, Y NO SOLO `fieldReady`.
   *
   * `fieldReady` sola alcanzaba mientras la descarga ocurría una única vez: pasaba de
   * "falta" a "está" y no había nada más que refrescar. Con el paquete ya completo, la
   * descarga cambia Dexie sin cambiar `missingForField`, así que sin invalidar el resto
   * la pantalla sigue mostrando la versión, el sello y el progreso viejos — el síntoma
   * exacto que el botón de refrescar dice arreglar.
   *
   * `draft(id)` cubre también `captureDraft(id, …)`: el marcador va después del
   * identificador para que el prefijo las alcance a las dos.
   */
  const download = useMutation({
    mutationFn: () => prefetchInspection(id),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.fieldReady(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.storedTemplateVersion(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.prefetchedAt(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.draft(id) }),
      ]);
    },
  });

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => download.mutate()}
        disabled={download.isPending}
      >
        {download.isPending ? 'Downloading…' : label}
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
