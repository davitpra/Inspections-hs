import { z } from 'zod';

import { personOptionSchema } from './identity.js';
import type { Role } from './identity.js';

/**
 * Requisitos §7 etapa 6 — El incidente en tercera persona y su ciclo de vida.
 *
 * Un supervisor carga el accidente sobre una **Persona** del roster que casi
 * seguro no tiene cuenta, sin poder ver su perfil (§3 R4). El sistema clasifica,
 * muestra los relojes regulatorios que aplican y notifica al coordinador. **No
 * envía nada al MLITSD ni al WSIB**: la responsabilidad legal es de una persona.
 *
 * Las reglas de este archivo —qué transiciones existen, qué clasificación obliga
 * a investigar, qué campos tenía cada versión del formulario— son **datos y
 * funciones puras sin base de datos** (ADR-008), igual que en `actions.ts` y por
 * los mismos dos motivos: `forms` va dentro del service worker, y la tabla de
 * transiciones es un dato del contrato porque el cliente necesita saber qué botón
 * mostrar.
 *
 * Lo que estos esquemas NO pueden validar es todo lo que depende del estado: que
 * el sujeto esté activo y sea del sitio, que la transición salga del estado
 * vigente, que no queden acciones abiertas, que exista una causa raíz. Eso son
 * triggers y políticas en `apps/api/drizzle/0012_incidents.sql`. Zod valida la
 * forma.
 */

// ---------------------------------------------------------------------------
// Las clasificaciones

/**
 * Las cinco clasificaciones de §4, y no hay una sexta.
 *
 * **`near_miss` no está y esa ausencia es el requisito** (pregunta cerrada 8,
 * riesgo F). Con reporte en tercera persona por personal de supervisión, nadie
 * carga un formulario por un evento donde no pasó nada: el indicador iba a ser
 * cercano a cero y "no hay casi-accidentes" y "no hay reporte de casi-accidentes"
 * se ven idénticos en un dashboard. El evento sigue teniendo dónde vivir — se
 * carga como **hallazgo de entrada manual**, que es donde tiene consecuencias.
 *
 * **La misma lista está escrita como `CHECK` en la migración 0012** y un test de
 * integración las compara. SQL no puede importar TypeScript; la duplicación es
 * deliberada y está bajo prueba, igual que la de `RESPONSE_TYPES` en 0007 y la de
 * los estados de la acción en 0011.
 */
export const INCIDENT_CLASSIFICATIONS = [
  'first_aid',
  'health_care',
  'lost_time_or_modified_work',
  'critical_injury',
  'occupational_illness',
] as const;

export const incidentClassificationSchema = z.enum(INCIDENT_CLASSIFICATIONS);

export type IncidentClassification = z.infer<typeof incidentClassificationSchema>;

/**
 * Las clasificaciones que **obligan** a investigar: no pueden ir de `reported` a
 * `closed`.
 *
 * **Configuración en código, no regla legal autoritativa.** §4 lo dice con estas
 * palabras: _"la lista de clasificaciones que obligan investigación debe
 * confirmarse contra las obligaciones concretas del empleador bajo la OHSA antes
 * de salir a producción — el sistema la trata como configuración en código, no
 * como regla legal autoritativa"_. El mismo cartel que lleva
 * `DUE_DAYS_BY_SEVERITY` y que llevan los relojes de `regulatory-clocks.ts`.
 */
export const INVESTIGATION_REQUIRED_CLASSIFICATIONS: readonly IncidentClassification[] = [
  'critical_injury',
  'lost_time_or_modified_work',
  'occupational_illness',
];

/** Si esta clasificación puede cerrarse sin investigar. */
export function requiresInvestigation(classification: IncidentClassification): boolean {
  return INVESTIGATION_REQUIRED_CLASSIFICATIONS.includes(classification);
}

// ---------------------------------------------------------------------------
// Los estados

