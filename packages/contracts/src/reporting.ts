import { ITEM_KEY_PATTERN } from '@hs/forms';
import { z } from 'zod';

/**
 * Requisitos §7 etapa 7 — La detección de recurrencia.
 *
 * «La misma guarda falta cuatro meses seguidos» es, según §5 riesgo A, la feature
 * más valiosa del sistema, y es la que este contrato expresa: series de hallazgos
 * agrupadas por el concepto estable del ítem a lo largo de versiones de plantilla.
 *
 * El modo de fallo que hay que tener presente al leer esto es el del riesgo A: una
 * consulta que agrupa mal **no produce ningún error**. Los joins funcionan, las
 * filas vuelven y la pantalla dice que no hay patrón. Por eso el contrato lleva
 * `template_version_item_count` y `excluded_manual_count`: son los dos números con
 * los que un lector puede notar que la agrupación cruzó lo que tenía que cruzar y
 * que la lista vacía significa lo que parece.
 *
 * Lo que estos esquemas NO validan es el alcance: qué sitios ve quien pregunta lo
 * decide la política RLS sobre la transacción, no un campo del request. No hay
 * `site_id` en la consulta y esa ausencia es deliberada.
 */

const itemKeySchema = z
  .string()
  .regex(ITEM_KEY_PATTERN, 'item_key: minúsculas, dígitos y "." o "-" como separadores');

// ---------------------------------------------------------------------------
// Los parámetros

/**
 * Las dos claves de recurrencia de §6-bis pregunta 11. No es indecisión: son dos
 * preguntas distintas y las dos importan.
 *
 *   `item_location`  «la guarda de la línea 3 falta desde julio»  → arreglar esa línea
 *   `item`           «faltan guardas en todo el sitio»            → problema sistémico
 *
 * `item_location` es el modo por defecto porque es el accionable: nombra un lugar
 * al que alguien puede ir. El otro nombra un patrón, que es una conversación.
 */
export const RECURRENCE_GROUPINGS = ['item_location', 'item'] as const;

export const recurrenceGroupingSchema = z.enum(RECURRENCE_GROUPINGS);

export type RecurrenceGrouping = z.infer<typeof recurrenceGroupingSchema>;

export const RECURRENCE_GROUPING_DEFAULT: RecurrenceGrouping = 'item_location';

/**
 * La ventana, en meses hacia atrás desde ahora.
 *
 * El default de 12 es el mismo que usa la marca del hallazgo al nacer
 * (`WINDOW_MONTHS_DEFAULT` se importa de acá, no se redeclara en `apps/api`): si
 * los dos no fueran el mismo número, `prior_count` y `occurrence_count` diferirían
 * por una razón invisible y el diseño D2 se volvería incomprensible.
 *
 * El tope de 60 existe para que el parámetro no sea libre, no porque 61 vaya a
 * romper algo. Se revisa cuando haya volumen.
 */
export const WINDOW_MONTHS_MIN = 1;
export const WINDOW_MONTHS_MAX = 60;
export const WINDOW_MONTHS_DEFAULT = 12;

/**
 * La ventana se mide sobre `occurred_at` —el reloj del dispositivo al firmar, que
 * §5 riesgo C fijó como el reloj de cumplimiento— y nunca sobre `recorded_at`. Una
 * inspección caminada en octubre y sincronizada en noviembre cuenta en octubre, y
 * la recurrencia no puede contradecir al reporte de cumplimiento sobre eso.
 *
 * `z.coerce` porque esto llega de un query string, donde todo es cadena.
 */
export const recurrenceQuerySchema = z.strictObject({
  window_months: z.coerce
    .number()
    .int()
    .min(WINDOW_MONTHS_MIN)
    .max(WINDOW_MONTHS_MAX)
    .default(WINDOW_MONTHS_DEFAULT),
  group_by: recurrenceGroupingSchema.default(RECURRENCE_GROUPING_DEFAULT),
});

export type RecurrenceQuery = z.infer<typeof recurrenceQuerySchema>;

// ---------------------------------------------------------------------------
// Lo que se lee

/**
 * Una serie: el mismo concepto fallando más de una vez dentro de la ventana.
 *
 * **Dos ocurrencias es el mínimo.** Una sola no es un patrón, y devolverla
 * convertiría la vista en el listado de hallazgos que ya existe.
 *
 * `template_version_item_count` es el número que hace auditable el riesgo A: una
 * serie que cruzó tres versiones de plantilla lo dice, y si todas las series de un
 * sitio con años de ediciones dijeran `1`, la agrupación estaría partida por la
 * fila publicada en vez de por el concepto —que es exactamente el fallo silencioso
 * que el riesgo describe.
 */
export const recurrenceSeriesSchema = z.strictObject({
  site_id: z.uuid(),
  item_key: itemKeySchema,

  /**
   * La redacción de la versión más reciente en que se contestó el ítem (design
   * D9). La histórica de cada hallazgo sigue siendo resoluble por su
   * `template_version_item_id`: la serie muestra el concepto, el hallazgo muestra
   * lo que se preguntó ese día.
   */
  item_prompt: z.string(),

  /** `null` en modo `item`, donde la serie no es de ningún lugar en particular. */
  location_id: z.uuid().nullable(),

  /** Cuántas ubicaciones distintas abarca. En modo `item_location` es siempre 1. */
  location_count: z.number().int().min(1),

  occurrence_count: z.number().int().min(2),

  /** Cuántas versiones distintas del ítem cruzó la serie. */
  template_version_item_count: z.number().int().min(1),

  first_occurred_at: z.iso.datetime({ offset: true }),
  last_occurred_at: z.iso.datetime({ offset: true }),

  /** Los hallazgos de la serie, del más reciente al más viejo. */
  finding_ids: z.array(z.uuid()).min(2),
});

export type RecurrenceSeries = z.infer<typeof recurrenceSeriesSchema>;

/**
 * El reporte completo, con los parámetros que lo produjeron.
 *
 * **`excluded_manual_count` viaja siempre, también cuando es cero.** Un hallazgo
 * manual no tiene `item_key` y queda fuera de toda serie; §5 riesgo A y §6-bis
 * pregunta 11 aceptaron esa consecuencia por escrito, y este número es lo que
 * impide que la aceptación se vuelva un punto ciego: sin él, una lista de series
 * vacía se lee como «no hay patrones» cuando puede significar «no hay datos con
 * los que buscarlos» (design D8).
 *
 * Los dos parámetros vuelven en la respuesta porque el default lo pone el servidor:
 * el cliente que no mandó ninguno tiene que poder mostrar con cuáles se calculó.
 */
export const recurrenceReportSchema = z.strictObject({
  window_months: z.number().int().min(WINDOW_MONTHS_MIN).max(WINDOW_MONTHS_MAX),
  group_by: recurrenceGroupingSchema,
  excluded_manual_count: z.number().int().min(0),
  series: z.array(recurrenceSeriesSchema),
});

export type RecurrenceReport = z.infer<typeof recurrenceReportSchema>;
