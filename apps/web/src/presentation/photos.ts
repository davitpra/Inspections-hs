import type { UploadState } from '../offline/db';

/**
 * Cómo se lee en pantalla el estado de una foto del borrador.
 *
 * Vive acá y no en una ruta porque `components/PhotoField.tsx` lo dibuja en la captura y
 * en la revisión, y las dos tienen que decir lo mismo de la misma foto.
 *
 * La distinción que importa: `pending` NO es un problema. Por ADR-001/ADR-006 las fotos
 * suben antes del envío y no al sacarlas, así que una foto recién tomada está pendiente
 * SIEMPRE —también con red y con la aplicación abierta— y decirle «Not uploaded» en ámbar
 * al inspector le anuncia un fallo donde no lo hay: lo manda a reintentar algo que
 * todavía no se intentó. Lo que sí es un problema es `failed`, y ése es el único que se
 * pinta como aviso.
 */

/** El texto bajo la miniatura. */
export function photoStateLabel(state: UploadState): string {
  switch (state) {
    case 'uploaded':
      return 'Uploaded';
    case 'pending':
      return 'Saved on device';
    case 'failed':
      return 'Upload failed — will retry';
  }
}

/**
 * La clase del texto. `pending` es neutro (la foto está guardada, es lo que se prometió);
 * solo `failed` se lleva el modificador de aviso.
 */
export function photoStateClass(state: UploadState): string {
  return state === 'failed' ? 'photos__state photos__state--failed' : 'photos__state';
}