/**
 * Los tres estados de §4, y no hay un cuarto.
 *
 * **`reopened` no está y esa ausencia es deliberada**: reabrir es volver a
 * `under_investigation` con un motivo, un evento más en el stream. Un estado
 * propio haría que un incidente reabierto se distinguiera para siempre de uno que
 * nunca se cerró, cuando lo que importa —que se cerró y se volvió a abrir, y por
 * qué— ya está en los eventos.
 *
 * **La misma lista está escrita como `CHECK` en la migración 0012** y un test de
 * integración las compara.
 */
export const INCIDENT_STATES = ['reported', 'under_investigation', 'closed'] as const;

export const incidentStateSchema = z.enum(INCIDENT_STATES);

export type IncidentState = z.infer<typeof incidentStateSchema>;

// ---------------------------------------------------------------------------
// La máquina de estados, como tabla de datos

/**
 * Lo que una transición exige además del estado de origen.
 *
 * - `reason`: hay que decir por qué. Al cerrar sin investigar y al reabrir.
 * - `method`: con qué método se investiga. Solo al abrir la investigación.
 * - `root_cause`: al menos una causa con `is_root`. §4, "requiere causa raíz
 *   registrada".
 * - `no_open_actions`: ninguna acción correctiva del incidente fuera de `closed`.
 *   **Es la guarda que da sentido a la máquina** (pregunta cerrada 7): hace que el
 *   estado del incidente sea una consecuencia del trabajo real y no una
 *   declaración administrativa.
 * - `investigation_optional`: la transición solo existe para las clasificaciones
 *   que NO obligan a investigar.
 */
export const INCIDENT_TRANSITION_REQUIREMENTS = [
  'reason',
  'method',
  'root_cause',
  'no_open_actions',
  'investigation_optional',
] as const;

export type IncidentTransitionRequirement = (typeof INCIDENT_TRANSITION_REQUIREMENTS)[number];

export interface IncidentTransition {
  /** `null` es el reporte: el incidente todavía no existía. */
  readonly from: IncidentState | null;
  readonly to: IncidentState;
  readonly roles: readonly Role[];
  readonly requires: readonly IncidentTransitionRequirement[];
}

/**
 * **La máquina de estados de §4, como dato y no como `switch`.**
 *
 * Cinco filas y ninguna más; todo par que no esté acá se rechaza. A diferencia de
 * la acción correctiva, **`closed` no es terminal**: la reapertura es una fila de
 * esta tabla porque §4 la pide explícitamente ("evento nuevo, no edición").
 *
 * Ser un dato y no código es lo que permite que la UI derive los botones de acá en
 * vez de reimplementar la regla en un `if`, que es la forma en que cliente y
 * servidor terminan discrepando.
 *
 * **La misma tabla está escrita como guarda en la migración 0012** y un test de
 * integración evalúa todos los pares ordenados por los dos caminos y los compara.
 */
export const INCIDENT_TRANSITIONS: readonly IncidentTransition[] = [
  {
    from: null,
    to: 'reported',
    roles: ['supervisor', 'management', 'hs_coordinator'],
    requires: [],
  },
  {
    from: 'reported',
    to: 'under_investigation',
    roles: ['hs_coordinator'],
    requires: ['method'],
  },
  {
    from: 'reported',
    to: 'closed',
    roles: ['hs_coordinator'],
    requires: ['reason', 'investigation_optional', 'no_open_actions'],
  },
  {
    from: 'under_investigation',
    to: 'closed',
    roles: ['hs_coordinator'],
    requires: ['root_cause', 'no_open_actions'],
  },
  {
    from: 'closed',
    to: 'under_investigation',
    roles: ['hs_coordinator'],
    requires: ['reason'],
  },
];

/**
 * La transición de un par, o `undefined` si la máquina no la permite.
 *
 * Consulta la tabla; no la reimplementa. Igual que `transitionFor` en `actions.ts`
 * y por el mismo motivo: un `switch` sería una segunda copia de la regla.
 */
export function incidentTransitionFor(
  from: IncidentState | null,
  to: IncidentState,
): IncidentTransition | undefined {
  return INCIDENT_TRANSITIONS.find(
    (transition) => transition.from === from && transition.to === to,
  );
}

