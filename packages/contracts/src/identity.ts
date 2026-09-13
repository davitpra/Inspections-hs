import { z } from 'zod';

/**
 * Requisitos §4 ("La distinción central: Persona ≠ Usuario") y §6 pregunta cerrada
 * 3 (importación del roster por archivo).
 *
 * Este archivo es la mitad que ve el cliente: la forma de una persona del roster,
 * la de una cuenta con su rol y su alcance, la de una fila del CSV y la del reporte
 * de una importación.
 *
 * Lo que estos esquemas NO pueden validar es todo lo que depende del estado de la
 * base: que la persona exista, que el número de empleado no esté tomado, que la
 * cuenta no sea la segunda de la misma persona, que el sitio esté en el alcance.
 * Eso son claves foráneas, únicos, políticas RLS y triggers en
 * `apps/api/drizzle/0005_identity.sql`. Zod valida la forma; el motor valida las
 * referencias.
 *
 * **Ninguna forma de credencial aparece acá**, y no es una omisión: la contraseña,
 * la sesión y el TOTP son del change de auth (ADR-011).
 */

/**
 * Los tres roles vigentes de ADR-024.
 *
 * `inspector` es un rol. `inspection.inspector_id` sigue siendo el campo técnico de
 * asignación y se muestra como "Assigned to". El mismo conjunto está escrito como
 * `CHECK` en las migraciones 0046 y 0048. Si uno cambia, el otro también (ADR-024).
 */
export const ROLES = ['coordinator', 'inspector', 'management'] as const;

export const roleSchema = z.enum(ROLES);

export type Role = z.infer<typeof roleSchema>;

/** La autoridad administrativa compartida por coordinador y gerencia (ADR-022). */
export function isAdministrator(role: string): role is 'coordinator' | 'management' {
  return role === 'coordinator' || role === 'management';
}

/**
 * Cómo se escribe cada rol cuando lo lee una persona.
 *
 * Vive acá y no en la web porque ADR-024 fija un vocabulario compartido: `inspector` se
 * muestra "Inspector" y `inspection.inspector_id` se muestra "Assigned to". No es i18n
 * —la UI es solo inglés
 * (`openspec/config.yaml`)—, es la traducción del identificador al término del dominio.
 *
 * `Record<Role, string>` a propósito: agregar un rol a `ROLES` sin etiquetarlo no
 * compila.
 */
export const ROLE_LABELS: Record<Role, string> = {
  coordinator: 'Coordinator',
  inspector: 'Inspector',
  management: 'Management',
};

/**
 * El número de empleado de ADP. Es la identidad de una persona (§4), así que se
 * valida con la misma forma que el `CHECK` de la migración: sin espacios y no
 * vacío. Deliberadamente permisivo con el resto — el formato lo fija ADP, no
 * nosotros, y rechazar un número legítimo bloquearía justo lo que este change viene
 * a destrabar.
 */
export const EMPLOYEE_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const employeeNumberSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(EMPLOYEE_NUMBER_PATTERN, 'employee_number: sin espacios, alfanumérico con "." "_" o "-"');

const nameSchema = z.string().trim().min(1).max(80);

const emailSchema = z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(254));

/** Una persona del roster, tal como la devuelve la API. */
export const personSchema = z.strictObject({
  id: z.uuid(),
  site_id: z.uuid(),
  employee_number: employeeNumberSchema,
  first_name: nameSchema,
  last_name: nameSchema,
  deactivated_at: z.iso.datetime({ offset: true }).nullable(),
});

export type Person = z.infer<typeof personSchema>;

/**
 * Lo que necesita el selector de sujeto de un incidente, y nada más.
 *
 * Lleva `employee_number` porque el nombre NO identifica: dos personas activas
 * pueden llamarse igual y el operador tiene que poder distinguirlas. No lleva nada
 * más: §4 dice que el administrador elige a una persona **sin poder ver su perfil**.
 * Solo se arma con las activas.
 */
export const personOptionSchema = personSchema.pick({
  id: true,
  employee_number: true,
  first_name: true,
  last_name: true,
});

export type PersonOption = z.infer<typeof personOptionSchema>;

