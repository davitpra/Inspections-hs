import type { InspectorOption, PeriodStatus, ScheduledInspection } from '@hs/contracts';

/**
 * Cómo se lee la consola de programación: etiquetas y clases, sin marcado.
 *
 * Aparte del componente por la misma razón que `action-permissions.ts`: lo que importa
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

/** El mes del período, que es como se habla de él. `2026-08-01` → `2026-08`. */
export function periodLabel(periodStart: string): string {
  return periodStart.slice(0, 7);
}
