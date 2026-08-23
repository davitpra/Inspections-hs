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

/** Las que se pueden elegir, en orden alfabético — el mismo que usa la consola de ubicaciones. */
export function activeSites(sites: readonly Site[]): Site[] {
  return sites
    .filter((site) => site.deactivated_at === null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * La planta que la consola mira: la elegida si sigue activa, si no la primera activa del
 * alcance, y `''` cuando no queda ninguna.
 *
 * EL ORDEN ES EL DEL ALCANCE, no el alfabético de las opciones: la planta por defecto es la
 * de la cuenta —la primera de `siteScope`— y lo único que cambia es que se saltea las
 * cerradas. Ordenar acá también movería la consola de planta sin que nadie la haya tocado.
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
  const isAvailable = (id: string): boolean =>
    siteScope.includes(id) && sites.some((site) => site.id === id && site.deactivated_at === null);

  if (chosen !== null && isAvailable(chosen)) return chosen;

  return siteScope.find(isAvailable) ?? '';
}