/**
 * Qué pedazo del roster de una planta pide la consola.
 *
 * La consola permite corregir nombres y números de personas activas, además del alta de una
 * persona nueva y la baja estrecha de un worker sin cuenta. Transferir o reactivar sigue siendo
 * trabajo del CSV.
 *
 * `site_id` es obligatorio y eso acota la respuesta al roster de UNA planta, que es lo
 * que sostiene la decisión de no paginar: doscientas filas entran en una pantalla de
 * JSON. **No es el límite de seguridad** —ese es la política RLS sobre `person`—, es la
 * selección entre las plantas del alcance.
 *
 * `status` con default `active` porque es lo que se mira el 90% de las veces, y explícito
 * porque la consola es el único lugar del sistema donde ver a las personas dadas de baja
 * es legítimo: todo selector las excluye siempre.
 */
export const rosterQuerySchema = z.strictObject({
  site_id: z.uuid(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
});

export type RosterQuery = z.infer<typeof rosterQuerySchema>;

/**
 * El alta de UNA persona (`add-person-to-roster-by-hand`): los mismos cuatro campos que
 * una fila del CSV, menos `status` — una persona agregada a mano nace activa siempre — y
 * con `site_id` en vez de `site_code`, porque acá no hay archivo que resolver contra el
 * catálogo: la pantalla ya sabe de qué planta está hablando.
 *
 * Reusa `employeeNumberSchema` y `nameSchema`: la forma de un nombre y de un número de
 * empleado no cambia porque la fila entre por HTTP en vez de por archivo. La respuesta es
 * `personSchema`, que ya existe — un alta no necesita un esquema de vuelta propio.
 */
export const createPersonRequestSchema = z.strictObject({
  site_id: z.uuid(),
  employee_number: employeeNumberSchema,
  first_name: nameSchema,
  last_name: nameSchema,
});

export type CreatePersonRequest = z.infer<typeof createPersonRequestSchema>;

/** Desde una fila solo se puede dar de baja a la persona; reactivarla sigue siendo del CSV. */
export const deactivatePersonRequestSchema = z.strictObject({
  deactivated: z.literal(true),
});

export type DeactivatePersonRequest = z.infer<typeof deactivatePersonRequestSchema>;

/** Corrección parcial de una persona activa desde la fila del roster. */
export const updatePersonRequestSchema = z
  .strictObject({
    first_name: nameSchema.optional(),
    last_name: nameSchema.optional(),
    employee_number: employeeNumberSchema.optional(),
  })
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    'an update must change at least one person field',
  );

export type UpdatePersonRequest = z.infer<typeof updatePersonRequestSchema>;

/**
 * La cuenta que referencia a una persona del roster, reducida a lo que decide si el
 * coordinador puede invitarla y como qué (design D2), **más el email al que se le
 * invitó**.
 *
 * Sigue sin alcance, sin credencial y sin token: eso es `accountSchema` entero, y
 * colgarlo de cada fila del roster convertiría una lectura de 200 personas en una
 * lectura de 200 cuentas. `active` sigue el mismo predicado que `hs_account_is_active`
 * —`deactivated_at` nulo— y `can_sign_in` es si existe una
 * `app_credential` activa: la pregunta que distingue "invitada" de "entrando".
 *
 * **El email SÍ viaja, y eso cambia lo que el design D2 decía.** La razón por la que
 * antes no viajaba era el tamaño de la lectura, no el secreto: `app_user.email` es la
 * dirección corporativa a la que el coordinador —el único rol que lee esta ruta— acaba
 * de mandar la invitación, y es una columna de la misma fila que ya se está trayendo.
 * Sin ella, "a qué dirección le llegó el link" obligaba a abrir el diálogo de reemisión
 * cuenta por cuenta para leer un dato que la tabla podía comparar hacia abajo.
 */
export const personAccountSchema = z.strictObject({
  id: z.uuid(),
  role: roleSchema,
  active: z.boolean(),
  can_sign_in: z.boolean(),
  email: emailSchema,
});

export type PersonAccount = z.infer<typeof personAccountSchema>;

/** Una fila del roster con la cuenta que la referencia, o `null` cuando no tiene. */
export const personWithAccountSchema = personSchema.extend({
  account: personAccountSchema.nullable(),
});

export type PersonWithAccount = z.infer<typeof personWithAccountSchema>;

/** Una entrada del alcance de una cuenta. */
export const siteScopeSchema = z.strictObject({
  site_id: z.uuid(),
  granted_at: z.iso.datetime({ offset: true }),
  revoked_at: z.iso.datetime({ offset: true }).nullable(),
});

export type SiteScope = z.infer<typeof siteScopeSchema>;

