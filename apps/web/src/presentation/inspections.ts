import type { ScheduledInspection } from '@hs/contracts';

/**
 * Qué inspecciones de la planta son "las que cerré yo", y en qué orden se leen.
 *
 * Vive acá y no en una ruta porque la usan dos: la tarjeta de la pantalla de inicio, que
 * muestra las últimas tres, y la pantalla del historial, que las muestra todas. Son la
 * misma lista con distinto largo, y una definición por pantalla sería una pantalla capaz
 * de contradecir a la otra.
 *
 * `status` ya lo deriva el motor (`period-status.sql.ts`); acá no se vuelve a decidir qué
 * es "completado". El recorte por cuenta sí es del cliente: `GET /scheduled-inspections`
 * devuelve la planta entera —un miembro del JHSC viendo la programación de su sitio es
 * legítimo— y esto es lo que la reduce a lo propio.
 */
export function completedInspections(
  scheduled: readonly ScheduledInspection[],
  userId: string,
): ScheduledInspection[] {
  return [...scheduled]
    .filter((item) => item.inspector_id === userId && item.status === 'completed')
    .sort((a, b) => b.period_start.localeCompare(a.period_start));
}

/** Lo mismo, recortado a lo que entra en la tarjeta de la pantalla de inicio. */
export function recentCompleted(
  scheduled: readonly ScheduledInspection[],
  userId: string,
  limit = 3,
): ScheduledInspection[] {
  return completedInspections(scheduled, userId).slice(0, limit);
}
