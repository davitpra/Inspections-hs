import type {
  InspectionSchedule,
  InspectorOption,
  PeriodMonths,
  PeriodStatus,
  ScheduledInspection,
} from '@hs/contracts';

import { civilMonth, monthName, periodLabel } from '../../presentation/dates';

/**
 * Cómo se lee la consola de programación: etiquetas y clases, sin marcado.
 *
 * Aparte del componente por la misma razón que `src/permissions/`: lo que importa
 * es la decisión y el nombre de cada cosa, y eso se prueba sin renderizar nada.
 */

/** El estado del período en palabras. Lo deriva el servidor; acá solo se nombra. */
export const STATUS_LABELS: Readonly<Record<PeriodStatus, string>> = {
  completed: 'Completed',
  open: 'Open',
  missed: 'Missed',
  cancelled: 'Cancelled',
};

/**
 * La clase del estado. Son las mismas que ya usa el reporte de cumplimiento, a propósito:
 * el mismo estado se ve igual en las dos pantallas o deja de significar lo mismo.
 */
export function statusClass(status: PeriodStatus): string {
  return `period period--${status}`;
}

/** La clase de la píldora de estado — misma paleta que `statusClass`, forma de badge. */
export function statusPillClass(status: PeriodStatus): string {
  return `status-pill status-pill--${status}`;
}

/**
 * Lo que hay que mostrar donde va el nombre del inspector.
 *
 * TRES CASOS DISTINTOS y el del medio es el que existe por el aislamiento de `person`:
 *
 *   - Sin asignar — y esto es lo que la consola existe para hacer visible: una inspección
 *     sin inspector no está en la lista de pendientes de nadie.
 *   - Asignada, pero sin nombre legible: la cuenta es válida y su persona vive en la otra
 *     planta, así que quien mira no la puede ver. Se dice, no se disimula con un UUID.
 *   - Asignada y con nombre.
 */
export function inspectorLabel(inspection: ScheduledInspection): string {
  if (inspection.inspector_id === null) return 'Unassigned';

  return inspection.inspector_name ?? 'Assigned (name not visible from this site)';
}

/**
 * Lo que la píldora `missed` no dice.
 *
 * El estado se deriva de la fecha (`period-status.sql.ts`), no de una decisión: el mes
 * cerró sin inspección y por eso se lee omitido. Pero la fila sigue viva —`ingest`
 * rechaza la cancelada y la ajena, nunca la vencida—, así que el inspector asignado
 * todavía puede enviarla y el período pasa a `completed`.
 *
 * IMPORTA JUSTO DESPUÉS DE REPROGRAMAR UN MES CERRADO: la fila nueva nace en rojo, y sin
 * esta línea parece que reprogramar no sirvió de nada. Sin inspector no hay quien la
 * envíe, y entonces lo que falta es asignarla; eso es lo que cambia entre los dos textos.
 */
export function missedNote(inspection: ScheduledInspection): string | null {
  if (inspection.status !== 'missed') return null;

  return inspection.inspector_id === null
    ? 'The period closed without an inspection. Assign an inspector and it can still be submitted.'
    : 'The period closed without an inspection. It can still be submitted.';
}

/** Aviso de que el período conserva su versión, aunque ya haya una revisión publicada. */
export function newerVersionNote(
  inspection: Pick<ScheduledInspection, 'template_version'>,
  latestVersion: number | null | undefined,
): string | null {
  if (latestVersion === undefined || latestVersion === null) return null;
  if (latestVersion <= inspection.template_version) return null;

  return `Version ${latestVersion} is published. This period is still on version ${inspection.template_version}.`;
}

/** Si esta fila es de las que el coordinador tiene que resolver. */
export function isUnassigned(inspection: ScheduledInspection): boolean {
  return inspection.inspector_id === null && inspection.cancelled_at === null;
}

/**
 * El aviso de cuántas quedaron sin dueño.
 *
 * Dice lo que PASA y no solo el número, porque el número solo no explica por qué importa:
 * quien lo lee no tiene forma de saber que una inspección sin inspector es invisible.
 */