/** Las transiciones disponibles desde un estado. Lo que la UI usa para los botones. */
export function incidentTransitionsFrom(
  from: IncidentState | null,
): readonly IncidentTransition[] {
  return INCIDENT_TRANSITIONS.filter((transition) => transition.from === from);
}

/**
 * Las transiciones que este incidente admite ahora, ya filtradas por su
 * clasificación.
 *
 * `investigation_optional` es lo único de `requires` que se puede resolver sin
 * mirar la base: depende de la clasificación y de nada más. El resto —causa raíz,
 * acciones abiertas— lo resuelven el servicio y los triggers.
 */
export function incidentTransitionsAvailable(
  from: IncidentState | null,
  classification: IncidentClassification,
): readonly IncidentTransition[] {
  return incidentTransitionsFrom(from).filter(
    (transition) =>
      !transition.requires.includes('investigation_optional') ||
      !requiresInvestigation(classification),
  );
}

// ---------------------------------------------------------------------------
// El cuerpo del formulario: las dos selecciones cerradas

/**
 * La parte del cuerpo afectada. **Categoría gruesa, no diagnóstico.**
 *
 * §4 marca el límite con estas palabras: _"«Parte del cuerpo afectada» es una
 * categoría gruesa y es el límite: no se extiende a naturaleza de la lesión"_. No
 * hay campo de diagnóstico, de parte médico ni de restricción funcional, y **no
 * los va a haber** (riesgo G-bis): la entidad `DetalleMédico` fue eliminada del
 * alcance. Nadie —ni el coordinador de HS— puede consultar en el sistema qué
 * lesión tuvo una persona, solo en qué categoría cayó el evento.
 *
 * Agregar una entrada acá es agregar una categoría, nunca un detalle clínico. Si
 * una entrada nueva contesta "qué le pasó" en vez de "dónde", no va.
 */
export const BODY_PARTS = [
  'head',
  'eye',
  'face',
  'neck',
  'shoulder',
  'arm_or_elbow',
  'hand_or_finger',
  'back',
  'torso',
  'hip_or_groin',
  'leg_or_knee',
  'foot_or_toe',
  'multiple',
  'not_applicable',
] as const;

export const bodyPartSchema = z.enum(BODY_PARTS);

export type BodyPart = z.infer<typeof bodyPartSchema>;

/**
 * Qué se hizo **en el sitio**. Alimenta la clasificación (§4).
 *
 * Es lo que ocurrió en la planta, no lo que un clínico concluyó después. Por eso
 * `sent_to_clinic` y no "diagnóstico ambulatorio": el sistema registra que la
 * persona salió hacia una clínica, y ahí termina lo que sabe.
 */
export const ON_SITE_TREATMENTS = [
  'none',
  'first_aid_on_site',
  'sent_to_clinic',
  'sent_to_hospital',
  'emergency_services_called',
  'sent_home',
] as const;

export const onSiteTreatmentSchema = z.enum(ON_SITE_TREATMENTS);

export type OnSiteTreatment = z.infer<typeof onSiteTreatmentSchema>;

/**
 * El idioma en que se escribió la narrativa (riesgo G).
 *
 * La plataforma es **solo inglés** y esto no la localiza: es un dato sobre el
 * texto, no una preferencia de interfaz. Si un supervisor hispanohablante escribe
 * en español, el registro conserva sus palabras exactas y anota cuál era el
 * idioma. **No hay traducción automática dentro de un registro inmutable**, y esa
 * prohibición es del riesgo G, no una limitación técnica.
 */
export const NARRATIVE_LANGUAGES = ['en', 'es'] as const;

export const narrativeLanguageSchema = z.enum(NARRATIVE_LANGUAGES);

export type NarrativeLanguage = z.infer<typeof narrativeLanguageSchema>;

// ---------------------------------------------------------------------------
// El versionado del formulario

