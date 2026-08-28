import type { IncidentClassification } from './incidents.js';

/**
 * Requisitos §3 R4 — Los relojes regulatorios del MLITSD y del WSIB.
 *
 * **CONFIGURACIÓN EN CÓDIGO, NO DICTAMEN LEGAL.** Las tres tablas de este archivo
 * —qué obligación dispara cada clasificación, desde cuándo cuenta y cuánto dura—
 * hay que confirmarlas contra las obligaciones concretas del empleador bajo la
 * OHSA y la WSIA **antes de salir a producción**. Es el mismo cartel que §4 le
 * pone a la lista de clasificaciones que obligan investigación. Los plazos de
 * acciones correctivas, en cambio, los declara el coordinador: el sistema muestra
 * un plazo calculado; el que responde ante el organismo es una persona.
 *
 * **El sistema no envía nada** al MLITSD ni al WSIB (§3 R4). Acá se calcula qué
 * aplica y para cuándo; presentar es un acto de una persona en el portal del
 * organismo, y por eso no hay estado "presentado" en ninguna parte del sistema.
 *
 * Funciones puras sin base de datos, como ADR-008 pide para la segunda costura
 * crítica: se prueban con tabla de casos en milisegundos, sin Testcontainers.
 */

// ---------------------------------------------------------------------------
// La forma de un reloj

/** Quién exige. Dos autoridades, dos plazos que corren en paralelo. */
export const CLOCK_AUTHORITIES = ['mlitsd', 'wsib'] as const;

export type ClockAuthority = (typeof CLOCK_AUTHORITIES)[number];

/**
 * Las cuatro obligaciones que el sistema conoce.
 *
 * `mlitsd_immediate_notice` no tiene plazo porque la ley no le pone uno: dice
 * "inmediatamente". Modelarlo como "vence en 0 minutos" lo mostraría vencido un
 * segundo después de cargar el incidente, que es exactamente el ruido que hace que
 * la gente deje de mirar la pantalla.
 */
export const CLOCK_OBLIGATIONS = [
  'mlitsd_immediate_notice',
  'mlitsd_written_report',
  'mlitsd_written_notice',
  'wsib_form7',
] as const;

export type ClockObligation = (typeof CLOCK_OBLIGATIONS)[number];

/**
 * De qué instante cuenta un plazo.
 *
 * **La distinción es el diseño, no una sutileza** (design D5). Las obligaciones del
 * MLITSD por una lesión cuelgan del **evento**; la del WSIB y la de la enfermedad
 * ocupacional cuelgan de **cuándo el empleador se enteró**, que en este sistema es
 * el instante del reporte. Un solo origen para las dos daría un Form 7 vencido
 * antes de existir cada vez que alguien carga un accidente de la semana pasada.
 */
export const CLOCK_ORIGINS = ['occurrence', 'report'] as const;

export type ClockOrigin = (typeof CLOCK_ORIGINS)[number];

export interface RegulatoryClock {
  readonly authority: ClockAuthority;
  readonly obligation: ClockObligation;
  readonly countsFrom: ClockOrigin;
  /** El instante desde el que cuenta. `null` cuando la obligación es inmediata. */
  readonly from: Date;
  /** `null` cuando la obligación es inmediata y la ley no fija un plazo. */
  readonly dueAt: Date | null;
  /** "Inmediatamente", sin plazo que contar. */
  readonly immediate: boolean;
  /** De dónde sale la regla. Se muestra en pantalla junto al plazo. */
  readonly citation: string;
}

export interface RegulatoryClockInput {
  readonly classification: IncidentClassification;
  readonly occurredAt: Date;
  readonly reportedAt: Date;
}

// ---------------------------------------------------------------------------
// Los feriados de Ontario, derivados por regla

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Requisitos §1: las dos plantas son de Ontario. */
export const CLOCK_TIME_ZONE = 'America/Toronto';

/** `YYYY-MM-DD` de una fecha civil construida en UTC. */
function civilOf(utc: Date): string {
  return utc.toISOString().slice(0, 10);
}

/** El domingo de Pascua occidental de un año, por el cómputo de Meeus/Butcher. */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(Date.UTC(year, month - 1, day));
}

/** El n-ésimo día de semana de un mes: `nthWeekday(2026, 2, 1, 3)` es el 3er lunes de febrero. */
function nthWeekday(year: number, month: number, weekday: number, nth: number): Date {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const shift = (weekday - first.getUTCDay() + 7) % 7;

  return new Date(Date.UTC(year, month - 1, 1 + shift + (nth - 1) * 7));
}

/** El lunes anterior a una fecha del mes. Victoria Day es el lunes anterior al 25 de mayo. */
function mondayBefore(year: number, month: number, day: number): Date {
  const target = new Date(Date.UTC(year, month - 1, day));
  const back = (target.getUTCDay() + 6) % 7 || 7;

  return new Date(target.getTime() - back * MS_PER_DAY);
}

