/**
 * ADR-005 — El catálogo de trabajos, tipado.
 *
 * Existe para que el nombre de una cola y la forma de su payload no puedan divergir:
 * `send('inspections.open-period', { ... })` con el objeto equivocado no compila, y
 * un nombre inventado tampoco. Sin esto, un typo en una cadena produce un trabajo que
 * se encola y no lo consume nadie — un fallo silencioso, que es la peor clase para un
 * planificador.
 *
 * ADR-005 enumera tres trabajos: la apertura del período, el escalamiento de
 * acciones vencidas (etapa 5, ya acá) y las notificaciones al coordinador. El que
 * falta se agrega acá y hereda el ciclo de vida y la parada ordenada sin rediseñar
 * nada.
 */
export interface JobPayloads {
  /**
   * Abre las inspecciones del período corriente de cada planta. Cron diario.
   *
   * `now` viaja en el payload en vez de leerse dentro del handler, y no es un
   * detalle de test: es lo que permite reabrir a mano un período que quedó sin abrir
   * porque el planificador estuvo caído, sin tener que mover el reloj del servidor.
   * Ausente significa "ahora".
   */
  'inspections.open-period': { now?: string };

  /**
   * Escala las acciones correctivas vencidas: +3 días a coordinación, +7 a gerencia
   * (§3 R3). El trabajo que ADR-005 nombra primero entre sus motivos.
   *
   * `now` viaja en el payload por lo mismo que arriba, y acá se cobra dos veces: es
   * lo que permite correr a mano el escalamiento de un día que el planificador
   * estuvo caído, y es lo que hace que el test pueda situarse ocho días después de
   * un vencimiento sin tocar el reloj del proceso.
   */
  'actions.escalate-overdue': { now?: string };

}

export type JobName = keyof JobPayloads;

/** El nombre de la cola de apertura, escrito una sola vez. */
export const OPEN_PERIOD_JOB = 'inspections.open-period' satisfies JobName;

/**
 * El cron: todos los días a las 03:00, hora de Ontario.
 *
 * DIARIO Y NO MENSUAL, a propósito. Un cron mensual que cae el día que el servidor
 * está caído pierde el período entero y nadie se entera hasta que alguien pregunta
 * por qué no hay inspección de marzo. Diario, el trabajo es idempotente —el único
 * parcial de `scheduled_inspection` lo garantiza— así que las 30 corridas de un mes
 * abren una sola vez y la primera que encuentre la base arriba se recupera sola.
 */
export const OPEN_PERIOD_CRON = '0 3 * * *';

/** El nombre de la cola del escalamiento, escrito una sola vez. */
export const ESCALATE_OVERDUE_JOB = 'actions.escalate-overdue' satisfies JobName;

/**
 * El cron del escalamiento: todos los días a las 04:00, hora de Ontario.
 *
 * DIARIO Y NO "AL VENCER", por lo mismo que la apertura es diaria y no mensual: un
 * trabajo programado para el instante del vencimiento se pierde si el servidor está
 * caído ese minuto, y nadie se entera de que la acción crítica de marzo nunca escaló.
 * Diario, la condición es sobre `due_at` y no sobre "lo que pasó ayer", así que la
 * primera corrida que encuentre la base arriba escala todo lo que esté vencido.
 *
 * Una hora después de la apertura, y no a la misma: los dos trabajos corren sobre la
 * misma base con dos conexiones, y separarlos evita que el día 1 de cada mes compitan.
 */
export const ESCALATE_OVERDUE_CRON = '0 4 * * *';

/**
 * Requisitos §1: las dos plantas son de Ontario.
 *
 * El período es una FECHA CIVIL, no un instante, y sin esta zona el cron de las 03:00
 * UTC abriría el período de septiembre el 31 de agosto a las 20:00 hora local. No es
 * una columna de `site` porque sería una columna con un solo valor posible; el día que
 * haya una planta fuera de Ontario, ese change la agrega.
 */
export const SITE_TIME_ZONE = 'America/Toronto';