/**
 * Los nueve campos guiados de §4.
 *
 * **No hay un cuadro de texto libre único, y esa ausencia es el requisito.** Un
 * campo corto y concreto es mucho más fácil de completar bien para quien no
 * escribe cómodo en inglés que un cuadro que dice "describa el incidente". Ese es
 * el objetivo del cambio.
 */
export const INCIDENT_FIELDS = [
  'occurred_at',
  'location_id',
  'task_performed',
  'equipment_involved',
  'what_happened',
  'body_part',
  'on_site_treatment',
  'witnesses',
  'immediate_action',
] as const;

export type IncidentFieldName = (typeof INCIDENT_FIELDS)[number];

/**
 * `versión → conjunto de campos` (pregunta cerrada 10, design D15).
 *
 * **Existe para que "vacío porque no aplicaba" y "vacío porque no existía" no se
 * vuelvan indistinguibles**, que en un registro inmutable es algo que no se
 * corrige después. Sin este registro, un incidente de 2026 leído por el código de
 * 2028 mostraría el campo nuevo en blanco y nadie podría decir si el supervisor lo
 * dejó vacío o si todavía no existía.
 *
 * **Agregar un campo es una entrada nueva acá más una migración, nunca una edición
 * de la entrada anterior.** El esquema es fijo en código: el builder visual **no
 * gana un segundo consumidor** y sigue siendo solo de plantillas de inspección.
 * Los plazos legales que dependen de estos campos no se dejan en manos de un
 * constructor visual.
 */
export const INCIDENT_FORM_VERSIONS: Readonly<Record<number, readonly IncidentFieldName[]>> = {
  1: INCIDENT_FIELDS,
};

/** La versión que escribe el código desplegado hoy. La fila guarda la suya. */
export const CURRENT_INCIDENT_FORM_VERSION = 1;

/**
 * Los campos que existían en una versión.
 *
 * Devuelve una lista vacía para una versión desconocida en vez de tirar: una fila
 * escrita por una versión más nueva que el código que la lee es un despliegue a
 * medias, y en ese caso mostrar "no sé qué campos tenía" es más honesto que
 * mostrar los de hoy.
 */
export function fieldsOfVersion(version: number): readonly IncidentFieldName[] {
  return INCIDENT_FORM_VERSIONS[version] ?? [];
}

// ---------------------------------------------------------------------------
// El método de la investigación

/**
 * Los dos métodos de causa raíz de §4, y **el método se registra, no se infiere**.
 *
 * Inferirlo de la forma del grafo —cadena es cinco porqués, ramas es árbol— sería
 * adivinar: un árbol al que solo se le cargó una rama es indistinguible de una
 * cadena, y el registro diría que se usó un método que nadie usó.
 */
export const INVESTIGATION_METHODS = ['five_whys', 'cause_tree'] as const;

export const investigationMethodSchema = z.enum(INVESTIGATION_METHODS);

export type InvestigationMethod = z.infer<typeof investigationMethodSchema>;

// ---------------------------------------------------------------------------
// Lo que se escribe

const SHORT_TEXT_MIN = 3;
const SHORT_TEXT_MAX = 500;

/**
 * El mínimo de los campos narrativos no es cosmético, por lo mismo que en
 * `findings.ts`: "ok" en un registro inmutable que puede terminar en un expediente
 * del MLITSD no describe nada, y quien lo lee tres meses después no estuvo ahí.
 */
const shortText = z.string().trim().min(SHORT_TEXT_MIN).max(SHORT_TEXT_MAX);

/**
 * Reportar un incidente: los nueve campos guiados y nada más.
 *
 * **`reported_by`, `reported_at` y `form_version` no están, y esa ausencia es el
 * requisito.** Los pone el servidor: el reportante sale de la sesión —aceptarlo del
 * caller sería dejar reportar en nombre de otro—, `reported_at` es el reloj del
 * servidor porque de él cuelga el plazo del Form 7, y `form_version` es la del
 * código desplegado porque una fila que declara su propia versión podría mentir
 * sobre qué campos existían cuando se escribió.
 *
 * `subject_person_id` es una **Persona**, no una cuenta (§4). `witness_person_ids`
 * puede venir vacío: un accidente sin testigos es un accidente igual.
 *
 * **No hay campo de foto ni de adjunto** (design D12): la foto de una persona
 * accidentada es detalle clínico por otra puerta. La evidencia de la remediación
 * vive en las acciones correctivas de la investigación.
 */