/**
 * Los nueve feriados estatutarios de Ontario de un año, como fechas civiles.
 *
 * **Derivados por regla y no listados año por año** (design D6). Una lista es una
 * bomba de tiempo: el día que nadie la actualiza, el sistema empieza a dar plazos
 * equivocados sobre un formulario legal, en silencio y sin que nada falle.
 *
 * **No se corre el feriado que cae en fin de semana.** Para contar días hábiles da
 * igual —el sábado ya no cuenta—; el "lunes siguiente" es una regla de días de pago,
 * no de plazos.
 */
export function ontarioStatutoryHolidays(year: number): readonly string[] {
  const easter = easterSunday(year);
  const goodFriday = new Date(easter.getTime() - 2 * MS_PER_DAY);

  return [
    `${year}-01-01`, // New Year's Day
    civilOf(nthWeekday(year, 2, 1, 3)), // Family Day: 3er lunes de febrero
    civilOf(goodFriday), // Good Friday
    civilOf(mondayBefore(year, 5, 25)), // Victoria Day: lunes anterior al 25 de mayo
    `${year}-07-01`, // Canada Day
    civilOf(nthWeekday(year, 9, 1, 1)), // Labour Day: 1er lunes de septiembre
    civilOf(nthWeekday(year, 10, 1, 2)), // Thanksgiving: 2do lunes de octubre
    `${year}-12-25`, // Christmas Day
    `${year}-12-26`, // Boxing Day
  ];
}

// ---------------------------------------------------------------------------
// La aritmética de días hábiles, en la zona de las plantas

/**
 * El desfase de la zona respecto de UTC en ese instante, en milisegundos.
 *
 * Con `Intl` y no con una resta de horas, por lo mismo que `period.ts`: el horario
 * de verano mueve el offset dos veces al año y `Intl` conoce la regla.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const value = (type: string): number => Number(parts.find((part) => part.type === type)?.value);

  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
    instant.getUTCMilliseconds(),
  );

  return asUtc - instant.getTime();
}

/** La fecha civil de la zona, y la hora del día dentro de ella, de un instante. */
function zonedParts(instant: Date, timeZone: string): { civil: string; timeOfDayMs: number } {
  const local = new Date(instant.getTime() + zoneOffsetMs(instant, timeZone));

  return {
    civil: civilOf(local),
    timeOfDayMs: local.getTime() - Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()),
  };
}

/**
 * El instante que corresponde a una fecha civil más una hora del día, en la zona.
 *
 * Dos pasadas: la primera estima el offset con la lectura ingenua y la segunda lo
 * corrige si el cambio de horario cae entre las dos. En la hora que no existe del
 * adelanto de primavera el resultado cae en la hora siguiente, que es el
 * comportamiento estándar y el único razonable para un plazo.
 */
function instantOf(civil: string, timeOfDayMs: number, timeZone: string): Date {
  const [year, month, day] = civil.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(year, month - 1, day) + timeOfDayMs;

  const firstPass = naive - zoneOffsetMs(new Date(naive), timeZone);

  return new Date(naive - zoneOffsetMs(new Date(firstPass), timeZone));
}

/** Si esa fecha civil es día hábil en Ontario: ni fin de semana ni feriado estatutario. */
export function isBusinessDay(civil: string): boolean {
  const [year, month, day] = civil.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  if (weekday === 0 || weekday === 6) return false;

  return !ontarioStatutoryHolidays(year).includes(civil);
}

/**
 * `n` días hábiles después de un instante, conservando la hora del día en Ontario.
 *
 * Tres días hábiles **no es tres días**: salta sábados, domingos y los nueve
 * feriados de `ontarioStatutoryHolidays`. Contar solo fines de semana daría un
 * plazo más largo del real cuando el feriado cae dentro de la ventana, y eso es un
 * Form 7 presentado tarde.
 */
export function addBusinessDays(from: Date, n: number, timeZone = CLOCK_TIME_ZONE): Date {
  const { civil, timeOfDayMs } = zonedParts(from, timeZone);

  let cursor = new Date(`${civil}T00:00:00.000Z`);
  let remaining = n;

  while (remaining > 0) {
    cursor = new Date(cursor.getTime() + MS_PER_DAY);
    if (isBusinessDay(civilOf(cursor))) remaining -= 1;
  }

  return instantOf(civilOf(cursor), timeOfDayMs, timeZone);
}

// ---------------------------------------------------------------------------
// Las tablas de plazos

const HOURS = 60 * 60 * 1000;

/** El plazo del MLITSD por clasificación. `null` es "no dispara obligación". */
interface MlitsdRule {
  readonly obligation: ClockObligation;
  readonly countsFrom: ClockOrigin;
  readonly durationMs: number | null;
  readonly citation: string;
}

