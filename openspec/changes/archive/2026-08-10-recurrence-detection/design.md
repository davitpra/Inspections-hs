# Diseño — Detección de recurrencia

## Context

Ver `proposal.md` — Why. Lo que importa acá es qué está ya construido y condiciona la forma:

- **Los dos índices ya existen y nunca se usaron.** `finding_recurrence_idx` sobre `(site_id,
  item_key, location_id)`, parcial `WHERE item_key IS NOT NULL` (0010), y
  `inspection_answer_recurrence_idx` sobre `(site_id, item_key)` (0009). Sus comentarios en el
  espejo Drizzle dicen que la decisión de cuál clave usar es de la etapa 7.
- **`item_key` ya llega intacto al hallazgo.** La FK compuesta contra `template_version_item (id,
  item_key)` garantiza que la key del hallazgo es la del ítem publicado que se contestó, y el
  `CHECK` de origen garantiza que un hallazgo derivado la tiene y uno manual no. La materia prima
  del riesgo A está verificada por el motor desde 0010.
- **El punto de enganche de la marca es el mismo de la derivación.** `submissions.service.ts`
  llama a la derivación de `findings` dentro de `withSessionClient`. La marca se escribe ahí, con
  el mismo cliente, en la misma transacción — no hay hook nuevo que inventar.
- **`finding` ya expone `finding_id_site_uq (id, site_id)`**, destino de la FK compuesta que
  necesita `finding_recurrence`. Falta un solo destino nuevo: un único sobre `(id, item_key)`.
- **`finding.occurred_at` es el reloj del dispositivo al firmar** y `recorded_at` el del servidor.
  §5 riesgo C fijó el primero como el reloj de cumplimiento; la ventana se mide sobre él.
- **El mecanismo está construido**: `hs_make_immutable`, `hs_apply_site_isolation`,
  `withSessionScope`. Este change los usa; no inventa mecanismo.

**Tablas inmutables que este change toca:** crea una nueva, `finding_recurrence`, con
`hs_make_immutable` y `hs_apply_site_isolation`. **Toca una tabla inmutable existente con un solo
`ALTER`**: `finding` gana el único `finding_id_item_key_uq (id, item_key)`. Es una restricción,
no una columna ni un dato: no reescribe ninguna fila, no relaja ninguna barrera y no agrega ningún
`GRANT`. Queda declarado acá porque la migración 0010 se preciaba de no alterar nada anterior y
esta rompe esa racha a propósito. La alternativa —una FK simple contra `finding (id)` más un
trigger que compruebe que la key no es nula— cambia una restricción declarativa por código.

ADRs aplicables: **ADR-002** (inmutabilidad por motor), **ADR-004** (SQL crudo para exactamente
esta consulta, RLS por política), **ADR-008** (dirección de dependencias entre módulos).

## Goals / Non-Goals

**Goals:**

- Que la prueba de aceptación del riesgo A —v1 → v2 → v3 con ediciones realistas, aserción «una
  serie de 4»— corra en CI sobre datos construidos por el camino real de ingesta, y no sobre
  filas insertadas a mano.
- Que las dos claves de recurrencia sean el mismo `SQL` con un `GROUP BY` distinto, para que no
  puedan divergir en criterio de ventana, de exclusión o de orden.
- Que la marca del hallazgo sea imposible de omitir: si no se escribe, el envío no se comete.
- Que la consulta use los índices que ya existen, verificado con `EXPLAIN` y no por confianza.

**Non-Goals:**

- Reporte de cumplimiento, PDF con hash, vista del auditor externo (resto de la etapa 7).
- Materializar las series en una tabla o una vista materializada. Con 2 sitios y decenas de
  hallazgos por mes, la consulta directa es correcta por definición y una copia no lo es.
- Un umbral de recurrencia configurable por ítem o por sitio. Dos es dos.
- Traer los hallazgos manuales a la recurrencia por semejanza de texto o de ubicación. Es una
  heurística que produce series falsas, que es el modo de fallo exacto que §5 riesgo A describe.

## Decisions

### D1 — La marca vive en una tabla hermana, no en una columna de `finding`

`finding_recurrence` es una fila por hallazgo derivado, con `UNIQUE (finding_id)`, insertada en la
misma transacción que el hallazgo.

**Alternativa descartada: columnas en `finding`.** `finding` no tiene un solo `GRANT UPDATE` y sus
filas no se reescriben nunca. Agregar `prior_count` dejaría a todo hallazgo anterior a esta
migración con un `NULL` permanente que ningún backfill puede llenar —el cálculo depende del estado
del momento, que ya pasó— y ese `NULL` sería indistinguible de "no aplica" para siempre. Una fila
hermana ausente dice exactamente lo mismo sin mentir sobre la forma de la tabla: la marca existe
desde que existe el mecanismo.