export const reportIncidentRequestSchema = z.strictObject({
  subject_person_id: z.uuid(),
  classification: incidentClassificationSchema,
  occurred_at: z.iso.datetime({ offset: true }),
  location_id: z.uuid(),
  task_performed: shortText,
  equipment_involved: shortText,
  what_happened: shortText,
  body_part: bodyPartSchema,
  on_site_treatment: onSiteTreatmentSchema,
  immediate_action: shortText,
  narrative_language: narrativeLanguageSchema,
  witness_person_ids: z.array(z.uuid()).max(20).default([]),
});

export type ReportIncidentRequest = z.infer<typeof reportIncidentRequestSchema>;

/**
 * Pedir una transición del incidente.
 *
 * Los dos `refine` reproducen las filas de `INCIDENT_TRANSITIONS` que exigen algo y
 * que se pueden verificar sin leer la base: `method` al abrir la investigación y
 * `reason` al reabrir. Son la primera barrera y la más barata; la segunda es el
 * servicio y la tercera son los triggers de 0012.
 *
 * **El `reason` del cierre directo desde `reported` no se puede exigir acá**, por lo
 * mismo que en `actions.ts`: `reported → closed` lo necesita y este request no lleva
 * `from` con el que distinguirlo de otro cierre. La regla se cierra en el servicio,
 * que ya leyó el estado vigente, y en la guarda de la migración.
 *
 * `from` no viaja: el servidor ya sabe cuál es el estado vigente, y aceptarlo del
 * caller sería dejarle elegir contra qué se valida.
 */
export const incidentTransitionRequestSchema = z
  .strictObject({
    to: incidentStateSchema,
    note: z.string().trim().min(1).max(2000).optional(),
    reason: z.string().trim().min(10).max(2000).optional(),
    method: investigationMethodSchema.optional(),
    sequence_of_events: z.string().trim().min(10).max(4000).optional(),
  })
  .refine((value) => value.to !== 'under_investigation' || value.method !== undefined, {
    message: 'Abrir la investigación exige declarar el método.',
    path: ['method'],
  });

export type IncidentTransitionRequest = z.infer<typeof incidentTransitionRequestSchema>;

/**
 * Registrar una causa.
 *
 * Append-only: **corregir una causa es agregar otra**, nunca editarla. `is_root`
 * marca cuál cierra el análisis, y sin al menos una el incidente no se cierra —una
 * investigación sin causa raíz es una carpeta vacía con un nombre.
 */
export const recordCauseRequestSchema = z.strictObject({
  statement: z.string().trim().min(10).max(2000),
  is_root: z.boolean(),
  parent_cause_id: z.uuid().optional(),
});

export type RecordCauseRequest = z.infer<typeof recordCauseRequestSchema>;

// ---------------------------------------------------------------------------
// Lo que se lee

/**
 * Un testigo: una referencia a Persona, **sin perfil** (§4).
 *
 * Es exactamente un `PersonOption` —los mismos cuatro campos del selector de sujeto— y
 * no una forma paralela: §4 dice que el supervisor elige a la persona sin poder ver su
 * perfil, y devolver en la lectura un campo más que en el selector sería abrir por la
 * puerta de atrás lo que el selector cierra.
 */
export const incidentWitnessSchema = personOptionSchema;

export type IncidentWitness = z.infer<typeof incidentWitnessSchema>;

/**
 * Un evento del stream.
 *
 * `position` es el orden dentro del incidente y es lo que hace que el estado vigente
 * sea una consulta —`DISTINCT ON ... ORDER BY position DESC`— y no una columna
 * (ADR-002, design D1 de la etapa 5).
 */
