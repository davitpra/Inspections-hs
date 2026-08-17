import type { PendingInspection } from "@hs/contracts";

import type { DraftRow } from "../../offline/db";
import { DiscardRefusedError, type DiscardRefusal } from "../../offline/drafts";
import { civilMonth, monthName } from "../../presentation/dates";

/**
 * Cómo se lee un borrador en la lista, y qué se le puede hacer.
 *
 * Es lógica pura y vive acá porque decide algo que importa: qué fila ofrece descartar.
 * `isDiscardable` de `offline/drafts.ts` es la regla de la escritura —la que de verdad
 * impide borrar— y esto es la de la pantalla, que solo decide qué se dibuja. Las dos
 * dicen lo mismo a propósito: una fila que ofreciera un botón que la base va a rechazar
 * sería una promesa rota, y una que lo escondiera dejaría al inspector sin salida.
 */
/**
 * El mes del período de un borrador, cuando se puede saber.
 *
 * El borrador guarda `scheduled_inspection_id` pero no `period_start`: el mes hay que
 * resolverlo contra la lista del servidor. Un borrador ya aceptado salió de esa lista, y
 * uno hecho sin red puede no tenerla todavía, así que esto devuelve `null` seguido y la
 * tarjeta cae a la fecha en que se empezó. Inventar un mes sería peor que no mostrarlo:
 * el mes es lo que identifica la obligación ante el regulador.
 */
export function draftPeriodStart(
  draft: Pick<DraftRow, "scheduled_inspection_id">,
  pending: readonly PendingInspection[],
): string | null {
  return (
    pending.find((item) => item.id === draft.scheduled_inspection_id)
      ?.period_start ?? null
  );
}

/**
 * Si el paquete de campo está listo, todavía no, o no se sabe.
 *
 * `unknown` es la consulta sin resolver y NO es un caso de borde decorativo: es el que
 * hace que la tarjeta no ofrezca ninguna acción. Un botón de empezar dibujado antes de
 * saber si el documento está en el dispositivo manda al inspector a una pantalla que lo
 * va a rechazar, y eso se descubre en la planta, sin red y sin arreglo.
 */
export type Readiness = "ready" | "not-ready" | "unknown";

export function readiness(missing: readonly string[] | undefined): Readiness {
  if (missing === undefined) return "unknown";

  return missing.length === 0 ? "ready" : "not-ready";
}

export function draftPillClass(status: DraftRow["status"]): string {
  if (status === "accepted") return "status-pill status-pill--completed";

  return status === "signed"
    ? "status-pill status-pill--signed"
    : "status-pill status-pill--draft";
}

/**
 * La asignación que abre la pantalla: la que importa AHORA, antes que el resto del año.
 *
 * Lo vencido gana sobre el mes en curso — un mes que ya cerró sin inspección es lo que
 * hay que resolver primero, y el más antiguo de los vencidos es el más urgente. Entre
 * vencidos, `pendingOfYear` ya ordena por `period_start`, así que acá alcanza con
 * filtrar y tomar el primero.
 *
 * `null` es un caso real y no un placeholder: es el mes en curso sin asignación, que la
 * pantalla dibuja como el estado vacío del mock y no como una tarjeta rota.
 */
export function focusedAssignment(
  pending: readonly PendingInspection[],
  now: Date = new Date(),
): PendingInspection | null {
  const overdueOnes = [...pending]
    .filter((item) => item.overdue)
    .sort((a, b) => a.period_start.localeCompare(b.period_start));

  if (overdueOnes.length > 0) return overdueOnes[0]!;

  const thisMonth = civilMonth(now);

  return (
    pending.find((item) => item.period_start.slice(0, 7) === thisMonth) ?? null
  );
}

/**
 * Lo próximo que ya está en el calendario, más allá del mes en curso.
 *
 * Solo existe cuando el coordinador programó por adelantado: la mayoría de los meses se
 * abren automáticamente uno a la vez, así que esto devuelve `null` mucho más seguido que
 * no. Es lo que el estado vacío ofrece en lugar de dejar la pantalla sin nada que decir.
 */
export function nextAssignment(
  pending: readonly PendingInspection[],
  now: Date = new Date(),
): PendingInspection | null {
  const thisMonth = civilMonth(now);

  const future = pending
    .filter(
      (item) => !item.overdue && item.period_start.slice(0, 7) > thisMonth,
    )
    .sort((a, b) => a.period_start.localeCompare(b.period_start));

  return future[0] ?? null;
}

/**
 * De la lista del dispositivo queda solo lo que todavía pide trabajo.
 *
 * `accepted` no es un borrador: el servidor ya lo tiene, no se puede editar, no se puede
 * descartar y no espera nada. Listarlo bajo "Drafts on this device" hacía que el título
 * mintiera sobre la mayoría de sus filas —una pantalla con ocho "Submitted" bajo el
 * encabezado de borradores— y enterraba las dos que sí pedían trabajo.
 *
 * Lo enviado se lee en "Recent inspections", que sale de la programación del servidor;
 * esta pantalla ya no lo repite desde el dispositivo.
 */