**Alternativa descartada: un `finding_event` genérico.** El estado de la acción correctiva se
deriva de eventos porque avanza; la marca de recurrencia se calcula una vez y no avanza nunca. Un
stream de eventos para un hecho único es ceremonia.

### D2 — La marca se calcula al insertar, la serie se calcula al leer, y son dos cosas distintas

La marca responde «¿cuántas veces había pasado esto **cuando este hallazgo nació**?». La serie
responde «¿qué se repite **en la ventana que estoy mirando**?». La segunda no se construye leyendo
`prior_count`: si lo hiciera, un reporte a 24 meses quedaría limitado por marcas calculadas a 12.

Consecuencia aceptada y escrita en el spec: **los dos números pueden no coincidir**, y eso es
correcto. `window_months` se guarda en la marca justamente para que el que la lee sepa con qué
ventana se calculó.

### D3 — La ventana se mide sobre `occurred_at` y se corta en el servidor, no en el cliente

`occurred_at >= now() - make_interval(months => $window)`. Sobre `occurred_at` porque es el reloj
de cumplimiento (§5 riesgo C): una inspección caminada en octubre y sincronizada en noviembre
cuenta en octubre, y la recurrencia no puede contradecir al reporte de cumplimiento sobre qué mes
es cada hallazgo.

`now()` y no una fecha del cliente: la ventana es «los últimos N meses», no un rango arbitrario.
Un `from`/`to` libre sería un reporte histórico, que es la etapa 7 siguiente y tiene otro
consumidor.

### D4 — Una consulta, dos `GROUP BY`, elegidos por parámetro y no por dos funciones

El `SQL` es uno solo, con la expresión de agrupación de la ubicación conmutada:

```sql
GROUP BY f.site_id, f.item_key,
         CASE WHEN $mode = 'item_location' THEN f.location_id END
```

**Alternativa descartada: dos consultas.** Divergirían. La ventana, la exclusión de los manuales,
el umbral de dos y el orden son idénticos en los dos modos; escribirlos dos veces es garantizar
que un día uno de los dos tenga el criterio viejo. El `CASE` colapsa a `NULL` en modo `item`, que
es exactamente lo que el spec pide devolver en `location_id`.

El modo se interpola desde un enum de Zod, nunca desde la cadena cruda: el único valor que llega a
`$mode` es uno de dos literales validados.

### D5 — `is_recurrent` es columna generada, como `risk_level`

`GENERATED ALWAYS AS (prior_count > 0) STORED`. Mismo criterio que `finding_risk_assessment.
risk_level` y `scheduled_inspection.period_end`: si el valor se deriva de otras columnas de la
misma fila, lo deriva el motor y no hay un camino por el que alguien lo escriba mal. No aparece en
`NewFindingRecurrence`.

### D6 — El conteo de la marca es una sola consulta con dos agregados condicionales

Una pasada sobre `finding`, filtrada por `item_key` y ventana, con
`count(*) FILTER (WHERE location_id = $loc)` para `prior_count` y `count(*)` para
`prior_count_site_wide`. Dos consultas serían dos recorridos del mismo índice para la misma fila.

«Anterior» es `occurred_at <` el del hallazgo que nace, con desempate por `recorded_at` — dos
hallazgos del mismo instante no pueden contarse mutuamente como previos.

**Sin `WHERE site_id`**: la política RLS ya recortó la transacción. El conteo mira solo el sitio de
la sesión porque el motor no le muestra otra cosa, que es lo que hace verdadero el escenario «el
conteo no ve la otra planta».

### D7 — La derivación escribe las marcas en lote, no una por hallazgo

Un envío con 8 respuestas negativas produce 8 hallazgos y 8 marcas. Las marcas se calculan con un
solo `INSERT ... SELECT` sobre las filas recién insertadas, agregando contra `finding` con un
`LEFT JOIN LATERAL` por hallazgo. Ocho viajes a la base dentro de una transacción abierta por un
dispositivo con señal intermitente es el tipo de latencia que ADR-001 evita.

**Los hallazgos del mismo envío no se cuentan entre sí.** El `SELECT` excluye a los del propio
`inspection_id`: dos guardas faltantes encontradas en la misma caminata son un hallazgo cada una,
no una recurrencia de la otra.

### D8 — «No hay marca» y «la marca dice false» son estados distintos, y el contrato los separa

`Finding.recurrence` es `null` para un hallazgo manual y un objeto con `is_recurrent: false` para
el primer hallazgo derivado de una serie. Colapsar los dos a `false` diría que el hallazgo manual
fue comparado con la historia y no lo fue — es el punto ciego que §6-bis pregunta 11 dejó escrito,
y el contrato tiene que dejarlo visible en vez de taparlo.

Por eso también `excluded_manual_count` viaja en la respuesta del reporte: una lista de series
vacía sin ese número se lee como «no hay patrones» cuando puede significar «no hay datos con los
que buscarlos».

