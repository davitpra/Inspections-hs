import type {
  Location,
  OrganizationLocationOption,
  ResponseType,
  Site,
  TemplateDraftDocument,
  TemplateDraftSection,
} from '@hs/contracts';

/**
 * La lógica pura de presentación del editor. Lo que EDITA el documento vive en `edits.ts`:
 * los dos archivos son puros, pero uno decide cómo se ve y el otro qué queda escrito, y un
 * archivo con las dos cosas mentiría sobre la mitad que contiene.
 */

/** Cuántas preguntas tiene el documento entero. */
export function totalItems(document: TemplateDraftDocument): number {
  return document.sections.reduce((count, section) => count + section.items.length, 0);
}

/**
 * Lo que el editor tiene en la mano: el documento, el nombre y el alcance. Los tres viajan
 * juntos porque se guardan juntos —el alcance es una edición como cualquier otra— y porque
 * comparar lo editado contra lo guardado es comparar los tres a la vez.
 */
export type DraftEdits = {
  document: TemplateDraftDocument;
  name: string;
  siteIds: readonly string[];
};

/**
 * Si hay algo sin guardar.
 *
 * Se compara CONTRA EL ÚLTIMO GUARDADO y no se lleva un flag `dirty`: un flag queda en
 * `true` después de deshacer a mano lo que se acababa de escribir, y le dice al autor que
 * tiene cambios pendientes cuando ya no los tiene.
 *
 * `JSON.stringify` alcanza para el documento porque los dos lados salen del mismo esquema y
 * no llevan claves fuera de orden: el guardado viene del servidor, que lo devolvió tal como
 * lo recibió, y el editado sale de `edits.ts`, que solo copia con spread. El alcance se
 * ordena antes de comparar: es un conjunto, y tickear y destickear la misma planta no es un
 * cambio pendiente aunque devuelva la lista en otro orden.
 */
export function hasUnsavedChanges(edited: DraftEdits, saved: DraftEdits): boolean {
  return (
    edited.name !== saved.name ||
    JSON.stringify(edited.document) !== JSON.stringify(saved.document) ||
    JSON.stringify([...edited.siteIds].sort()) !==
      JSON.stringify([...saved.siteIds].sort())
  );
}

/**
 * ¿Este tipo de respuesta tiene algo que configurar?
 *
 * La lista sale de las ramas de `ResponseTypeConfig`, y está escrita como una lista
 * explícita en vez de renderizando y mirando si salió vacío: la fila necesita saberlo
 * ANTES de dibujar, para decidir si abre el bloque plegado.
 *
 * Si algún día un tipo gana configuración, este arreglo es lo que hay que tocar. Un `switch`
 * exhaustivo sobre `ResponseType` haría que el compilador lo recordara, pero repetiría las
 * nueve ramas de `ResponseTypeConfig` en un archivo que no dibuja nada.
 */
const TYPES_WITH_CONFIG: readonly ResponseType[] = [
  'scale',
  'text',
  'number',
  'single_choice',
  'multi_choice',
  'photo',
];

export function hasConfiguration(responseType: ResponseType): boolean {
  return TYPES_WITH_CONFIG.includes(responseType);
}

/**
 * Lo que el encabezado dice al lado de la píldora «Draft».
 *
 * NO DICE «Auto-saved», que es lo que dibuja el mockup: no hay autosave y anunciarlo
 * sería la peor clase de mentira, la que tranquiliza.
 */
export function saveStateLabel(dirty: boolean): string {
  return dirty ? 'Unsaved changes' : 'Saved';
}

/** El texto del botón de guardar según en qué está. */
export function saveButtonLabel(pending: boolean, dirty: boolean): string {
  if (pending) return 'Saving…';
  return dirty ? 'Save draft' : 'Saved';
}

/**
 * Qué decir cuando el guardado fue rechazado.
 *
 * `request.ts` pierde el `code` a propósito y deja solo el mensaje. Lo que agrega esta
 * función es no perder lo escrito: el aviso aclara que el documento sigue en pantalla.
 */
export function saveErrorNotice(message: string): string {
  return `${message} Nothing you typed has been lost — copy anything you need before reloading.`;
}

