/**
 * «La versión publicada más alta de una plantilla», escrita UNA vez.
 *
 * Tres lugares necesitan esta misma regla y hasta ahora la tenían cada uno por su lado:
 *
 *   - `open-period.service.ts` la usa para CONGELAR la versión al abrir el período.
 *   - `requirePublishedTemplate` la usa para congelarla al programar fuera de calendario,
 *     y para rechazar una regla sobre una plantilla sin nada publicable.
 *   - el listado de plantillas la usa para DECIR cuál se va a congelar.
 *
 * Que el tercero discrepe de los dos primeros es un fallo silencioso y feo: la pantalla
 * ofrece «versión 2», el coordinador crea la regla, y la inspección abre contra la 3. No
 * falla nada, no se entera nadie, y lo que queda escrito en `scheduled_inspection` no es
 * lo que la persona eligió. Por eso la expresión es una sola y no tres copias parecidas.
 *
 * Es un CTE y no una función porque los tres consumidores la componen distinto: uno
 * inserta a partir de ella para todas las plantillas de una vez, otro pregunta por una
 * sola, el tercero la lista entera. `DISTINCT ON` resuelve los tres casos con un índice
 * y sin subconsulta correlacionada.
 *
 * NO filtra por «publicada»: en este modelo toda fila de `template_version` está
 * publicada por construcción —se inserta congelada y no hay estado borrador—, así que un
 * `WHERE published` sugeriría un estado que no existe.
 */
export const LATEST_PUBLISHED_VERSION_CTE = `
  SELECT DISTINCT ON (tv.template_id)
         tv.template_id,
         tv.id      AS version_id,
         tv.version AS version
    FROM template_version tv
   ORDER BY tv.template_id, tv.version DESC`;