### D9 — El prompt de la serie es el de la versión más reciente, y se marca como tal

Una serie que cruza tres versiones tiene tres redacciones del mismo ítem. Se muestra la de la
versión más reciente en que se contestó, resuelta por `DISTINCT ON (item_key) ... ORDER BY
template_version.version DESC`. La redacción histórica de cada hallazgo sigue siendo resoluble por
su `template_version_item_id`, que es para lo que existe la identidad dual: la serie muestra el
concepto, el hallazgo muestra lo que se preguntó.

### D10 — El módulo `reporting` lee `finding` directamente y no llama a `findings`

Consulta de agregación sobre tablas, no composición de servicios. `FindingsService` devuelve
hallazgos completos con fotos y clasificación vigente; construir series a partir de eso sería
traer todo a Node para contarlo. La dirección que ADR-008 sostiene se mantiene: `reporting` no es
llamado por nadie de las etapas anteriores.

La única excepción es la marca, que la escribe la derivación de `findings` — porque es parte de la
transacción de ingesta, no del reporte. `findings` no importa `reporting`: la función de cálculo
de la marca vive en `findings`.

## Risks / Trade-offs

- **[La consulta agrupa mal y no falla]** — es el modo de fallo del riesgo A entero: los joins
  funcionan, las filas vuelven y la pantalla dice que no hay patrón. → El test de las tres
  versiones es obligatorio y bloqueante, construye los datos por el endpoint real de ingesta y
  asierta el número exacto `4`. Además, un test que asierta que ningún camino agrupa por
  `template_version_item_id`.
- **[El `EXPLAIN` no usa el índice de 0010]** — `finding_recurrence_idx` no lleva `occurred_at`, y
  el filtro de ventana puede forzar un recorrido más caro del esperado. → Tarea explícita de
  verificar el plan con volumen sembrado; el índice adicional se agrega **solo si el plan lo
  muestra**, y la decisión queda escrita en la migración con el plan como justificación.
- **[La marca vuelve más lenta la ingesta]** — el envío es el punto de no retorno y ahora hace un
  agregado más antes de cometer. → Un solo `INSERT ... SELECT` por envío (D7), apoyado en el
  índice parcial. Se mide en el test de ingesta con 40 respuestas.
- **[Dos números que no coinciden confunden]** — `prior_count` `3` en un hallazgo y una serie de
  `6` en la vista, para lo mismo. → D2, y `window_months` guardado en la marca; la vista muestra
  la ventana en uso y la marca la suya. Se documenta en el contrato, no se esconde.
- **[El punto ciego de los hallazgos manuales]** — la recurrencia real puede estar en los
  manuales y el sistema no la ve. → No se resuelve, se declara: `excluded_manual_count` en cada
  respuesta y en la vista. §5 riesgo A y §6-bis pregunta 11 ya lo aceptaron por escrito; lo nuevo
  es que ahora se ve en pantalla.
- **[Ventana de 60 meses sobre un sitio con años de datos]** — el tope existe para que el
  parámetro no sea libre. → Con 2 sitios y periodicidad mensual, 60 meses son cientos de filas,
  no millones. El tope se revisa cuando haya volumen, no antes.

## Migration Plan

1. `0013_recurrence.sql`, en una sola transacción:
   - `ALTER TABLE finding ADD CONSTRAINT finding_id_item_key_uq UNIQUE (id, item_key)` — destino
     de FK, sin `GRANT` nuevo y sin reescritura de filas.
   - `CREATE TABLE finding_recurrence` con la FK compuesta contra `finding (id, site_id)`, la FK
     compuesta contra `finding (id, item_key)` con `item_key NOT NULL` —que es lo que impide una
     marca sobre un hallazgo manual—, `UNIQUE (finding_id)`, los `CHECK` de no-negatividad y
     `is_recurrent` generada.
   - `SELECT hs_make_immutable('finding_recurrence');`
   - `SELECT hs_apply_site_isolation('finding_recurrence');`
   - `GRANT SELECT, INSERT ON finding_recurrence TO hs_app;` y nada más.
2. **Sin backfill.** Los hallazgos anteriores a esta migración no tienen marca y no la van a
   tener: su valor dependía del estado del momento, que ya pasó (D1). El reporte de recurrencia
   los incluye igual, porque se construye desde `finding` y no desde las marcas (D2). El único
   efecto observable es que la ficha de un hallazgo viejo muestra su recurrencia como ausente.
3. Rollback: `DROP TABLE finding_recurrence` y `DROP CONSTRAINT finding_id_item_key_uq`. No hay
   dato de otra tabla que dependa de ellos, y el reporte sigue funcionando sin marcas.
4. Orden de despliegue: migración, luego API, luego cliente. La ruta del cliente lee un endpoint
   que ya existe cuando llega; el endpoint lee una tabla que ya existe cuando llega.
