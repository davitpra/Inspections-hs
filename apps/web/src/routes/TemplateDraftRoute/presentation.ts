import type { TemplateDraftDocument } from '@hs/contracts';

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
 * Si hay algo sin guardar.
 *
 * Se compara el documento CONTRA EL ÚLTIMO GUARDADO y no se lleva un flag `dirty`: un flag
 * queda en `true` después de deshacer a mano lo que se acababa de escribir, y le dice al
 * autor que tiene cambios pendientes cuando ya no los tiene.
 *
 * `JSON.stringify` alcanza porque los dos lados salen del mismo esquema y no llevan claves
 * fuera de orden: el guardado viene del servidor, que lo devolvió tal como lo recibió, y el
 * editado sale de `edits.ts`, que solo copia con spread.
 */
export function hasUnsavedChanges(
  edited: TemplateDraftDocument,
  saved: TemplateDraftDocument,
  editedName: string,
  savedName: string,
): boolean {
  return editedName !== savedName || JSON.stringify(edited) !== JSON.stringify(saved);
}

/** El texto del botón de guardar según en qué está. */
export function saveButtonLabel(pending: boolean, dirty: boolean): string {
  if (pending) return 'Saving…';
  return dirty ? 'Save draft' : 'Saved';
}

/**
 * Qué decir cuando el guardado fue rechazado.
 *
 * `request.ts` pierde el `code` a propósito y deja solo el mensaje, y para este caso alcanza:
 * el mensaje de `template_draft_stale` ya dice qué hacer —recargar antes de volver a
 * guardar—. Lo que agrega esta función es no perder lo escrito: el aviso aclara que el
 * documento sigue en pantalla.
 */
export function saveErrorNotice(message: string): string {
  return `${message} Nothing you typed has been lost — copy anything you need before reloading.`;
}
