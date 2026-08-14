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
 * Los cinco roles de la tabla de §4.
 *
 * `jhsc_member` y no `inspector`: la nota de vocabulario de §4 exige un solo
 * término, y "inspector" queda para `inspection.inspector_id`, que es un campo y no
 * un permiso. El mismo conjunto está escrito como `CHECK` en la migración 0005. Si
 * uno cambia, el otro también.
 */
export const ROLES = [
  'hs_coordinator',
  'jhsc_member',
  'supervisor',
  'management',
  'external_auditor',
] as const;

export const roleSchema = z.enum(ROLES);

export type Role = z.infer<typeof roleSchema>;

/**
 * Cómo se escribe cada rol cuando lo lee una persona.
 *
 * Vive acá y no en la web porque el vocabulario de §4 es uno solo: `jhsc_member` se
 * muestra "JHSC member" y nunca "Inspector", que es lo que alguien escribiría si cada
 * pantalla inventara su etiqueta. No es i18n —la UI es solo inglés
 * (`openspec/config.yaml`)—, es la traducción del identificador al término del dominio.
 *
 * `Record<Role, string>` a propósito: agregar un rol a `ROLES` sin etiquetarlo no
 * compila.
 */
export const ROLE_LABELS: Record<Role, string> = {
  hs_coordinator: 'H&S coordinator',
  jhsc_member: 'JHSC member',
  supervisor: 'Supervisor',
  management: 'Management',
  external_auditor: 'External auditor',
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
 * más: §4 dice que el supervisor elige a una persona **sin poder ver su perfil**.
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
 * **La consola es de solo lectura**: no hay ningún esquema de escritura acá porque no hay
 * ninguna ruta que escriba. Corregir un nombre, transferir de planta y dar de baja siguen
 * siendo del CSV (`pnpm roster:import`), que es la fuente de verdad del roster.
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
 * `hs_account_is_active`: `deactivated_at` nulo y `expires_at` en el futuro o nulo.
 * El cliente no lo recalcula — "vencida" es una condición de tiempo y el reloj del
 * dispositivo no es el reloj del sistema.
 */
export const accountSchema = z.strictObject({
  id: z.uuid(),
  person_id: z.uuid(),
  email: emailSchema,
  role: roleSchema,
  expires_at: z.iso.datetime({ offset: true }).nullable(),
  records_from: z.iso.date().nullable(),
  records_to: z.iso.date().nullable(),
  deactivated_at: z.iso.datetime({ offset: true }).nullable(),
  active: z.boolean(),
  scope: z.array(siteScopeSchema),
});

export type Account = z.infer<typeof accountSchema>;

/**
 * §5 riesgo I — El ciclo de vida del auditor externo. Default 30 días, máximo 90.
 *
 * El default vive acá y no en el motor porque un `CHECK` no puede distinguir "no lo
 * pusiste" de "pusiste 30". El máximo vive en los dos lados a propósito: acá para
 * dar un error legible antes de llegar a la base, y en el `CHECK` de la migración
 * porque una regla que solo vive en el contrato se saltea con un INSERT a mano.
 */
export const AUDITOR_DEFAULT_DAYS = 30;
export const AUDITOR_MAX_DAYS = 90;

/**
 * Alta de una cuenta. El alcance va aparte —es una lista de sitios— y la persona se
 * referencia, nunca se crea desde acá: dar de alta a alguien en el roster es una
 * importación, no un efecto colateral de crearle una cuenta.
 */
export const createAccountSchema = z
  .strictObject({
    person_id: z.uuid(),
    email: emailSchema,
    role: roleSchema,
    site_ids: z.array(z.uuid()).min(1),

    /** Solo para `external_auditor`. Días de vigencia, 1 a 90. */
    expires_in_days: z.int().min(1).max(AUDITOR_MAX_DAYS).default(AUDITOR_DEFAULT_DAYS),
    records_from: z.iso.date().optional(),
    records_to: z.iso.date().optional(),
  })
  .refine(
    (value) =>
      value.role !== 'external_auditor' ||
      (value.records_from !== undefined && value.records_to !== undefined),
    'un auditor externo necesita la ventana de fechas de los registros que puede leer',
  )
  .refine(
    (value) =>
      value.records_from === undefined ||
      value.records_to === undefined ||
      value.records_from <= value.records_to,
    'records_from no puede ser posterior a records_to',
  );

export type CreateAccount = z.infer<typeof createAccountSchema>;

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
