import { ROLE_LABELS, type Person, type PersonWithAccount } from '@hs/contracts';

/**
 * Cómo se lee la consola del roster: etiquetas, orden y búsqueda, sin marcado.
 *
 * La consola es de solo lectura, así que acá no hay nada sobre qué se puede cambiar: solo
 * cómo se muestra y cómo se encuentra.
 *
 * Aparte del componente por la misma razón que `scheduling-presentation.ts`: lo que
 * importa es la decisión y el nombre de cada cosa, y eso se prueba sin renderizar nada.
 */

/**
 * El nombre, apellido primero, que es como se ordena y como se busca.
 *
 * **Sale sin el número de empleado porque la tabla le da una columna propia**, y esa
 * columna no es decoración: el nombre NO identifica —dos personas activas pueden llamarse
 * igual y §4 lo permite explícitamente—, así que una fila sin el número deja al
 * coordinador eligiendo entre dos idénticas. En una lista de una sola columna el número
 * iba pegado al nombre; acá lo sostiene el encabezado.
 */
export function personName(person: Person): string {
  return `${person.last_name}, ${person.first_name}`;
}

/**
 * La persona identificada en una sola línea, para donde no hay columnas: el nombre
 * accesible de un control que actúa sobre una fila. Un botón que solo dice "Invite" se
 * anuncia igual en las doscientas filas.
 */
export function personLabel(person: Person): string {
  return `${personName(person)} (${person.employee_number})`;
}

/** El nombre accesible del botón corto de la fila. Ver `personLabel`. */
export function inviteButtonLabel(person: Person): string {
  return `Invite ${personLabel(person)} to JHSC`;
}

/**
 * Si esta persona entra en la búsqueda.
 *
 * Busca en apellido, nombre y número de empleado: quien tiene el número lo tipea, y quien
 * no, escribe un apellido a medias. Sin distinguir mayúsculas ni acentos —`normalize` más
 * el rango de diacríticos—, porque "Álvarez" tipeado sin tilde tiene que encontrar.
 */
export function matchesSearch(person: Person, query: string): boolean {
  const needle = normalise(query);
  if (needle === '') return true;

  return [person.first_name, person.last_name, person.employee_number]
    .map(normalise)
    .some((field) => field.includes(needle));
}