export function pendingWork(drafts: DraftRow[]): DraftRow[] {
  return drafts.filter((draft) => draft.status !== "accepted");
}

/**
 * Por qué no se pudo descartar, en inglés y diciendo dónde quedó el borrador.
 *
 * Cada motivo termina en lo mismo: la inspección sigue en el dispositivo. Es lo único
 * que el inspector necesita saber para no volver a intentarlo creyendo que se perdió.
 */
export function discardRefusalMessage(error: unknown): string {
  const reason: DiscardRefusal | "unknown" =
    error instanceof DiscardRefusedError ? error.reason : "unknown";

  switch (reason) {
    case "not_owner":
      return "This draft belongs to another account on this device. Sign in as its owner to discard it.";
    case "already_signed":
    case "already_queued":
      return "This inspection is signed and waiting to be sent. It cannot be discarded — it is on its way.";
    default:
      return "The draft could not be discarded. It is still on this device.";
  }
}

/** Cuánto falta o hace que pasó un plazo, en días. `today` es el día civil de la planta. */
export function dueIn(periodEnd: string, today: string): string {
  const end = Date.parse(`${periodEnd}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  const days = Math.round((end - now) / 86_400_000);

  if (days === 0) return "Due today";
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;

  const overdueDays = -days;
  return `${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue`;
}

export type AssignmentAction =
  | "none"
  | "download"
  | "start"
  | "resume"
  | "open";

export interface AssignmentState {
  action: AssignmentAction;
  actionLabel: string;
  pillLabel: string;
  pillClass: string;
}

const OVERDUE_PILL = {
  pillLabel: "Overdue",
  pillClass: "status-pill status-pill--overdue",
};

/**
 * La píldora y la acción de una asignación, decididas UNA vez.
 *
 * `PendingRow` y `AssignmentHero` consumen esta misma función: si la tarjeta destacada y
 * la del calendario para el mismo mes ofrecieran acciones distintas, el desacuerdo sería
 * visible en una sola pantalla.
 *
 * Lo vencido gana en la PÍLDORA y no en la acción: un mes vencido y ya descargado sigue
 * ofreciendo "Start inspection", no "Download for the field" — lo que falta no es el
 * paquete.
 */
export function assignmentState({
  readiness: state,
  overdue,
  draftStatus,
}: {
  readiness: Readiness;
  overdue: boolean;
  draftStatus: DraftRow["status"] | null;
}): AssignmentState {
  if (state === "unknown") {
    return {
      action: "none",
      actionLabel: "",
      ...(overdue ? OVERDUE_PILL : { pillLabel: "", pillClass: "" }),
    };
  }

  if (draftStatus === "signed") {
    return {
      action: "open",
      actionLabel: "Open inspection",
      ...(overdue
        ? OVERDUE_PILL
        : {
            pillLabel: "Signed, waiting to send",
            pillClass: "status-pill status-pill--signed",
          }),
    };
  }

  if (draftStatus === "capturing") {
    return {
      action: "resume",
      actionLabel: "Resume inspection",
      ...(overdue
        ? OVERDUE_PILL
        : {
            pillLabel: "In progress",
            pillClass: "status-pill status-pill--draft",
          }),
    };
  }

  if (state === "not-ready") {
    return {
      action: "download",
      actionLabel: "Download for the field",
      ...(overdue
        ? OVERDUE_PILL
        : {
            pillLabel: "Needs downloading",
            pillClass: "status-pill status-pill--not-ready",
          }),
    };
  }

  return {
    action: "start",
    actionLabel: "Start inspection",
    ...(overdue
      ? OVERDUE_PILL
      : {
          pillLabel: "Ready to start",
          pillClass: "status-pill status-pill--ready",
        }),
  };
}

/**
 * Cuándo se puede empezar una asignación que todavía no abrió: `2027-09-01` → `Opens
 * September 1`.
 *
 * Es el dato que distingue la próxima asignación de la del mes en curso. La del mes en
 * curso se empieza hoy; esta no se empieza todavía, y decir el día es lo que evita que el
 * inspector la busque una semana antes.
 */
export function availabilityLabel(periodStart: string): string {
  return `Opens ${monthName(periodStart)} ${Number(periodStart.slice(8, 10))}`;
}

export function statusLabel(status: DraftRow["status"]): string {
  /**
   * `signed` se nombra distinto de `capturing` y no se lo llama "Submitted": está
   * firmado y esperando en el outbox, que no es lo mismo que aceptado. El inspector que
   * lee "Submitted" en algo que todavía no salió del dispositivo cierra la aplicación
   * creyendo que terminó.
   */
  if (status === "accepted") return "Submitted";
  if (status === "signed") return "Signed, waiting to send";

  return "Draft";
}