/**
 * Una cuenta, tal como la devuelve la API. `person_id` y no los datos de la
 * persona: la cuenta referencia al roster, no lo copia.
 *
 * `active` viene calculado por el servidor con el mismo predicado que
 * `hs_account_is_active`: `deactivated_at` nulo.
 */
export const accountSchema = z.strictObject({
  id: z.uuid(),
  person_id: z.uuid(),
  email: emailSchema,
  role: roleSchema,
  deactivated_at: z.iso.datetime({ offset: true }).nullable(),
  active: z.boolean(),
  scope: z.array(siteScopeSchema),
});

export type Account = z.infer<typeof accountSchema>;

/**
 * Los campos del alta de una cuenta, compartidos entre el comando (`createAccountSchema`)
 * y la ruta HTTP (`createAccountRequestSchema`, design D4). El alcance va aparte —es una
 * lista de sitios— y la
 * persona se referencia, nunca se crea desde acá: dar de alta a alguien en el roster es
 * una importación, no un efecto colateral de crearle una cuenta.
 */
const createAccountFields = z.strictObject({
  person_id: z.uuid(),
  email: emailSchema,
  role: roleSchema,
  site_ids: z.array(z.uuid()).min(1),
});

export const createAccountSchema = createAccountFields;

export type CreateAccount = z.infer<typeof createAccountSchema>;

/**
 * El alta desde la pantalla del roster (design D4): los mismos campos, más el flag que
 * pide la invitación en el mismo acto. `invite` con default `false` porque el comando de
 * línea de órdenes —que reusa el mismo servicio— nunca lo pide: emitir la invitación ahí
 * sigue siendo `pnpm auth:bootstrap`.
 */
export const createAccountRequestSchema = createAccountFields.extend({
  invite: z.boolean().default(false),
});

export type CreateAccountRequest = z.infer<typeof createAccountRequestSchema>;

/**
 * La respuesta del alta. `invitation` solo está cuando `invite` fue `true` —el token de
 * un solo uso, la misma forma que ya devuelve `POST /auth/invitations`— y no está nunca
 * más: es la regla de una sola vez de `issueInvitationResponseSchema`, compartida.
 */
export const createAccountResponseSchema = z.strictObject({
  account: personAccountSchema,
  invitation: z
    .strictObject({
      token: z.string().min(1),
      expiresAt: z.iso.datetime(),
    })
    .optional(),
});

export type CreateAccountResponse = z.infer<typeof createAccountResponseSchema>;

/**
 * Lo que se puede cambiar de una cuenta. `person_id` no está, y no es una omisión:
 * el trigger `app_user_guard` rechaza reasignarla venga de donde venga.
 */
export const updateAccountSchema = z
  .strictObject({
    email: emailSchema.optional(),
    role: roleSchema.optional(),
    deactivated: z.boolean().optional(),
  })
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    'un update tiene que cambiar algo',
  );

export type UpdateAccount = z.infer<typeof updateAccountSchema>;

/**
 * La cuenta que devuelve `GET /accounts/:id` (`reissue-invitation-link-from-roster`,
 * design D6): lo que la pantalla de reemisión necesita para precargar el diálogo.
 *
 * Hoy es exactamente `personAccountSchema` —el email dejó de ser lo que las separaba— y
 * por eso es un alias y no una copia. Conserva el nombre porque conserva el propósito:
 * esta lectura es de UNA cuenta y puede crecer con lo que solo tenga sentido de a una,
 * sin que eso se cuelgue de las doscientas filas del roster.
 */
export const accountDetailSchema = personAccountSchema;

export type AccountDetail = z.infer<typeof accountDetailSchema>;

/**
 * El pedido de `PATCH /accounts/:id` (design D5, ampliado por
 * `remove-jhsc-access-from-roster`). Sigue aparte de `updateAccountSchema` y no expone
 * un rol libre: las dos modificaciones de rol son literales y están declaradas abajo.
 *
 * Cuatro actos, y el contrato dice que no se piden juntos:
 *
 * - corregir el `email` y reemitir el link (`invite`), que van juntos o sueltos;
 * - `deactivated: true` — quitar el acceso, que es lo que cancela una invitación pendiente.
 * - `promote_to` — promover a coordinador, como acto exclusivo de gerencia.
 * - `demote_to` — devolver un coordinador a miembro del JHSC, como acto exclusivo de gerencia.
 *
 * **`z.literal(true)` y no un booleano**, y eso es lo que el tipo dice de más: por esta ruta
 * una cuenta solo se da de baja. Devolverle el acceso a alguien no es un `deactivated:
 * false` — es invitarlo, y eso es `POST /accounts`, que revive la cuenta que la persona ya
 * tenía. Un booleano acá abriría un segundo camino a la misma intención.
 *
 * `deactivated: true` con `email` o con `invite` NO es una combinación a resolver del lado
 * del servidor: emitir un link para una cuenta que se está dando de baja es un pedido que
 * se contradice, y aceptarlo obligaría al servicio a elegir cuál de los dos gana. El
 * `refine` lo rechaza acá, donde el cliente lo ve.
 */
