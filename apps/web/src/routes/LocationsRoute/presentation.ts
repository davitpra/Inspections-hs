import { CATALOG_CODE_PATTERN, type Location, type OrganizationLocation } from '@hs/contracts';

/**
 * La lógica pura de la pantalla de mapeo.
 *
 * LA PANTALLA SE ORDENA POR UBICACIÓN COMPARTIDA, no por ubicación física, y todo lo que
 * hay acá sale de esa decisión. La pregunta que el coordinador tiene es «¿cada lugar que
 * mis plantillas nombran existe en esta planta?», y su respuesta útil es una AUSENCIA: una
 * compartida sin fila física en esa planta hace que la sección de la plantilla no resuelva
 * y que el hallazgo nazca sin ubicación. Recorriendo las físicas —como hacía la primera
 * versión— ese hueco no es nada que se pueda dibujar, porque es una fila que no está.
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
 * Las físicas que esta compartida puede tomar en esta planta: las libres, más la que ya
 * tiene.
 *
 * Excluir las tomadas por otra compartida no es cosmético: `UNIQUE (site_id,
 * organization_location_id)` en la migración 0018 rechaza el duplicado, así que ofrecerlas
 * sería ofrecer un error de Postgres.
 */
export function availableLocations(
  shared: OrganizationLocation,
  locations: readonly Location[],
  siteId: string,
): Location[] {
  return locations
    .filter(
      (location) =>
        location.site_id === siteId &&
        (location.organization_location_code == null ||
          location.organization_location_code === shared.code),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Cuántas compartidas tienen lugar en esta planta, sobre el total. */
export function mappingProgress(
  shared: readonly OrganizationLocation[],
  locations: readonly Location[],
  siteId: string,
): { mapped: number; total: number } {
  return {
    mapped: shared.filter((each) => assignedLocation(each, locations, siteId) !== undefined).length,
    total: shared.length,
  };
}

export function progressLabel(progress: { mapped: number; total: number }): string {
  if (progress.total === 0) return 'No shared locations yet';

  return `${progress.mapped} of ${progress.total} shared locations mapped here`;
}

/**
 * Las físicas de esta planta que no representan a ninguna compartida.
 *
 * Es el hueco simétrico y también hay que poder verlo: una física sin compartida no rompe
 * ninguna plantilla, pero sí es un lugar que ninguna plantilla puede nombrar.
 */
export function unmappedLocations(locations: readonly Location[], siteId: string): Location[] {
  return locations
    .filter((location) => location.site_id === siteId && location.organization_location_code == null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Las compartidas en orden alfabético, que es como se buscan. */
export function sortShared(shared: readonly OrganizationLocation[]): OrganizationLocation[] {
  return [...shared].sort((a, b) => a.name.localeCompare(b.name));
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
