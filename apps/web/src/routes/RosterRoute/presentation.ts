import {
  ROLE_LABELS,
  type Person,
  type PersonWithAccount,
  type RosterImportReport,
  type RosterRejection,
} from '@hs/contracts';

export type ImportState = 'empty' | 'ready' | 'pending' | 'success' | 'error';

export function importSummary(report: RosterImportReport): string {
  return `${report.rows_read} rows read, ${report.rows_applied} applied, ${report.rows_rejected} rejected.`;
}

export function sortRejections(rejections: readonly RosterRejection[]): RosterRejection[] {
  return [...rejections].sort((a, b) => a.row_number - b.row_number);
}

export function importButtonText(state: ImportState): string {
  return state === 'pending' ? 'Importing…' : state === 'error' ? 'Try again' : 'Import people';
}

/** El alta de UNA persona no tiene un estado `success` propio: el diálogo se cierra solo. */
export type AddPersonState = 'ready' | 'pending' | 'error';

export function addPersonButtonText(state: AddPersonState): string {
  return state === 'pending' ? 'Adding…' : state === 'error' ? 'Try again' : 'Add person';
}

/**
 * Cómo se lee la consola del roster: etiquetas, orden y búsqueda, sin marcado.
 *
 * La consola no corrige nombres ni transfiere personas fila por fila. Además de cómo se
 * muestra y encuentra el roster, este archivo decide qué acciones admite cada estado,
 * incluida la baja lógica estrecha de un worker sin cuenta.
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

/** Iniciales para identificar visualmente una fila sin convertirlas en parte del nombre. */
export function personInitials(person: Person): string {
  return `${person.first_name.charAt(0)}${person.last_name.charAt(0)}`.toUpperCase();
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
 *
  * La membresía del comité sigue al rol, así que la etiqueta no necesita un estado adicional.
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
 * roster otorga: una cuenta administrativa inactiva no se revive apretando "invitar", y el
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
 * propio `deactivated_at` sin que la persona lo esté, y reemitir un link para una cuenta
 * inactiva es lo que el servidor ya rechaza.
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
 * una cuenta administrativa no se da de baja desde una lista de doscientas
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

/** La promoción solo aplica a una cuenta activa que todavía es miembro del JHSC. */
export function canPromoteAccount(person: PersonWithAccount): boolean {
  return person.account !== null && person.account.active && person.account.role === 'jhsc_member';
}

export function promoteButtonLabel(person: PersonWithAccount): string {
  return `Promote ${personLabel(person)} to H&S coordinator`;
}

/** La degradación solo aplica a una cuenta activa que actualmente es coordinador. */
export function canDemoteAccount(person: PersonWithAccount): boolean {
  return person.account !== null && person.account.active && person.account.role === 'hs_coordinator';
}

export function demoteButtonLabel(person: PersonWithAccount): string {
  return `Demote ${personLabel(person)} to JHSC member`;
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

/** La acción y la etiqueta Worker comparten exactamente la ausencia de una cuenta activa. */
export function canDeactivateWorker(person: PersonWithAccount): boolean {
  return person.deactivated_at === null && !showsAccountRole(person);
}

/**
 * Lo que dice la celda Role de una fila cualquiera.
 *
 * **"Worker" NO es un rol, y esa es toda la sutileza de esta función.** `ROLES` tiene tres
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

/**
 * Lo que dice la celda App access: si esta persona entra a la app, sin obligar a inferirlo
 * por el color de la píldora.
 *
 * **"No access" y no "Not invited"**, aunque la fila de al lado ofrezca justamente invitar:
 * `showsAccountRole` mete en este caso dos historias distintas —quien nunca tuvo cuenta y
 * aquella a la que se le quitó el acceso (`remove-jhsc-access-from-roster`)—, y "Not
 * invited" mentiría sobre la segunda. "No access" es cierto para las dos, que es lo único
 * que la columna promete.
 *
 * Sustantivos y no frases: la columna se lee hacia abajo, comparando filas entre sí.
 */
export function accessCellLabel(person: PersonWithAccount): string {
  if (!showsAccountRole(person)) return 'No access';
  return person.account!.can_sign_in ? 'Active' : 'Invited';
}

export function accessCellClass(person: PersonWithAccount): string {
  if (!showsAccountRole(person)) return 'roster__access roster__access--none';
  return person.account!.can_sign_in
    ? 'roster__access roster__access--active'
    : 'roster__access roster__access--pending';
}

/**
 * La clase de la píldora de la celda Role.
 *
 * Tres estados y no dos, porque son tres preguntas distintas para quien mira la columna:
 * quien ya entra (verde, no hay nada que hacer), quien fue invitado y todavía no (ámbar,
 * espera algo de alguien — el mismo tinte que usa el resto de la app para eso) y quien no
 * tiene acceso (gris apagado, que es la situación NORMAL del roster y no una falta; ver
 * `roleCellLabel`).
 *
 * El texto lo sigue diciendo `roleCellLabel`: la píldora no reemplaza la palabra, la ubica.
 * Un color solo no dice nada a quien no lo distingue.
 */
export function roleCellClass(person: PersonWithAccount): string {
  if (!showsAccountRole(person)) return 'status-pill status-pill--not-opened';

  return person.account!.can_sign_in
    ? 'status-pill status-pill--ready'
    : 'status-pill status-pill--not-ready';
}

/**
 * Los tres números del encabezado: cuánta gente hay, cuánta entra, y cuánta invitación
 * está esperando.
 *
 * NO SON UN RESUMEN DECORATIVO: la pregunta que trae al coordinador a esta pantalla es
 * "¿quién del comité tiene acceso hoy?", y con doscientas filas esa respuesta no se cuenta
 * a ojo. `invited` es además lo único accionable de la pantalla —cada uno de esos es un
 * link que puede haberse perdido y que se reemite desde su fila.
 *
 * Se cuentan sobre el roster ENTERO y no sobre lo filtrado: son el estado de la planta, no
 * el de la búsqueda. Lo que la búsqueda recortó lo dice el contador de la tabla.
 */
export function rosterCounts(people: readonly PersonWithAccount[]): {
  total: number;
  withAccess: number;
  invited: number;
} {
  return {
    total: people.length,
    withAccess: people.filter((person) => showsAccountRole(person) && person.account!.can_sign_in)
      .length,
    invited: people.filter(canReissueInvitation).length,
  };
}

export type RosterActionKind =
  | 'invite'
  | 'reissue'
  | 'remove'
  | 'deactivate'
  | 'promote'
  | 'demote';

/** Un acto que una fila ofrece: cómo se dibuja el botón, sin decir cómo se ejecuta. */
export interface RosterRowAction {
  kind: RosterActionKind;
  text: string;
  label: string;
  className: string;
}

/**
 * Los actos que esta fila ofrece, en orden, y NADA cuando no ofrece ninguno.
 *
 * Cada fila ofrece SOLO los actos que su estado admite: sin cuenta y activa → invitar o dar
 * de baja; con
 * cuenta que todavía no entra → reemitir el link y cancelar la invitación; con cuenta que
  * ya entra → quitar del JHSC y, para management, promover o degradar. Nada para quien no tiene acceso y está dado de baja —
 * invitar a esa fila es exactamente lo que 4.5 no ofrece, y su celda queda vacía a
 * propósito: la columna existe porque OTRAS filas tienen un acto.
 *
 * `mayInvite` entra como parámetro y no se comprueba fila por fila en la pantalla: es la
 * misma pregunta para las doscientas filas, y repetirla en cada botón era lo que hacía que
 * la celda se leyera como cuatro condiciones distintas cuando es una sola tabla de estados.
 */
export function rowActions(
  person: PersonWithAccount,
  mayInvite: boolean,
  mayPromote = false,
  mayDemote = false,
): RosterRowAction[] {
  if (!mayInvite) return [];

  const actions: RosterRowAction[] = [];

  if (canInvite(person)) {
    actions.push({
      kind: 'invite',
      text: 'Invite to JHSC',
      label: inviteButtonLabel(person),
      className: 'button--outline roster__action',
    });
  }

  if (canDeactivateWorker(person)) {
    actions.push({
      kind: 'deactivate',
      text: 'Remove worker',
      label: `Remove ${personLabel(person)} from the roster`,
      className: 'button--danger-quiet roster__action',
    });
  }

  if (canReissueInvitation(person)) {
    actions.push({
      kind: 'reissue',
      text: 'New link',
      label: reissueButtonLabel(person),
      className: 'roster__action',
    });
  }

  if (canRemoveJhscAccess(person)) {
    actions.push({
      kind: 'remove',
      text: removeButtonText(person),
      label: removeButtonLabel(person),
      className: 'button--danger-quiet roster__action',
    });
  }

  if (mayPromote && canPromoteAccount(person)) {
    actions.push({
      kind: 'promote',
      text: 'Promote',
      label: promoteButtonLabel(person),
      className: 'button--outline roster__action',
    });
  }

  if (mayDemote && canDemoteAccount(person)) {
    actions.push({
      kind: 'demote',
      text: 'Demote',
      label: demoteButtonLabel(person),
      className: 'button--outline roster__action',
    });
  }

  return actions;
}

/**
 * El modal que abre un acto, con lo que necesita YA COPIADO de la fila.
 *
 * **Por qué se congela acá y no se lee después de la fila**: cada una de estas mutaciones
 * invalida el roster, y el refetch devuelve a esa persona con otro estado —invitar le da
 * cuenta, quitar le saca el botón, sentar la levanta—. El modal vive fuera de la tabla
 * justamente para sobrevivir a eso, así que `canSignIn` y la dirección del asiento viajan
 * con el estado: si se releyeran de un roster ya invalidado, la pregunta del diálogo podría
 * cambiar de texto debajo del cursor.
 */
export type RosterDialog =
  | { kind: 'invite'; personId: string; label: string }
  | { kind: 'deactivate'; personId: string; label: string }
  | { kind: 'reissue'; userId: string; label: string }
  | { kind: 'remove'; userId: string; label: string; canSignIn: boolean }
  | { kind: 'promote'; userId: string; label: string }
  | { kind: 'demote'; userId: string; label: string };

/** Ver `RosterDialog`. Los actos de cuenta se resuelven después de los dos de persona. */
export function dialogFor(person: PersonWithAccount, action: RosterRowAction): RosterDialog {
  const label = personLabel(person);

  if (action.kind === 'invite') return { kind: 'invite', personId: person.id, label };
  if (action.kind === 'deactivate') return { kind: 'deactivate', personId: person.id, label };

  const userId = person.account!.id;

  if (action.kind === 'reissue') return { kind: 'reissue', userId, label };

  if (action.kind === 'remove') {
    return { kind: 'remove', userId, label, canSignIn: person.account!.can_sign_in };
  }

  if (action.kind === 'promote') return { kind: 'promote', userId, label };
  if (action.kind === 'demote') return { kind: 'demote', userId, label };

  throw new Error('Accion de roster desconocida.');
}
