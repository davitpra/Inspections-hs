import { CATALOG_CODE_PATTERN, type Location, type OrganizationLocation } from '@hs/contracts';

/**
 * La lógica pura de la pantalla de mapeo.
 *
 * LA PANTALLA SE ORDENA POR UBICACIÓN COMPARTIDA Y ABRE UNA COLUMNA POR PLANTA, y todo lo
 * que hay acá sale de esa decisión. La pregunta que el coordinador tiene es «¿cada lugar que
 * mis plantillas nombran existe en cada planta?», y su respuesta útil es una AUSENCIA: una
 * compartida sin fila física en una planta hace que la sección de la plantilla no resuelva y
 * que el hallazgo nazca sin ubicación. Recorriendo las físicas ese hueco no es nada que se
 * pueda dibujar, porque es una fila que no está; con una planta por vez hay que cambiar de
 * planta y volver a contar para verlo.
 *
 * Nada de acá conoce el número de plantas: recibe `siteIds`. Dos es lo que hay hoy, no una
 * regla.
 */

/** La ubicación física de esta planta que hoy representa a la compartida, si hay alguna. */
export function assignedLocation(
  shared: OrganizationLocation,
  locations: readonly Location[],
  siteId: string,
): Location | undefined {
  return locations.find(
    (location) =>
      location.site_id === siteId && location.organization_location_code === shared.code,
  );
}

/**
 * La física de esta planta que el tick puede REUTILIZAR al volver a marcar: la que lleva el
 * mismo código que la compartida y no representa a ninguna.
 *
 * Desmarcar suelta el mapeo pero no borra la fila (ADR-002, nunca DELETE), así que sin esto
 * volver a marcar crearía una segunda física con el mismo código y el servidor la rechazaría
 * por el único de `(site_id, code)`.
 */
export function reusableLocation(
  shared: OrganizationLocation,
  locations: readonly Location[],
  siteId: string,
): Location | undefined {
  return locations.find(
    (location) =>
      location.site_id === siteId &&
      location.code === shared.code &&
      location.organization_location_code == null,
  );
}

/** En cuántas de estas plantas existe la compartida. */
export function coverage(
  shared: OrganizationLocation,
  locations: readonly Location[],
  siteIds: readonly string[],
): 'every' | 'some' | 'none' {
  const present = siteIds.filter(
    (siteId) => assignedLocation(shared, locations, siteId) !== undefined,
  ).length;

  if (present === 0) return 'none';

  return present === siteIds.length ? 'every' : 'some';
}

/**
 * El filtro segmentado. `'all'`, `'every'` (está en todas), o el id de una planta —«solo
 * acá»—.
 *
 * El mock tiene cuatro botones fijos porque hay dos plantas. Acá el tercero en adelante sale
 * de `siteIds`, así que una tercera planta no toca este archivo.
 */
export type CoverageFilter = 'all' | 'every' | { readonly only: string };

export function matchesFilter(
  shared: OrganizationLocation,
  locations: readonly Location[],
  filter: CoverageFilter,
  siteIds: readonly string[],
): boolean {
  if (filter === 'all') return true;
  if (filter === 'every') return coverage(shared, locations, siteIds) === 'every';

  return siteIds.every((siteId) => {
    const here = assignedLocation(shared, locations, siteId) !== undefined;

    return siteId === filter.only ? here : !here;
  });
}

/**
 * Las compartidas que quedan tras el filtro y la búsqueda, en el orden pedido.
 *
 * Los criterios van en un objeto y no sueltos: eran cinco parámetros y tres de ellos
 * cadenas, así que invertir dos en la llamada tipaba igual y ordenaba distinto.
 */
export function visibleLocations(
  shared: readonly OrganizationLocation[],
  locations: readonly Location[],
  view: {
    filter: CoverageFilter;
    query: string;
    siteIds: readonly string[];
    direction: SortDirection;
  },
): OrganizationLocation[] {
  const needle = view.query.trim().toLowerCase();

  return sortShared(shared, view.direction).filter(
    (each) =>
      matchesFilter(each, locations, view.filter, view.siteIds) &&
      (each.name.toLowerCase().includes(needle) || each.code.toLowerCase().includes(needle)),
  );
}

/**
 * Cuántas compartidas tienen lugar en ESTA planta, sobre el total.
 *
 * Es el único número que importa y por eso va en el encabezado de cada columna: sin él hay
 * que contar 21 ticks a ojo para saber si falta algo.
 */
export function siteProgress(
  shared: readonly OrganizationLocation[],
  locations: readonly Location[],
  siteId: string,
): { mapped: number; total: number } {
  return {
    mapped: shared.filter((each) => assignedLocation(each, locations, siteId) !== undefined).length,
    total: shared.length,
  };
}

/** El «9 of 21» del encabezado de columna. */
export function progressLabel(progress: { mapped: number; total: number }): string {
  return `${progress.mapped} of ${progress.total}`;
}

/**
 * Las físicas de una planta que no representan a ninguna compartida.
 *
 * Es el hueco simétrico y también hay que poder verlo: una física sin compartida no rompe
 * ninguna plantilla, pero sí es un lugar que ninguna plantilla puede nombrar. Con el tick,
 * además, es donde caen las que se desmarcan.
 */
export function unmappedLocations(locations: readonly Location[], siteId: string): Location[] {
  return locations
    .filter((location) => location.site_id === siteId && location.organization_location_code == null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type SortDirection = 'asc' | 'desc';

/**
 * Las compartidas por nombre, en el sentido pedido.
 *
 * `localeCompare` y no `<`: los nombres los escribe una persona y llevan acentos, y el orden
 * de los puntos de código pone «Área» después de «Zona».
 *
 * Z→A no es simetría por simetría: con veintiuna filas y el encabezado a la vista, invertir
 * es la forma más corta de llegar al final de una lista larga.
 */
export function sortShared(
  shared: readonly OrganizationLocation[],
  direction: SortDirection = 'asc',
): OrganizationLocation[] {
  const sorted = [...shared].sort((a, b) => a.name.localeCompare(b.name));

  return direction === 'asc' ? sorted : sorted.reverse();
}

/**
 * Propone un `code` a partir del nombre.
 *
 * PROPONE, no impone, y ahí se separa de la `key` de una plantilla —que el servidor deriva
 * y nadie puede tocar—. El catálogo decidió lo contrario a propósito: su `code` es legible
 * porque los seeds se escriben a mano y porque aparece en los reportes, así que quien lo
 * crea tiene que poder corregirlo.
 *
 * Devuelve `''` cuando no queda nada utilizable, para que el formulario no ofrezca guardar
 * algo que la base va a rechazar por el `CHECK`.
 */
export function suggestCode(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return CATALOG_CODE_PATTERN.test(slug) ? slug : '';
}

/** Si el par nombre + code alcanza para dar de alta. */
export function canCreate(name: string, code: string): boolean {
  return name.trim().length > 0 && CATALOG_CODE_PATTERN.test(code);
}
