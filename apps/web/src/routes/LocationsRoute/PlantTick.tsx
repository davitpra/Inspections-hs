import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Location, OrganizationLocation } from '@hs/contracts';

import { createLocation, mapLocation } from '../../api/catalog';
import { queryKeys } from '../../api/query-keys';
import { CheckIcon } from '../../components/icons';
import { assignedLocation, reusableLocation } from './presentation';

/**
 * «¿Este lugar existe en esta planta?» — la celda, y la única escritura de la pantalla.
 *
 * EL TICK ES UNA AFIRMACIÓN, NO UN CAMPO. Debajo no hay un booleano: el mapeo vive en la fila
 * física (`location.organization_location_id`), así que marcar puede costar dos escrituras y
 * en un orden que importa.
 *
 *   - **Marcar** — si en la planta ya hay una física libre con el mismo `code` que la
 *     compartida, se la mapea y listo. Si no, se la crea y RECIÉN DESPUÉS se la mapea: sin id
 *     no hay a qué apuntar.
 *   - **Desmarcar** — se suelta el mapeo. La fila física NO se borra (ADR-002, nunca DELETE):
 *     queda en la lista de huérfanas de esa planta y `reusableLocation` la recupera al volver
 *     a marcar. Sin eso, remarcar crearía un duplicado que el único `(site_id, code)` rechaza.
 *
 * **Cuando la física mapeada se llama distinto que la compartida, el tick lo dice.** Una
 * planta puede tener «Dock east» representando a «Loading dock» —eso lo armó la pantalla
 * anterior, con un select— y ahí desmarcar no es inocuo: suelta ESA fila. La etiqueta del
 * tick es entonces su nombre en vez de «Yes», que es lo mínimo para que nadie suelte a ciegas
 * algo que no sabía que estaba ahí.
 *
 * Cada celda lleva su propio estado. Un `isPending` compartido congelaría las 42 de la
 * pantalla por tocar una, que es el error que ya se había arreglado en la fila.
 */
export function PlantTick({
  shared,
  locations,
  siteId,
  siteName,
}: {
  shared: OrganizationLocation;
  locations: readonly Location[];
  siteId: string;
  siteName: string;
}): React.JSX.Element {
  const queryClient = useQueryClient();

  const current = assignedLocation(shared, locations, siteId);
  const checked = current !== undefined;

  const toggle = useMutation({
    mutationFn: async () => {
      if (current) {
        await mapLocation(current.id, null);
        return;
      }

      const reusable = reusableLocation(shared, locations, siteId);
      const target =
        reusable ?? (await createLocation(siteId, { code: shared.code, name: shared.name }));

      await mapLocation(target.id, shared.id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalogLocations() });
    },
  });

  // «Yes» alcanza cuando la física se llama igual que la compartida, que es lo que crea el
  // propio tick. Si se llama distinto, el nombre ES la información.
  const label = ((): string => {
    if (toggle.isPending) return 'Saving…';
    if (!current) return 'No';

    return current.name === shared.name ? 'Yes' : current.name;
  })();

  return (
    <>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={`${shared.name} in ${siteName}`}
        className="tick"
        disabled={toggle.isPending}
        onClick={() => toggle.mutate()}
      >
        <span className="tick__box">{checked ? <CheckIcon size={12} /> : null}</span>
        <span className="tick__label">{label}</span>
      </button>

      {/*
        El error va en la celda que lo causó, no arriba de una lista de veintiuna: un aviso a
        esa distancia no dice cuál de todas falló, que es lo único que hace falta saber.
      */}
      {!toggle.isPending && toggle.isError ? (
        <p className="notice tick__error">{(toggle.error as Error).message}</p>
      ) : null}
    </>
  );
}
