import type { TemplateDraftSummary, TemplateOption } from '@hs/contracts';

/**
 * La lógica pura del listado de borradores.
 *
 * **No hay derivación de `key` acá y no es un olvido.** La clave la deriva el servidor del
 * nombre (`apps/api/src/templates/template-key.ts`) y vuelve resuelta en la respuesta: el
 * autor no la elige, así que una copia en el cliente solo serviría para previsualizar algo
 * que nadie decide, y sería una segunda implementación de una identidad que tiene que ser
 * una sola.
 */

/**
 * El más trabajado primero.
 *
 * El servidor ya ordena por `updated_at DESC`, y esto lo vuelve a hacer igual: el orden de
 * una lista es de la pantalla, y depender de que el endpoint no cambie el suyo hace que un
 * día se reordene sola sin que nadie lo haya pedido acá.
 */
export function sortDrafts(drafts: readonly TemplateDraftSummary[]): TemplateDraftSummary[] {
  return [...drafts].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

/**
 * Si el nombre alcanza para crear.
 *
 * Un nombre en blancos no es un nombre. Lo que NO se comprueba acá es si de él sale una
 * clave utilizable —`"???"` pasa este filtro y lo rechaza el servidor con
 * `template_draft_name_unusable`—: replicar esa regla en el cliente sería mantener dos veces
 * la misma derivación para adelantar un error que ya se lee inline.
 */
export function canCreate(name: string): boolean {
  return name.trim().length > 0;
}

/**
 * Cuántos borradores hay, en el encabezado de la tarjeta que los lista.
 *
 * En palabras y no un número suelto: "3" al lado de un título es un número sin unidad, y
 * el singular importa porque el primer borrador es el caso que más veces se ve.
 */
export function draftCountLabel(count: number): string {
  return count === 1 ? '1 draft' : `${count} drafts`;
}

/** Las publicadas son referencia: se buscan por nombre, no por la fecha de publicación. */
export function sortPublishedTemplates(
  templates: readonly TemplateOption[],
): TemplateOption[] {
  return [...templates].sort((a, b) => a.name.localeCompare(b.name));
}

/** La versión es el dato que distingue el documento congelado que se está nombrando. */
export function publishedVersionLabel(version: number): string {
  return `Version ${version}`;
}

/** El encabezado conserva la unidad incluso cuando hay una sola plantilla. */
export function publishedCountLabel(count: number): string {
  return count === 1 ? '1 template' : `${count} templates`;
}
