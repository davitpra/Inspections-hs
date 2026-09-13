import { isAdministrator, type Session } from '@hs/contracts';

/**
 * Qué le ofrece la interfaz a cada cuenta.
 *
 * **Esto es comodidad, no garantía, y la distinción es toda la razón del archivo.** La
 * garantía la da el servidor: `/roster` comprueba el rol en la lectura y contesta 403, y
 * el resto está detrás de RLS. Un link ausente le ahorra a alguien abrir una pantalla sin
 * controles; no impide nada. Si alguna vez esto es lo único que separa a un rol de un
 * dato, el error está del otro lado.
 *
 * **Y las dos consolas no se condicionan igual por dentro** —lo que `router.tsx` explica
 * al lado de los links y conviene no perder de vista acá:
 *
 *   - `/scheduling` sigue siendo alcanzable por URL y se renderiza de solo lectura; sus
 *     GET no comprueban rol y RLS ya recorta lo que se ve. Que un miembro del JHSC vea la
 *     programación de su planta es legítimo.
 *   - `/roster` no. Ahí el rol se comprueba también en la lectura, en el cliente y en el
 *     servidor: §4 dice que se elige a una persona sin poder ver su perfil, y un roster de
 *     solo lectura para un miembro del JHSC sería exactamente esa ficha.
 *
 *   - `/templates` tampoco. Ahí el rol se comprueba en la lectura, igual que en `/roster`,
 *     y por una razón propia: un borrador es una plantilla a medio pensar, y mostrarlo
 *     sería mostrar preguntas que la organización todavía no decidió hacer.
 *
 * **Una función por decisión.** Las decisiones administrativas delegan en la regla común de
 * contracts, pero conservan nombres distintos para que una separación futura de permisos
 * cambie la decisión correcta y no obligue a reconstruir qué preguntaba cada llamada.
 *
 * Van acá y no en cada ruta porque todas cruzan pantallas, y aparte del componente para
 * poder probarlas sin renderizar.
 *
 * Todas son predicados de tipo y no `boolean` a secas, porque conceder implica haber
 * resuelto la cuenta: quien pregunta puede usar el `account` adentro del `if` sin volver
 * a comprobar que existe, que es lo que hacía el `account?.role !== …` que reemplazan.
 */

export function canAdminister(account: Session | null): account is Session {
  return account !== null && isAdministrator(account.role);
}

export function canAdministerRoster(account: Session | null): account is Session {
  return canAdminister(account);
}

/** Quién puede aplicar un archivo completo al roster. */
export function canImportRoster(account: Session | null): account is Session {
  return canAdminister(account);
}

/**
 * Quién puede agregar UNA persona al roster a mano (`add-person-to-roster-by-hand`).
 * Predicado propio y no reuso de `canImportRoster`: son dos actos distintos —crear una
 * fila nueva contra aplicar un archivo entero— y el día que uno se abra a otro rol sin
 * el otro, esta es la que cambia.
 */
export function canAddPersonToRoster(account: Session | null): account is Session {
  return canAdminister(account);
}

/**
 * Quién ve el botón de invitar en la fila del roster (proposal — "el rol de la
 * invitación desde el roster es `jhsc_member` y solo ese"). Hoy coincide con
 * `canAdministerRoster` porque los dos preguntan hoy por autoridad administrativa,
 * pero es la pregunta de invitar y no la de administrar el roster: el día
 * que la consola se abra de lectura a otro rol sin darle el botón, esta es la que
 * cambia y `canAdministerRoster` no.
 */
export function canInviteFromRoster(account: Session | null): account is Session {
  return canAdminister(account);
}

export function canAdministerScheduling(account: Session | null): account is Session {
  return canAdminister(account);
}

/** Quién puede revisar las inspecciones completadas de todos sus sitios. */
export function canReviewSiteInspections(account: Session | null): account is Session {
  return canAdminister(account);
}

/**
 * Quién escribe plantillas (§6 — "el coordinador administra plantillas y roster").
 *
 * A diferencia de `canAdministerScheduling`, esta condiciona también la LECTURA: el servidor
 * contesta `template_draft_forbidden` en las cinco rutas de borrador, el `GET` incluido, así
 * que una pantalla de solo lectura para otro rol sería una pantalla vacía con un error.
 *
 * Es sobre BORRADORES, no sobre plantillas publicadas. `GET /templates` sigue abierto y lo
 * consume `/scheduling`: gatear eso rompería la consola de programación para todos.
 */
export function canAuthorTemplates(account: Session | null): account is Session {
  return canAdminister(account);
}

/** Quién puede convertir un borrador guardado en una versión publicada. */
export function canPublishTemplates(account: Session | null): account is Session {
  return canAdminister(account);
}

/**
 * Quién puede RETIRAR una plantilla ya publicada del catálogo, y devolverla.
 *
 * Separada de `canAuthorTemplates` aunque hoy comparen el mismo rol, porque no es la misma
 * decisión: aquella habla de escribir un documento que todavía no existe, y esta de sacar
 * de circulación uno que ya se usó para inspeccionar. El día que una de las dos se abra a
 * otro rol, el que las tenga separadas no va a tener que averiguar cuál de los usos de una
 * función compartida quería decir qué.
 */
export function canDeactivateTemplates(account: Session | null): account is Session {
  return canAdminister(account);
}

export function canAdministerCatalog(account: Session | null): account is Session {
  return canAdminister(account);
}

/** Quién decide quién es coordinador: management puede promover y degradar. */
export function canPromote(account: Session | null): account is Session {
  return account?.role === 'management';
}

/** Quién puede devolver un coordinador a miembro del JHSC. */
export function canDemote(account: Session | null): account is Session {
  return account?.role === 'management';
}