export const incidentEventSchema = z.strictObject({
  id: z.uuid(),
  position: z.number().int().min(0),
  from_state: incidentStateSchema.nullable(),
  to_state: incidentStateSchema,
  actor_user_id: z.uuid(),
  note: z.string().nullable(),
  reason: z.string().nullable(),
  occurred_at: z.iso.datetime({ offset: true }),
  recorded_at: z.iso.datetime({ offset: true }),
});

export type IncidentEvent = z.infer<typeof incidentEventSchema>;

/** Una causa del análisis. `parent_cause_id` es la rama del árbol; en cadena va nulo. */
export const investigationCauseSchema = z.strictObject({
  id: z.uuid(),
  position: z.number().int().min(1),
  statement: z.string().min(1),
  is_root: z.boolean(),
  parent_cause_id: z.uuid().nullable(),
  recorded_by: z.uuid(),
  recorded_at: z.iso.datetime({ offset: true }),
});

export type InvestigationCause = z.infer<typeof investigationCauseSchema>;

/** La investigación de un incidente. A lo sumo una, y solo si el incidente llegó ahí. */
export const investigationSchema = z.strictObject({
  id: z.uuid(),
  incident_id: z.uuid(),
  site_id: z.uuid(),
  method: investigationMethodSchema,
  sequence_of_events: z.string().nullable(),
  opened_by: z.uuid(),
  opened_at: z.iso.datetime({ offset: true }),
  causes: z.array(investigationCauseSchema),
});

export type Investigation = z.infer<typeof investigationSchema>;

/** Un reloj regulatorio, tal como viaja al cliente. Fechas como texto, no como `Date`. */
export const regulatoryClockSchema = z.strictObject({
  authority: z.enum(['mlitsd', 'wsib']),
  obligation: z.string().min(1),
  counts_from: z.enum(['occurrence', 'report']),
  from: z.iso.datetime({ offset: true }),
  due_at: z.iso.datetime({ offset: true }).nullable(),
  immediate: z.boolean(),
  overdue: z.boolean(),
  citation: z.string().min(1),
});

export type RegulatoryClockDto = z.infer<typeof regulatoryClockSchema>;

/**
 * Un incidente tal como lo devuelve la API.
 *
 * **`state` viene de los eventos y `clocks` de una función pura; ninguno de los dos
 * es columna** (ADR-002, ADR-008, design D7). La tabla `incident` no tiene dónde
 * guardar el estado ni un plazo, y buscarlos ahí es buscar lo que el diseño decidió
 * no tener.
 *
 * `fields_of_version` es el registro de la pregunta cerrada 10 llevado a la
 * respuesta: dice qué campos existían **en la versión de este incidente**, para que
 * la pantalla distinga "vacío porque no aplicaba" de "no existía". Sin él, en un
 * registro inmutable, esa diferencia se pierde para siempre.
 *
 * **No hay campo de nombre del sujeto**: el detalle lo resuelve el mismo selector
 * que la carga, y por la misma razón —§4 dice que se elige a la persona sin ver su
 * perfil.
 */
export const incidentSchema = z.strictObject({
  id: z.uuid(),
  site_id: z.uuid(),
  form_version: z.number().int().min(1),
  classification: incidentClassificationSchema,
  subject_person_id: z.uuid(),
  reported_by: z.uuid(),
  occurred_at: z.iso.datetime({ offset: true }),
  reported_at: z.iso.datetime({ offset: true }),
  location_id: z.uuid(),
  task_performed: z.string(),
  equipment_involved: z.string(),
  what_happened: z.string(),
  body_part: bodyPartSchema,
  on_site_treatment: onSiteTreatmentSchema,
  immediate_action: z.string(),
  narrative_language: narrativeLanguageSchema,
  created_at: z.iso.datetime({ offset: true }),
  /** Derivado del último evento. No existe como columna. */
  state: incidentStateSchema,
  /** Derivados de una función pura sobre tres campos congelados. Tampoco son columnas. */
  clocks: z.array(regulatoryClockSchema),
  /** Qué campos tenía la versión de ESTE incidente, no la de hoy. */
  fields_of_version: z.array(z.enum(INCIDENT_FIELDS)),
  witnesses: z.array(incidentWitnessSchema),
  events: z.array(incidentEventSchema),
  investigation: investigationSchema.nullable(),
});