function normalise(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * El orden de la lista: apellido, nombre y —como desempate— número de empleado.
 *
 * El tercer criterio no sobra: la spec permite dos personas activas con el mismo nombre y
 * apellido, y sin él las dos filas se intercambiarían de lugar entre renders.
 */
export function sortRoster<T extends Person>(people: readonly T[]): T[] {
  return [...people].sort(
    (a, b) =>
      a.last_name.localeCompare(b.last_name) ||
      a.first_name.localeCompare(b.first_name) ||
      a.employee_number.localeCompare(b.employee_number),
  );
}

/**
 * La celda Role (proposal — "la tabla del roster gana una columna Role y una acción por
 * fila"). La acción vive en su propia columna; acá solo el rol de quien tiene cuenta.
 *
 * `ROLE_LABELS` de contracts, nunca una etiqueta inventada por la pantalla: es el mismo
 * vocabulario de §4 que ya usa cada otra pantalla que muestra un rol.
 *
 * `(invited)` y no una segunda columna: `can_sign_in` en falso es exactamente la
 * diferencia entre "invitada" y "entrando" (design D2), y es lo único que el coordinador
 * necesita para saber si tiene que reenviar el link.
 *
 * **No contempla la cuenta inactiva, y no es un olvido**: una cuenta a la que se le quitó
 * el acceso no llega hasta acá. Para el roster esa persona no tiene cuenta, y su fila se
 * dibuja igual que la de quien nunca tuvo una (`remove-jhsc-access-from-roster`).
 */
export function accountRoleLabel(account: NonNullable<PersonWithAccount['account']>): string {
  const label = ROLE_LABELS[account.role];

  return account.can_sign_in ? label : `${label} (invited)`;
}

/**
 * Si esta fila puede ofrecer el botón de invitar.
 *
 * La persona tiene que estar activa —quien ya no trabaja en la planta no entra al sistema
 * (proposal 4.5)— y tiene que **no tener acceso**, que es lo que significan los dos casos
 * de la segunda condición: nunca tuvo cuenta, o tuvo una de `jhsc_member` y se le quitó.
 *
 * Los dos se ofrecen igual y con el mismo botón a propósito. Que del otro lado el segundo
 * caso reviva la cuenta que ya existía en vez de insertar una nueva —`app_user.person_id`
 * es único, no hay segunda cuenta posible— es un hecho del motor que el servidor resuelve
 * solo: `POST /accounts` decide de qué lado cae. Desde acá, las dos filas son la misma
 * pregunta ("¿le doy acceso a esta persona?") y merecen la misma respuesta.
 *
 * El rol se comprueba en el segundo caso porque el roster solo administra el acceso que el
 * roster otorga: la cuenta inactiva de un supervisor no se revive apretando "invitar", y el
 * servidor la rechazaría.
 */
export function canInvite(person: PersonWithAccount): boolean {
  if (person.deactivated_at !== null) return false;

  return (
    person.account === null || (!person.account.active && person.account.role === 'jhsc_member')
  );
}

/**
 * Si esta fila puede ofrecer "reemitir el link" (design D2 de
 * `reissue-invitation-link-from-roster`). La cuenta que la roster reporta como "no puede
 * entrar todavía" ES exactamente una invitación sin aceptar —vencida o no, perdida o no—,
 * así que no hace falta preguntarle al servidor si hay una pendiente: emitir revoca la que
 * hubiera.
 *
 * `active` y no `deactivated_at` de la persona: una cuenta puede quedar inactiva por su
 * propio `deactivated_at` o `expires_at` sin que la persona lo esté, y reemitir un link
 * para una cuenta inactiva es lo que el servidor ya rechaza.
 */
export function canReissueInvitation(person: PersonWithAccount): boolean {
  return person.account !== null && person.account.active && !person.account.can_sign_in;
}

/** El nombre accesible del botón de reemitir. Ver `personLabel`. */
export function reissueButtonLabel(person: PersonWithAccount): string {
  return `New invitation link for ${personLabel(person)}`;
}

/**
 * Si esta fila puede ofrecer "quitar el acceso" (`remove-jhsc-access-from-roster`).
 *
 * UNA sola condición sobre `can_sign_in`, y esa ausencia es la decisión: la invitación
 * pendiente y el miembro que ya entra son el mismo acto —dar de baja la cuenta—, así que
 * preguntar por `can_sign_in` acá partiría en dos algo que del otro lado es una sola
 * escritura. Lo que sí cambia según `can_sign_in` es cómo se llama el botón, y eso está en
 * `removeButtonLabel`.
 *
 * `role === 'jhsc_member'` porque el roster administra el acceso que el roster otorga: un
 * supervisor o el coordinador de al lado no se dan de baja desde una lista de doscientas
 * filas. Es la misma regla que el servidor aplica, y acá está para no ofrecer un botón que
 * el servidor va a negar.
 */
export function canRemoveJhscAccess(person: PersonWithAccount): boolean {
  return person.account !== null && person.account.active && person.account.role === 'jhsc_member';
}

/**
 * El nombre accesible del botón de quitar, que es donde vive la diferencia entre los dos
 * casos: "cancelar" cuando el link nunca se usó, "quitar del JHSC" cuando la persona ya
 * entra. Nombrarlos igual dejaría al coordinador confirmando algo que no es lo que cree.
 */
export function removeButtonLabel(person: PersonWithAccount): string {
  return person.account?.can_sign_in
    ? `Remove ${personLabel(person)} from JHSC`
    : `Cancel the invitation of ${personLabel(person)}`;
}

/** El texto corto del botón de quitar, por la misma razón que `removeButtonLabel`. */
export function removeButtonText(person: PersonWithAccount): string {
  return person.account?.can_sign_in ? 'Remove' : 'Cancel invitation';
}

/**
 * Si la celda Role tiene el rol de una cuenta que mostrar.
 *
 * Una cuenta inactiva no lo tiene: para el roster esa persona no tiene cuenta. El rastro de
 * que la tuvo, y de cuándo terminó, vive en la cadena de auditoría — no en una celda de una
 * consola que muestra quién tiene acceso HOY.
 */
export function showsAccountRole(person: PersonWithAccount): boolean {
  return person.account !== null && person.account.active;
}

/**
 * Lo que dice la celda Role de una fila cualquiera.
 *
 * **"Worker" NO es un rol, y esa es toda la sutileza de esta función.** `ROLES` tiene cinco
 * valores y ninguno es este: un trabajador de planta no tiene cuenta, y el rol es un
 * atributo de la cuenta, no de la persona (§4, "A person is a roster record, not an
 * account"). Nadie puede ser *invitado como* worker, ni el servidor lo aceptaría — no
 * existe del otro lado.
 *
 * Entonces por qué escribirlo igual: la celda vacía no distinguía "esta persona no tiene
 * acceso" de "el dato no cargó", y en una tabla de doscientas filas donde la mayoría no
 * tiene cuenta, esa columna se leía como una columna rota. "Worker" nombra la ausencia de
 * acceso, que es la situación normal del roster y no una falta.
 *
 * Por eso vive acá y no en `ROLE_LABELS` de contracts: ese `Record<Role, string>` es el
 * vocabulario de §4 que comparte toda la app, y meterle una clave que no está en `ROLES`
 * ni compilaría. Esta es una etiqueta de esta pantalla, y el día que otra necesite decir lo
 * mismo, sube a `src/components/` — no a contracts.
 */
export function roleCellLabel(person: PersonWithAccount): string {
  return showsAccountRole(person) ? accountRoleLabel(person.account!) : 'Worker';
}

/**
 * Lo que dice la celda Email: la dirección a la que se invitó a esta persona, o nada.
 *
 * **Es el email de la CUENTA, no de la persona.** El roster que mantiene el CSV de ADP no
 * tiene correos —`personSchema` no lo tiene—, así que la columna está vacía exactamente
 * para quien no tiene acceso, que es la mayoría de las filas. Por eso la pregunta la
 * contesta `showsAccountRole` y no un `person.account !== null`: es la misma condición que
 * ya decide la celda Role, y las dos columnas tienen que contar la misma historia. Una
 * cuenta a la que se le quitó el acceso dice "Worker" y no muestra correo — para el roster
 * esa persona no tiene cuenta.
 *
 * La cadena vacía y no un guión: el guión lo pone la celda si quiere, y así el llamador
 * puede preguntar por el vacío sin comparar contra un carácter decorativo.
 */
export function emailCellLabel(person: PersonWithAccount): string {
  return showsAccountRole(person) ? person.account!.email : '';
}
