/**
 * Qué hace que una cuenta pueda recibir una inspección en una planta, escrito UNA vez.
 *
 * La membresía del JHSC vuelve a derivarse del rol: `inspector`, `coordinator` y
 * `management` pertenecen al comité mientras estén activos. Por eso la elegibilidad
 * ya no pregunta por un asiento separado, sino por actividad y alcance vigente.
 *
 * POR QUÉ ESTO ES UN MÓDULO Y NO DOS CONSULTAS PARECIDAS. Desde que existe una pantalla
 * de asignación hay dos lugares que preguntan lo mismo: el listado, que ofrece
 * candidatos, y la validación, que acepta o rechaza la asignación. Si divergen, la
 * pantalla ofrece cuentas que el servidor después rechaza con `inspector_invalid` — y esa
 * es la peor falla posible de una UI de asignación, porque el coordinador la provoca
 * haciendo exactamente lo único que la pantalla le pide hacer. La propiedad que hay que
 * sostener es: **todo lo que la lista ofrece, la asignación lo acepta.**
 *
 * LO QUE ESTE MÓDULO NO ABSORBE: la función de validación entera. `requireInspector`
 * conserva su forma —proyecta actividad y alcance por separado— porque produce DOS
 * mensajes distintos según cuál de las dos condiciones falló. Lo compartido son las
 * condiciones, no la decisión.
 */

/** La cuenta existe y no está desactivada. */
export const ACCOUNT_IS_ACTIVE = 'u.deactivated_at IS NULL';

/**
 * Tiene alcance VIGENTE sobre la planta. `revoked_at IS NULL` y no una fecha de
 * expiración: el alcance se revoca, no vence.
 *
 * Es una función y no una constante porque el placeholder del sitio cae en índices
 * distintos en las dos consultas, y escribir `$2` fijo acá haría que la segunda tuviera
 * que acomodarse a la primera.
 */
export function siteScopeIsActive(siteParam: string): string {
  return `EXISTS (
            SELECT 1 FROM user_site_scope s
             WHERE s.user_id = u.id AND s.site_id = ${siteParam} AND s.revoked_at IS NULL
          )`;
}

/**
 * Las dos condiciones juntas, para quien quiere la lista y no el diagnóstico.
 *
 * Se usa con `FROM app_user u` y, si hace falta el nombre, con **`LEFT JOIN person`**:
 * la elegibilidad se define sobre `user_site_scope`, pero el nombre vive en `person`,
 * que está aislada por sitio y cuyo `site_id` es una columna propia y mutable. Una cuenta
 * elegible cuya persona está en la otra planta existe —alguien que cubre las dos, alguien
 * que se mudó— y un `INNER JOIN` la borraría de la lista sin error y sin síntoma. La
 * lista y la validación volverían a divergir, por la puerta de atrás.
 */
export function isEligibleInspector(siteParam: string): string {
  return `${ACCOUNT_IS_ACTIVE}
      AND ${siteScopeIsActive(siteParam)}`;
}