export function unassignedNotice(inspections: readonly ScheduledInspection[]): string | null {
  const count = inspections.filter(isUnassigned).length;

  if (count === 0) return null;

  const subject = count === 1 ? '1 scheduled inspection has' : `${count} scheduled inspections have`;

  return `${subject} no inspector and appear in nobody's pending list.`;
}

/**
 * El nombre de un candidato en el selector.
 *
 * Con el número de empleado al lado porque §4 dice que el nombre NO identifica: dos
 * personas activas pueden llamarse igual y las dos filas son legítimas.
 */
export function candidateLabel(candidate: InspectorOption): string {
  const name = [candidate.first_name, candidate.last_name].filter(Boolean).join(' ');

  if (name === '') return candidate.employee_number ?? candidate.id;

  return candidate.employee_number === null ? name : `${name} (${candidate.employee_number})`;
}

/**
 * Una fila por plantilla, no una por regla.
 *
 * `createSchedule`/`updateSchedule` nunca borran: desactivar y volver a crear una regla
 * para la misma plantilla deja filas viejas dando vueltas. Acá se elige cuál mostrar — la
 * activa si hay una (el índice parcial de 0008 garantiza que hay como mucho una), y si no
 * hay ninguna, la desactivada más reciente. El resto es historial, no estado actual.
 */
export function currentRules(
  rules: readonly InspectionSchedule[],
): InspectionSchedule[] {
  const byTemplate = new Map<string, InspectionSchedule>();

  for (const rule of rules) {
    const chosen = byTemplate.get(rule.template_id);

    if (!chosen) {
      byTemplate.set(rule.template_id, rule);
      continue;
    }

    if (chosen.deactivated_at === null) continue; // ya hay una activa, gana siempre

    if (rule.deactivated_at === null || rule.deactivated_at > chosen.deactivated_at) {
      byTemplate.set(rule.template_id, rule);
    }
  }

  return [...byTemplate.values()];
}

/**
 * Una casilla del calendario que la regla debe pero que todavía no es una fila: no hay
 * `id`, ni estado, ni inspector — nada de eso existe hasta que el coordinador la abre.
 */
export interface UnopenedPeriod {
  site_id: string;
  template_id: string;
  template_name: string;
  period_start: string;
  /** Copiado de la regla que lo reclama: la casilla tiene que poder decir «Q1 2026». */
  period_months: PeriodMonths;
}

export type YearEntry =
  | { kind: 'opened'; inspection: ScheduledInspection }
  | { kind: 'unopened'; period: UnopenedPeriod };

function entrySortKey(entry: YearEntry): { periodStart: string; templateName: string } {
  return entry.kind === 'opened'
    ? { periodStart: entry.inspection.period_start, templateName: entry.inspection.template_name }
    : { periodStart: entry.period.period_start, templateName: entry.period.template_name };
}

/**
 * El nombre del período DENTRO del calendario de un año.
 *
 * `periodLabel` siempre lleva el año, y tiene que llevarlo en la pantalla del inspector,
 * donde no hay ningún encabezado que lo diga. Acá sí lo hay —el navegador
 * de año lo muestra en grande arriba— así que repetirlo en las doce filas es ruido.
 *
 * Se recorta SOLO cuando la etiqueta termina en el año que se está mirando. Un período que
 * cruza el año («Nov 2026–Jan 2027») termina en el OTRO, y ahí el año no sobra: es la única
 * forma de ver que esa casilla se va del año. Una regla anual en su propio año se llama
 * «2026» y tampoco se recorta, porque el año ES el nombre del período.
 */
export function calendarLabel(
  periodStart: string,
  periodMonths: PeriodMonths,
  year: string,
): string {
  const label = periodLabel(periodStart, periodMonths);

  return label.endsWith(` ${year}`) ? label.slice(0, -(year.length + 1)) : label;
}

