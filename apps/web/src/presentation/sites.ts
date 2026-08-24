import type { Site } from '@hs/contracts';

/**
 * Qué plantas se pueden elegir, y en cuál abre una consola.
 *
 * `GET /sites` devuelve también las dadas de baja, y eso está bien: una regla o un período
 * viejo de una planta cerrada tiene que seguir resolviendo a un nombre en vez de a un UUID.
 * La política del servidor es explícita —quien arma un selector filtra por su cuenta— y
 * esto es ese filtro, en un solo lugar porque lo comparten la consola de programación y la
 * del roster.
 *
 * Y NO ALCANZA CON FILTRAR LA LISTA. Dar de baja una planta no la saca de `user_site_scope`,
 * así que sigue en el alcance de la cuenta; si la consola abre en `siteScope[0]` a secas,
 * abre en la cerrada y dibuja un calendario vacío. Por eso la planta por defecto también
 * se decide acá.
 */

/**
 * Las que se pueden elegir, EN EL ORDEN EN QUE VINO LA RESPUESTA — que es el de antigüedad:
 * `GET /sites` ordena por `created_at`.
 *
 * No se reordena acá a propósito. Alfabético dejaba la planta original detrás de cualquier
 * alta posterior que empezara con una letra más chica, y el orden de la interfaz cambiaba
 * al renombrar una planta. La primera opción es la primera planta que se dio de alta, y esa
 * también es la que abre la consola (ver `resolveSiteId`).
 */
export function activeSites(sites: readonly Site[]): Site[] {
  return sites.filter((site) => site.deactivated_at === null);
}

/**
 * La planta que la consola mira: la elegida si sigue activa, si no la primera activa —la
 * más antigua— dentro del alcance de la cuenta, y `''` cuando no queda ninguna.
 *
 * EL ORDEN ES EL DE LAS OPCIONES, no el de `siteScope`: los ids del alcance vienen ordenados
 * por UUID, que es azar, así que abrir en `siteScope[0]` era abrir en una planta cualquiera.
 * La consola abre en la primera opción del selector, que es lo que el selector ya muestra.
 *
 * El caso del medio no es solo el arranque: una planta se puede dar de baja con la consola
 * abierta, y entonces la elección guardada en el estado apunta a algo que el selector ya no
 * ofrece. Devolver `''` en vez de la primera cerrada es deliberado — la consola no tiene
 * nada que mostrar y lo dice, en lugar de fingir un calendario.
 */
export function resolveSiteId(
  sites: readonly Site[],
  siteScope: readonly string[],
  chosen: string | null,
): string {
  const options = activeSites(sites).filter((site) => siteScope.includes(site.id));

  if (chosen !== null && options.some((site) => site.id === chosen)) return chosen;

  return options[0]?.id ?? '';
}
