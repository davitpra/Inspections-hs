/**
 * Qué hace que una cuenta pueda recibir una inspección en una planta, escrito UNA vez.
 *
 * §4, nota de vocabulario: los miembros del JHSC son los únicos que ejecutan inspecciones,
 * y «inspector» y «miembro del JHSC» son la misma cosa. Un gerente con las mejores
 * intenciones no puede recibir una.
 *
 * PERO EL COMITÉ NO ES UN ROL, y esa es la corrección que trae `coordinator-jhsc-seat`.
 * Que estar en el JHSC y tener el rol `jhsc_member` coincidan es cierto para los siete
 * miembros, no una regla: la coordinadora también se sienta en el comité, y como
 * `app_user.person_id` es UNIQUE no existe una segunda cuenta que dárselo. Por eso la
 * pregunta que se hace acá pasó de ser sobre el ROL a ser sobre el ASIENTO, con sus dos
 * casos — y el `CHECK` de 0035 garantiza que el segundo solo alcanza a `hs_coordinator`.
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

/** El rol cuya sola existencia ya pone a la cuenta en el comité. */
export const ACCOUNT_IS_JHSC_MEMBER = `u.role = 'jhsc_member'`;

/**
 * El asiento otorgado a una cuenta de coordinador (0035). No hace falta comprobar el rol
 * acá: el `CHECK` del motor no deja que esta columna sea no-nula para ningún otro.
 */
export const ACCOUNT_HOLDS_JHSC_SEAT = 'u.jhsc_seat_granted_at IS NOT NULL';

/**
 * Se sienta en el JHSC — por el rol, o por el asiento.
 *
 * **Los paréntesis no son cosméticos**: esto se mezcla con `AND` en `isEligibleInspector`,
 * y sin ellos la disyunción se comería el resto de las condiciones y cualquier cuenta con
 * asiento quedaría elegible en toda planta, con alcance o sin él.
 */
export const ACCOUNT_SITS_ON_JHSC = `(${ACCOUNT_IS_JHSC_MEMBER} OR ${ACCOUNT_HOLDS_JHSC_SEAT})`;

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
      AND ${ACCOUNT_SITS_ON_JHSC}
      AND ${siteScopeIsActive(siteParam)}`;
}