/**
 * Qué significa la frecuencia de una regla, en una línea, y por qué no se puede cambiar.
 *
 * Las dos mitades hacen falta. La primera dice CUÁNDO cae la serie, que con un ancla que
 * no es enero no es evidente: «Quarterly» a secas deja pensar en el trimestre civil.
 * La segunda dice que hay que desactivar y recrear — sin eso, el coordinador busca un
 * control que el motor rechaza con HS001 y concluye que falta implementarlo.
 *
 * Para una regla mensual el ancla no se nombra: `mod 1` es cero para todos los meses, así
 * que decir «anchored in January» sería inventar una restricción que no existe.
 */
export function frequencyNote(
  rule: Pick<InspectionSchedule, 'frequency_months' | 'anchor_month'>,
): string {
  const change = 'to change it, deactivate this rule and create another';

  if (rule.frequency_months === 1) return `one period every month — ${change}`;

  // `monthName` toma un `period_start` y no un índice, así que se le arma uno: el año no
  // participa del nombre del mes. Es preferible a una cuarta copia de los doce nombres.
  const anchor = monthName(`2000-${String(rule.anchor_month).padStart(2, '0')}-01`);
  const every =
    rule.frequency_months === 12 ? 'every 12 months' : `every ${rule.frequency_months} months`;

  return `one period ${every}, starting in ${anchor} — ${change}`;
}

/**
 * Si el mes EMPIEZA un período de esa regla.
 *
 * ESPEJO EXACTO de `containingPeriodStart()` y `startsPeriod()` en
 * `apps/api/src/inspections/period.ts`, y de la expresión `MOD` que usan el trabajo de
 * apertura y el CTE `owed` del reporte. Son cuatro copias de la misma aritmética y no se
 * pueden unificar —una corre en Postgres, otra en el servidor, esta en el navegador— así
 * que la defensa es que los tests de las dos de TypeScript fijen los MISMOS casos. El
 * cruce de año hacia atrás (ancla 11, trimestral, mes de enero) es el que se rompe primero
 * si alguien "simplifica" el `+ 12`.
 *
 * Funciona con un `mod` sobre el mes 1-12 porque las cuatro frecuencias dividen a 12; ver
 * `periodMonthsSchema` en contracts.
 */
export function startsPeriod(
  rule: Pick<InspectionSchedule, 'frequency_months' | 'anchor_month'>,
  periodStart: string,
): boolean {
  const month = Number(periodStart.slice(5, 7));

  return (month - rule.anchor_month + 12) % rule.frequency_months === 0;
}

/**
 * Si la regla debe ese período: empieza donde la regla ancla, y cae dentro de la ventana
 * `created_at`..`deactivated_at`, inclusiva en los dos extremos y resuelta en la misma
 * zona que el trabajo automático.
 */
export function ruleOwesPeriod(
  rule: Pick<
    InspectionSchedule,
    'created_at' | 'deactivated_at' | 'frequency_months' | 'anchor_month'
  >,
  periodStart: string,
): boolean {
  if (!startsPeriod(rule, periodStart)) return false;

  const month = periodStart.slice(0, 7);
  const owesFrom = civilMonth(new Date(rule.created_at));

  if (month < owesFrom) return false;
  if (rule.deactivated_at === null) return true;

  return month <= civilMonth(new Date(rule.deactivated_at));
}