/**
 * Qué le debe el empleador al MLITSD por cada clasificación.
 *
 * **Los dos orígenes distintos no son un descuido.** La lesión dispara plazos que
 * cuelgan del **evento** —la OHSA los cuenta desde que ocurrió—, mientras que la
 * enfermedad ocupacional los cuenta desde que al empleador **se le avisa**, porque
 * una enfermedad no tiene un instante de ocurrencia que alguien pueda fijar. Si la
 * enfermedad contara desde `occurred_at`, todo caso reportado meses después de su
 * inicio nacería vencido y la pantalla mostraría un rojo permanente que nadie puede
 * accionar.
 *
 * CONFIGURACIÓN EN CÓDIGO. Confirmar contra la OHSA antes de producción.
 */
const MLITSD_RULES: Readonly<Record<IncidentClassification, readonly MlitsdRule[]>> = {
  critical_injury: [
    {
      obligation: 'mlitsd_immediate_notice',
      countsFrom: 'occurrence',
      durationMs: null,
      citation: 'OHSA s. 51(1) — aviso inmediato por teléfono o medio directo',
    },
    {
      obligation: 'mlitsd_written_report',
      countsFrom: 'occurrence',
      durationMs: 48 * HOURS,
      citation: 'OHSA s. 51(1) — informe escrito dentro de las 48 horas',
    },
  ],
  lost_time_or_modified_work: [
    {
      obligation: 'mlitsd_written_notice',
      countsFrom: 'occurrence',
      durationMs: 4 * 24 * HOURS,
      citation: 'OHSA s. 52(1) — aviso escrito dentro de los 4 días',
    },
  ],
  health_care: [
    {
      obligation: 'mlitsd_written_notice',
      countsFrom: 'occurrence',
      durationMs: 4 * 24 * HOURS,
      citation: 'OHSA s. 52(1) — aviso escrito dentro de los 4 días',
    },
  ],
  occupational_illness: [
    {
      obligation: 'mlitsd_written_notice',
      countsFrom: 'report',
      durationMs: 4 * 24 * HOURS,
      citation: 'OHSA s. 52(2) — aviso escrito dentro de los 4 días de ser advertido',
    },
  ],
  // Los primeros auxilios no disparan obligación ante el MLITSD, y esa lista vacía
  // es la regla, no un hueco por completar.
  first_aid: [],
};

/**
 * Los días hábiles del Form 7, y las clasificaciones que lo disparan.
 *
 * Cuenta desde el **reporte** —cuándo el empleador se enteró— y no desde el evento.
 *
 * CONFIGURACIÓN EN CÓDIGO. Confirmar contra la WSIA antes de producción.
 */
export const WSIB_FORM7_BUSINESS_DAYS = 3;

const WSIB_CITATION = 'WSIA s. 21(2) — informe del empleador dentro de los 3 días hábiles';

/** Los primeros auxilios no requieren Form 7; las otras cuatro sí. */
function requiresForm7(classification: IncidentClassification): boolean {
  return classification !== 'first_aid';
}

// ---------------------------------------------------------------------------
// La función

/**
 * Las obligaciones que dispara un incidente, con su plazo y su cita.
 *
 * **Una sola función para las dos autoridades** (design D5): "qué me toca hacer" es
 * una sola pregunta del coordinador, y partirla en dos llamadas invita a que la
 * pantalla se olvide de una.
 *
 * Pura y con las tres entradas inyectadas. Como las tres viven congeladas en una
 * fila append-only, **dos llamadas separadas por un mes devuelven lo mismo**, que es
 * lo que permite que ningún plazo se guarde como columna (ADR-008, design D7).
 */
export function regulatoryClocks(input: RegulatoryClockInput): readonly RegulatoryClock[] {
  const { classification, occurredAt, reportedAt } = input;

  const originOf = (countsFrom: ClockOrigin): Date =>
    countsFrom === 'occurrence' ? occurredAt : reportedAt;

  const clocks: RegulatoryClock[] = MLITSD_RULES[classification].map((rule) => {
    const from = originOf(rule.countsFrom);

    return {
      authority: 'mlitsd',
      obligation: rule.obligation,
      countsFrom: rule.countsFrom,
      from,
      dueAt: rule.durationMs === null ? null : new Date(from.getTime() + rule.durationMs),
      immediate: rule.durationMs === null,
      citation: rule.citation,
    };
  });

  if (requiresForm7(classification)) {
    clocks.push({
      authority: 'wsib',
      obligation: 'wsib_form7',
      countsFrom: 'report',
      from: reportedAt,
      dueAt: addBusinessDays(reportedAt, WSIB_FORM7_BUSINESS_DAYS),
      immediate: false,
      citation: WSIB_CITATION,
    });
  }

  return clocks;
}

/**
 * Si un reloj ya venció contra un instante dado.
 *
 * El reloj se pasa por parámetro en vez de leer `new Date()` adentro por lo mismo
 * que `escalationLevelsDue` en `actions.ts`: el test no necesita mover el reloj del
 * proceso. Una obligación inmediata **nunca se reporta vencida**: no tiene plazo
 * contra el cual estarlo.
 */
export function isClockOverdue(clock: RegulatoryClock, now: Date): boolean {
  return clock.dueAt !== null && now.getTime() > clock.dueAt.getTime();
}
