import {
  recurrenceReportSchema,
  type RecurrenceGrouping,
  type RecurrenceReport,
} from '@hs/contracts';

import { get } from './request';

/**
 * El cliente de recurrencia (etapa 7).
 *
 * Lo que vuelve se parsea contra el contrato (ver `request.ts`): un modo de agrupación o
 * un campo que el servidor tenga y el cliente no —una migración a medio desplegar— falla
 * donde alguien lo ve, y no como una serie que se renderiza a medias.
 *
 * **ONLINE, y fuera de Dexie y del service worker.** La lista de rutas del router es
 * también la lista de lo que el service worker precachea, y ésta no entra: la recurrencia
 * se mira sentado, no en 48 acres sin cobertura. Guardarla offline además congelaría un
 * cálculo que el servidor rehace con la ventana que se le pida, que es justamente lo que
 * la marca del hallazgo ya hace y esta pantalla no tiene que repetir.
 */
export async function getRecurrence(options: {
  windowMonths: number;
  groupBy: RecurrenceGrouping;
}): Promise<RecurrenceReport> {
  const query = new URLSearchParams({
    window_months: String(options.windowMonths),
    group_by: options.groupBy,
  });

  return get(`/findings/recurrence?${query}`, (value) => recurrenceReportSchema.parse(value));
}