export const updateAccountRequestSchema = z
  .strictObject({
    email: emailSchema.optional(),
    invite: z.boolean().optional(),
    deactivated: z.literal(true).optional(),

    /** Literal porque esta operación es una promoción concreta, no un cambio libre de rol. */
    promote_to: z.literal('coordinator').optional(),
    /** Literal porque esta operación es una degradación concreta, no un cambio libre de rol. */
    demote_to: z.literal('inspector').optional(),
  })
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    'un update tiene que cambiar algo',
  )
  .refine(
    (value) => !(value.deactivated === true && (value.email !== undefined || value.invite)),
    'dar de baja una cuenta no se combina con corregir su correo ni con emitir un link',
  )
  .refine(
    (value) =>
      value.promote_to === undefined ||
      (value.deactivated === undefined &&
        value.email === undefined &&
        value.invite === undefined &&
        value.demote_to === undefined),
    'la promoción es un acto solo: no se combina con la baja, el correo ni el link',
  )
  .refine(
    (value) =>
      value.demote_to === undefined ||
      (value.promote_to === undefined &&
        value.deactivated === undefined &&
        value.email === undefined &&
        value.invite === undefined),
    'la degradación es un acto solo: no se combina con la promoción, la baja, el correo ni el link',
  );

export type UpdateAccountRequest = z.infer<typeof updateAccountRequestSchema>;

/**
 * Los dos estados que puede traer una fila del CSV. `inactive` da de baja; la
 * AUSENCIA de la fila no hace nada — ver `rosterCsvRowSchema`.
 */
export const ROSTER_STATUSES = ['active', 'inactive'] as const;

export const rosterStatusSchema = z.enum(ROSTER_STATUSES);

export type RosterStatus = z.infer<typeof rosterStatusSchema>;

/** Las cinco columnas del CSV del roster, por nombre de encabezado. */
export const ROSTER_CSV_COLUMNS = [
  'employee_number',
  'first_name',
  'last_name',
  'site_code',
  'status',
] as const;

/**
 * Una fila del CSV, ya parseada.
 *
 * `status` es obligatorio y explícito. Que una persona no aparezca en el archivo
 * NUNCA la da de baja: alguien va a exportar de ADP con un filtro puesto y va a
 * subir 40 filas en lugar de 200, y con la regla contraria ese día desaparecen 160
 * personas de todos los selectores.
 */
export const rosterCsvRowSchema = z.strictObject({
  employee_number: employeeNumberSchema,
  first_name: nameSchema,
  last_name: nameSchema,
  site_code: z.string().trim().min(1).max(64),
  status: rosterStatusSchema,
});

export type RosterCsvRow = z.infer<typeof rosterCsvRowSchema>;

/**
 * Una fila rechazada. `row_number` es 1-based sobre el ARCHIVO, con el encabezado
 * contando como fila 1: es el número que el coordinador ve en Excel, que es el
 * único lugar donde va a ir a arreglarlo.
 */
export const rosterRejectionSchema = z.strictObject({
  row_number: z.int().min(1),
  employee_number: z.string().nullable(),
  reason: z.string().min(1),
});

export type RosterRejection = z.infer<typeof rosterRejectionSchema>;

/**
 * El reporte de una importación. Es el entregable de §6 pregunta cerrada 3: una
 * fila mala no descarta el archivo, se aplica el resto y se explica cada rechazo.
 */
export const rosterImportReportSchema = z.strictObject({
  import_id: z.uuid().nullable(),
  source_filename: z.string().min(1),
  rows_read: z.int().min(0),
  rows_applied: z.int().min(0),
  rows_rejected: z.int().min(0),
  rejections: z.array(rosterRejectionSchema),
});

export type RosterImportReport = z.infer<typeof rosterImportReportSchema>;