function monthsOfYear(year: string): string[] {
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}-01`);
}

/**
 * Cuál de las inspecciones de un mismo mes y plantilla es la que representa ese mes.
 *
 * Cancelar no borra: programa de nuevo. Después de eso el mes tiene DOS filas —la
 * cancelada y la que la reemplaza— y el índice parcial de 0008 garantiza que como mucho
 * una está viva. Esa es la del calendario; entre puras canceladas gana la última, que es
 * el motivo que corresponde leer.
 */
export function currentPeriod(
  periods: readonly ScheduledInspection[],
): ScheduledInspection | undefined {
  return periods.reduce<ScheduledInspection | undefined>((chosen, period) => {
    if (!chosen) return period;
    if (chosen.cancelled_at === null) return chosen;
    if (period.cancelled_at === null) return period;

    return period.cancelled_at > chosen.cancelled_at ? period : chosen;
  }, undefined);
}

/** Las inspecciones agrupadas por la casilla del calendario que ocupan. */
function bySlot(
  periods: readonly ScheduledInspection[],
): Map<string, ScheduledInspection[]> {
  const slots = new Map<string, ScheduledInspection[]>();

  for (const period of periods) {
    const key = `${period.template_id}|${period.period_start}`;
    slots.set(key, [...(slots.get(key) ?? []), period]);
  }

  return slots;
}

/**
 * El calendario de un año: una entrada por regla vigente y por mes que esa regla debe,
 * de enero a diciembre. Donde ya existe la fila real, donde no una casilla `unopened`.
 *
 * Los períodos que ninguna regla vigente reclama para ese año —programados fuera del
 * calendario, o dejados atrás por una regla ya desactivada— se agregan igual: la
 * proyección solo AGREGA meses, nunca esconde un mes que alguien debe.
 *
 * UNA FILA POR CASILLA, y esa es la única cosa que sí se esconde: un mes cancelado y
 * vuelto a programar tiene dos inspecciones, y `currentPeriod` elige la que manda. Sin
 * esto el orden de la respuesta decidía cuál se veía, y la cancelada podía tapar a la
 * viva.
 */
export function projectYear(
  rules: readonly InspectionSchedule[],
  periods: readonly ScheduledInspection[],
  year: string,
): YearEntry[] {
  const byKey = new Map<string, ScheduledInspection>();
  for (const [key, slot] of bySlot(periods)) {
    const chosen = currentPeriod(slot);

    if (chosen) byKey.set(key, chosen);
  }

  const claimed = new Set<string>();
  const entries: YearEntry[] = [];

  for (const rule of currentRules(rules)) {
    // Se siguen recorriendo los doce meses y se filtra por `ruleOwesPeriod`, en vez de
    // generar los inicios de período de la regla: es la misma lista y evita una segunda
    // aritmética de calendario que podría discrepar con `startsPeriod` en el cruce de año.
    for (const periodStart of monthsOfYear(year)) {
      if (!ruleOwesPeriod(rule, periodStart)) continue;

      const key = `${rule.template_id}|${periodStart}`;
      claimed.add(key);

      const existing = byKey.get(key);

      entries.push(
        existing
          ? { kind: 'opened', inspection: existing }
          : {
              kind: 'unopened',
              period: {
                site_id: rule.site_id,
                template_id: rule.template_id,
                template_name: rule.template_name,
                period_start: periodStart,
                period_months: rule.frequency_months,
              },
            },
      );
    }
  }

  for (const [key, period] of byKey) {
    if (period.period_start.slice(0, 4) !== year) continue;
    if (claimed.has(key)) continue;

    entries.push({ kind: 'opened', inspection: period });
  }

  return entries.sort((a, b) => {
    const left = entrySortKey(a);
    const right = entrySortKey(b);

    return (
      left.periodStart.localeCompare(right.periodStart) ||
      left.templateName.localeCompare(right.templateName)
    );
  });
}

/** Los conteos del pie del calendario: cuántos meses caen en cada estado del año proyectado. */
export interface YearStats {
  total: number;
  completed: number;
  missed: number;
  unassigned: number;
  unopened: number;
}

/**
 * Los mismos tres cubos que ya distingue la fila — abierto y con dueño, abierto y sin uno
 * (`isUnassigned`), o todavía no abierto — contados sobre el año que `projectYear` arma.
 * Un período cancelado no tiene dueño que asignar, así que cuenta como resuelto y no como
 * pendiente: `isUnassigned` ya lo excluye por la misma razón.
 */
export function yearStats(entries: readonly YearEntry[]): YearStats {
  let completed = 0;
  let missed = 0;
  let unassigned = 0;
  let unopened = 0;

  for (const entry of entries) {
    if (entry.kind === 'unopened') {
      unopened += 1;
      continue;
    }

    if (entry.inspection.cancelled_at !== null) continue;
    if (entry.inspection.status === 'completed') completed += 1;
    if (entry.inspection.status === 'missed') missed += 1;
    if (isUnassigned(entry.inspection)) {
      unassigned += 1;
    }
  }

  return { total: entries.length, completed, missed, unassigned, unopened };
}

export type ScheduleFilter =
  | 'all'
  | 'completed'
  | 'missed'
  | 'unassigned'
  | 'unopened'
  | 'open'
  | 'cancelled';

export interface ScheduleFilters {
  templateId: string;
  state: ScheduleFilter;
}

export function entryTemplateId(entry: YearEntry): string {
  return entry.kind === 'opened' ? entry.inspection.template_id : entry.period.template_id;
}

export function entryTemplateName(entry: YearEntry): string {
  return entry.kind === 'opened' ? entry.inspection.template_name : entry.period.template_name;
}

export function entryPeriodStart(entry: YearEntry): string {
  return entry.kind === 'opened' ? entry.inspection.period_start : entry.period.period_start;
}

export function entryStatus(entry: YearEntry): ScheduleFilter {
  if (entry.kind === 'unopened') return 'unopened';
  if (entry.inspection.cancelled_at !== null) return 'cancelled';
  return entry.inspection.status;
}

export function filterEntries(
  entries: readonly YearEntry[],
  filters: ScheduleFilters,
): YearEntry[] {
  return entries.filter((entry) => {
    const matchesTemplate = filters.templateId === 'all' || entryTemplateId(entry) === filters.templateId;
    const matchesState = filters.state === 'all' || entryStatus(entry) === filters.state ||
      (filters.state === 'unassigned' && entry.kind === 'opened' && isUnassigned(entry.inspection));

    return matchesTemplate && matchesState;
  });
}

export interface MatrixRow {
  templateId: string;
  templateName: string;
  cells: readonly (YearEntry | null)[];
}

/** Agrupa entradas ya proyectadas; no vuelve a decidir qué debe una regla. */
export function matrixRows(entries: readonly YearEntry[]): MatrixRow[] {
  const groups = new Map<string, { templateName: string; cells: (YearEntry | null)[] }>();

  for (const entry of entries) {
    const templateId = entryTemplateId(entry);
    const group = groups.get(templateId) ?? {
      templateName: entryTemplateName(entry),
      cells: Array.from({ length: 12 }, () => null),
    };
    const month = Number(entryPeriodStart(entry).slice(5, 7)) - 1;
    group.cells[month] = entry;
    groups.set(templateId, group);
  }

  return [...groups.entries()]
    .map(([templateId, group]) => ({ templateId, ...group }))
    .sort((left, right) => left.templateName.localeCompare(right.templateName));
}

export function listEntries(entries: readonly YearEntry[]): YearEntry[] {
  return [...entries].sort((left, right) => {
    return entryPeriodStart(left).localeCompare(entryPeriodStart(right)) ||
      entryTemplateName(left).localeCompare(entryTemplateName(right));
  });
}

/**
 * El año más antiguo al que la navegación deja retroceder: el que ve el coordinador al
 * abrir la pantalla, o uno más viejo si ya existe una regla o un período ahí. Hacia
 * adelante no hay tope — la obligación es mensual y se conoce para cualquier año futuro.
 */
export function earliestEligibleYear(
  rules: readonly InspectionSchedule[],
  periods: readonly ScheduledInspection[],
  currentYear: string,
): string {
  const years = [
    currentYear,
    ...rules.map((rule) => civilMonth(new Date(rule.created_at)).slice(0, 4)),
    ...periods.map((period) => period.period_start.slice(0, 4)),
  ];

  return years.reduce((earliest, year) => (year < earliest ? year : earliest));
}