export type Incident = z.infer<typeof incidentSchema>;

export const incidentListSchema = z.array(incidentSchema);

export type IncidentList = z.infer<typeof incidentListSchema>;

// ---------------------------------------------------------------------------
// La pantalla del Form 7

/**
 * De dónde sale el valor de un campo del Form 7.
 *
 * `not_stored` **no es un hueco por completar**: es la respuesta. El sistema no
 * guarda detalle clínico ni datos personales que no necesita, y el Form 7 los pide.
 * Mostrarlos como vacíos haría que alguien los leyera como "no hubo"; etiquetarlos
 * como no almacenados dice la verdad —hay que buscarlos en otro lado— y deja
 * constancia de que la ausencia es una decisión (riesgo G-bis).
 */
export interface Form7Field {
  readonly label: string;
  readonly source: IncidentFieldName | 'classification' | 'subject_person' | 'site' | null;
  readonly notStored?: true;
  readonly note?: string;
}

export type Form7Mapping = readonly Form7Field[];

/**
 * El mapeo a los campos del Form 7 del WSIB, por versión del formulario (design D16).
 *
 * **Solo lectura y copiar-al-portapapeles. No se genera el PDF oficial** (riesgo H,
 * cerrado en v1.2). Generar el formulario oficial crearía una obligación de
 * mantenimiento permanente sobre un formato que no controlamos y el riesgo de
 * producir un documento desactualizado con apariencia de oficial. El sistema **no
 * envía nada** al WSIB: la responsabilidad legal es de una persona, que de todas
 * formas va a entrar al portal.
 *
 * Paralelo a `INCIDENT_FORM_VERSIONS` y elegido por el `form_version` de la fila, no
 * por el del código: un incidente viejo se mapea con el conjunto de campos que tenía.
 */
export const FORM7_MAPPINGS: Readonly<Record<number, Form7Mapping>> = {
  1: [
    { label: 'Employer — location of incident', source: 'location_id' },
    { label: 'Worker', source: 'subject_person' },
    { label: 'Date and time of incident', source: 'occurred_at' },
    { label: 'Area where incident occurred', source: 'location_id' },
    { label: 'What was the worker doing', source: 'task_performed' },
    { label: 'Equipment or material involved', source: 'equipment_involved' },
    { label: 'Describe what happened', source: 'what_happened' },
    { label: 'Part of body affected', source: 'body_part' },
    { label: 'Treatment at the workplace', source: 'on_site_treatment' },
    { label: 'Action taken to prevent recurrence', source: 'immediate_action' },
    { label: 'Names of witnesses', source: 'witnesses' },
    { label: 'Type of incident', source: 'classification' },
    {
      label: 'Nature of injury / illness',
      source: null,
      notStored: true,
      note: 'El sistema guarda la categoría del evento, nunca la naturaleza de la lesión (§4).',
    },
    {
      label: 'Health professional and treatment details',
      source: null,
      notStored: true,
      note: 'No hay diagnóstico ni parte médico en el sistema, por decisión de alcance.',
    },
    {
      label: 'Functional abilities / work restrictions',
      source: null,
      notStored: true,
      note: 'La entidad DetalleMédico fue eliminada del alcance (riesgo G-bis).',
    },
    {
      label: "Worker's date of birth and SIN",
      source: null,
      notStored: true,
      note: 'El roster identifica por número de empleado de ADP y no guarda estos datos.',
    },
    {
      label: 'Earnings and hours of work',
      source: null,
      notStored: true,
      note: 'La plataforma no tiene datos de nómina.',
    },
  ],
};

/** El mapeo de una versión. Vacío para una versión desconocida, por lo mismo que `fieldsOfVersion`. */
export function form7MappingOf(version: number): Form7Mapping {
  return FORM7_MAPPINGS[version] ?? [];
}