// ---------------------------------------------------------------------------
// El alcance de plantas y la cobertura del catálogo de ubicaciones.
//
// TRES POBLACIONES, Y CONVIENE NO CONFUNDIRLAS (las mismas de la consola de Locations):
//
//   - **planta** (`Site`) — St. Thomas, Glencoe. El alcance de la plantilla es una lista
//     de estas.
//   - **compartida** (`OrganizationLocation`) — el concepto, sin planta. Es lo ÚNICO que
//     una sección guarda, y es lo que hace que una plantilla valga para las dos.
//   - **física** (`Location`) — la fila de una planta. La sección NO la nombra: se
//     resuelve, y por eso todo lo que sigue devuelve resoluciones de solo lectura.
//
// POR QUÉ ESTO NO ESTÁ EN `draftIssues`. Esa función vive en `@hs/forms`, viaja dentro del
// service worker y decide sobre el DOCUMENTO Y NADA MÁS: darle el catálogo de las dos
// plantas sería darle una entrada que no tiene y no puede pedir, y su veredicto dejaría de
// depender solo de lo que se le pasa. Lo de acá es de la misma clase que `src/permissions/`
// —comodidad, no garantía—: la refutación autoritativa sigue siendo el esquema del
// documento al publicar, y el ingest sigue tolerando una sección sin mapeo.

/**
 * A qué lugar físico resuelve una ubicación compartida en cada planta del alcance.
 *
 * Devuelve una entrada POR PLANTA, con `undefined` donde no hay mapeo: el hueco es la
 * respuesta útil —"esta sección no va a resolver en Glencoe"— y filtrarlo lo escondería.
 * Una compartida sin elegir (`''` o `undefined`) devuelve el mapa con todo en `undefined`,
 * que es lo correcto: no hay nada que resolver todavía.
 */
export function locationCoverage(
  code: string | undefined,
  locations: readonly Location[],
  siteIds: readonly string[],
): ReadonlyMap<string, Location | undefined> {
  return new Map(
    siteIds.map((siteId) => [
      siteId,
      code
        ? locations.find(
            (each) =>
              each.site_id === siteId &&
              each.organization_location_code === code &&
              each.deactivated_at === null,
          )
        : undefined,
    ]),
  );
}

/** ¿Está mapeada en TODAS las plantas del alcance? */
export function isFullyCovered(
  code: string | undefined,
  locations: readonly Location[],
  siteIds: readonly string[],
): boolean {
  if (!code || siteIds.length === 0) return false;

  return [...locationCoverage(code, locations, siteIds).values()].every(
    (resolved) => resolved !== undefined,
  );
}

/**
 * Las ubicaciones compartidas que una sección puede nombrar bajo este alcance.
 *
 * **Se recorta a las mapeadas en TODAS las plantas del alcance**, y ese es el punto del
 * change: una compartida tickeada en una sola planta de un alcance de dos produce una
 * sección que no resuelve en la otra, y el hallazgo nace sin ubicación en el ingest —meses
 * después y lejos de quien la escribió.
 *
 * `current` se conserva SIEMPRE aunque ya no califique. Sacar del desplegable el valor que
 * la sección tiene guardado haría que el `<select>` se dibuje vacío y que el primer cambio
 * de cualquier otro campo lo pise: un recorte de la oferta no puede convertirse en una
 * edición que el autor no pidió.
 */
export function offerableLocations(
  organizationLocations: readonly OrganizationLocationOption[],
  locations: readonly Location[],
  siteIds: readonly string[],
  current?: string,
): OrganizationLocationOption[] {
  return organizationLocations.filter(
    (each) => each.code === current || isFullyCovered(each.code, locations, siteIds),
  );
}

/**
 * Los índices de las secciones que el alcance actual deja sin resolver.
 *
 * Ampliar el alcance NO reescribe ninguna sección: se reporta y el código guardado queda
 * intacto, porque la salida —mapear esa ubicación en la otra planta— vive en la consola de
 * Locations y es una decisión del coordinador, no de esta pantalla.
 *
 * Una sección que todavía no eligió ubicación NO cuenta: eso ya lo dice `draftIssues`, y
 * repetirlo acá con otras palabras sería dos avisos para un solo problema.
 */
export function strandedSections(
  document: TemplateDraftDocument,
  locations: readonly Location[],
  siteIds: readonly string[],
): number[] {
  return document.sections.flatMap((section, index) => {
    const code = section.organization_location_code;

    if (!code) return [];

    return isFullyCovered(code, locations, siteIds) ? [] : [index];
  });
}

