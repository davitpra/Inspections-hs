/**
 * Qué hace que una cuenta pueda recibir una inspección en una planta, escrito UNA vez.
 *
 * §4, nota de vocabulario: los 7 miembros del JHSC son los únicos que ejecutan
 * inspecciones, y «inspector» y «miembro del JHSC» son la misma cosa. Un gerente con las
 * mejores intenciones no puede recibir una.
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
 * conserva su forma —proyecta el rol y el alcance por separado— porque produce TRES
 * mensajes distintos según cuál de las tres condiciones falló, y hay tests que los
 * afirman. Un booleano compartido daría un solo «inspector inválido» y perdería la parte
 * útil del error. Lo compartido son las condiciones, no la decisión.
 */

/** La cuenta existe y no está desactivada. */
export const ACCOUNT_IS_ACTIVE = 'u.deactivated_at IS NULL';

/** El rol que ejecuta inspecciones, y el único. */
export const ACCOUNT_IS_JHSC_MEMBER = `u.role = 'jhsc_member'`;

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
 * Las tres condiciones juntas, para quien quiere la lista y no el diagnóstico.
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
      AND ${ACCOUNT_IS_JHSC_MEMBER}
      AND ${siteScopeIsActive(siteParam)}`;
}