/**
 * Cómo se lee un alcance en pantalla: «Both plants», «St. Thomas only», o los nombres
 * separados por coma cuando algún día haya tres plantas.
 *
 * «only» aparece SOLO cuando el alcance es más chico que la organización. Con una sola
 * planta configurada, «St. Thomas only» sugeriría que existe otra donde no vale.
 */
export function scopeLabel(siteIds: readonly string[], sites: readonly Site[]): string {
  const named = sites.filter((site) => siteIds.includes(site.id));

  if (named.length === 0) return 'No plants';
  if (named.length === sites.length) return sites.length > 1 ? 'Both plants' : named[0]!.name;
  if (named.length === 1) return `${named[0]!.name} only`;

  return named.map((site) => site.name).join(', ');
}

/**
 * El aviso que acompaña al alcance.
 *
 * Dice la consecuencia y no la elección: el autor acaba de ver qué eligió: lo que no puede
 * ver es que esa elección recorta el desplegable de cada sección. Nombrar las plantas en el
 * texto —y no decir «the selected plants»— es lo que hace que se lea como una frase sobre
 * SU plantilla y no como una leyenda genérica.
 */
export function scopeNotice(siteIds: readonly string[], sites: readonly Site[]): string {
  const named = sites.filter((site) => siteIds.includes(site.id));

  if (named.length === 0) {
    return 'This template names no plant yet, so no section can name a location.';
  }

  const list =
    named.length === 1
      ? named[0]!.name
      : `${named.slice(0, -1).map((site) => site.name).join(', ')} and ${named.at(-1)!.name}`;

  return named.length === 1
    ? `This template will only be available at ${list}. Its sections can name any location mapped there in Location mapping.`
    : `This template will be available at ${list}. Its sections can only name locations mapped at every one of them — map the missing ones in Location mapping.`;
}

/**
 * Las opciones del selector de alcance: una por planta, más «todas» cuando hay más de una.
 *
 * La baja no saca la planta de `user_site_scope`, así que el selector filtra por su cuenta.
 * El filtro no sube a `index.tsx`: rompería el «Both plants» de `scopeLabel` y dejaría un
 * `site_ids` viejo sin nombre. `SitePicker` resuelve lo mismo al revés —muestra las cerradas
 * para poder mirar historia—, y ambas decisiones son correctas para su pantalla.
 *
 * El orden es «cada planta sola» y después «las dos», que es el del mockup y también el
 * orden en que se decide: primero se pregunta si esto es de una planta, y «las dos» es la
 * respuesta por descarte. Con una sola planta configurada devuelve una sola opción, y el
 * componente entonces no se dibuja: no hay nada que elegir.
 */
export function scopeOptions(
  sites: readonly Site[],
): { label: string; siteIds: readonly string[] }[] {
  const ordered = sites
    .filter((site) => site.deactivated_at === null)
    .sort((a, b) => a.name.localeCompare(b.name));
  const single = ordered.map((site) => ({
    label: scopeLabel([site.id], ordered),
    siteIds: [site.id],
  }));

  if (ordered.length < 2) return single;

  return [...single, { label: scopeLabel(ordered.map((site) => site.id), ordered), siteIds: ordered.map((site) => site.id) }];
}

/**
 * A qué plantas alcanza una sección, DERIVADO del mapeo de su ubicación.
 *
 * No es un campo del documento y no va a serlo: la respuesta ya está en el catálogo, y
 * guardarla sería guardar una copia que se desactualiza en cuanto alguien mapea o desmapea
 * una ubicación en la consola de Locations.
 */
export function sectionAppliesTo(
  section: TemplateDraftSection,
  locations: readonly Location[],
  siteIds: readonly string[],
  sites: readonly Site[],
): string {
  const code = section.organization_location_code;

  if (!code) return 'No location yet';

  const covered = [...locationCoverage(code, locations, siteIds)]
    .filter(([, resolved]) => resolved !== undefined)
    .map(([siteId]) => siteId);

  return covered.length === 0 ? 'No plant has this location' : scopeLabel(covered, sites);
}

/** Los tres números del panel de resumen. */
export function summaryCounts(
  document: TemplateDraftDocument,
  locations: readonly Location[],
  siteIds: readonly string[],
): { sections: number; questions: number; locationsLinked: number } {
  const linked = new Set(
    document.sections
      .map((section) => section.organization_location_code)
      .filter((code): code is string => Boolean(code) && isFullyCovered(code, locations, siteIds)),
  );

  return {
    sections: document.sections.length,
    questions: totalItems(document),
    locationsLinked: linked.size,
  };
}
