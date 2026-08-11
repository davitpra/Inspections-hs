-- Requisitos §5 riesgo A, §6-bis pregunta 11 y §7 etapa 7 — LA MARCA DE RECURRENCIA.
--
-- «La misma guarda falta cuatro meses seguidos» es, según §5 riesgo A, la feature más
-- valiosa del sistema. 0009 y 0010 dejaron puesta toda la materia prima —`item_key` en
-- la respuesta y en el hallazgo, la ubicación como lista cerrada, y dos índices creados
-- para esta consulta cuyos comentarios dicen «la decisión es de la etapa 7»—. Esta es la
-- etapa 7, y esta migración crea lo único que faltaba: dónde vive lo que el hallazgo
-- sabía de su propia historia cuando nació.
--
-- LO QUE ESTA MIGRACIÓN NO CREA, y es la mitad del change: **la consulta de recurrencia
-- no es una tabla**. Las series se calculan leyendo `finding` con un GROUP BY, en el
-- momento en que alguien pregunta y con la ventana que pidió. No hay vista
-- materializada, no hay tabla de agregados y no hay job que las mantenga. Con 2 sitios y
-- periodicidad mensual, la consulta directa es correcta por definición y una copia no lo
-- es.
--
-- LAS PROPIEDADES QUE ESTA MIGRACIÓN DEFIENDE, cada una con su barrera:
--
--   Un hallazgo manual NO puede tener marca                       FK compuesta + NOT NULL (§2)
--   La marca es del mismo sitio que su hallazgo                   FK compuesta (§2)
--   Un hallazgo no puede tener dos marcas                         UNIQUE (finding_id) (§2)
--   `is_recurrent` lo calcula el motor                            columna generada (§2)
--   Un conteo no puede ser negativo                               CHECK de dominio (§2)
--   Sin previos no hay fecha del primer previo, y viceversa       CHECK de coherencia (§2)
--   La ventana declarada está dentro del rango del contrato       CHECK de dominio (§2)
--   Nadie modifica ni borra ninguna marca                         hs_make_immutable (§3)
--   Nadie ve las marcas de la otra planta                         hs_apply_site_isolation (§3)
--
-- SÍ ALTERA UNA TABLA INMUTABLE, y conviene que quede escrito porque 0010 se preciaba de
-- no alterar nada anterior. Acá `finding` gana **un único sobre (id, item_key)**, que es
-- el destino de la FK compuesta de §2. Es DDL del rol dueño sobre una tabla inmutable,
-- permitido por el mismo motivo que 0012 lo hizo sobre `corrective_action`: LA
-- INMUTABILIDAD ES SOBRE LAS FILAS, NO SOBRE EL ESQUEMA. No agrega ninguna columna, no
-- reescribe ninguna fila —un UNIQUE construye un índice, no toca los datos—, no relaja
-- ninguna barrera existente y no agrega ni un GRANT.
--
-- POR QUÉ ESE ÚNICO Y NO UN TRIGGER: sin él, impedir una marca sobre un hallazgo manual
-- exigiría una función que lea `finding` y compruebe que `item_key` no es nula. Con él,
-- `item_key NOT NULL` en la marca más la FK compuesta lo hacen imposible de forma
-- declarativa, y el motor lo verifica en cada INSERT sin que nadie escriba código. La
-- misma preferencia que el resto del esquema: barrera declarativa antes que guarda
-- imperativa.
--
-- SIN BACKFILL, Y ES UNA DECISIÓN. Los hallazgos anteriores a esta migración no tienen
-- marca y no la van a tener nunca: su valor dependía del estado del momento en que
-- nacieron, que ya pasó. Inventarlo ahora con los datos de hoy sería escribir en una
-- tabla inmutable un número que nunca fue verdad. El reporte de recurrencia los incluye
-- igual, porque se construye desde `finding` y no desde las marcas.
--
-- Escrita a mano, como todas. `drizzle-kit generate` está prohibido: regeneraría el
-- `.sql` a partir del espejo de TypeScript y se llevaría puesto el mecanismo (ADR-004).

-- ---------------------------------------------------------------------------
-- 1. El único que `finding` le debía a la etapa 7.
--
-- Destino de la FK compuesta de `finding_recurrence`. `finding.item_key` es NULLABLE —un
-- hallazgo manual no la tiene—, y un UNIQUE de Postgres no impide varias filas con NULL;
-- no hace falta que lo impida, porque `id` ya es la clave primaria. Lo único que este
-- índice tiene que hacer es ser un destino de FK válido, y para eso alcanza.
ALTER TABLE finding
  ADD CONSTRAINT finding_id_item_key_uq UNIQUE (id, item_key);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. La marca: qué sabía este hallazgo de su propia historia al nacer.
--
-- UNA FILA HERMANA Y NO COLUMNAS EN `finding`, y es la decisión de diseño central de
-- este change (D1). Agregarle `prior_count` a `finding` dejaría a todo hallazgo anterior
-- a esta migración con un NULL permanente que ningún backfill puede llenar, y ese NULL
-- sería indistinguible de "no aplica" para siempre. Una fila hermana ausente dice
-- exactamente lo mismo sin mentir sobre la forma de la tabla: la marca existe desde que
-- existe el mecanismo, y antes no existía.
--
-- SE ESCRIBE DENTRO DE LA TRANSACCIÓN DE INGESTA, junto al hallazgo que describe. No hay
-- job posterior, no hay cola y no hay "eventualmente": un envío que produce hallazgos
-- produce sus marcas o no se comete.
--
-- NO SE RECALCULA NUNCA. Cuando el quinto hallazgo de la serie llega, la marca del
-- cuarto sigue diciendo 3, porque eso es lo que era verdad ese día. La serie que la
-- vista muestra se calcula aparte, al leer, con la ventana que el lector pidió — por eso
-- `prior_count` y `occurrence_count` pueden no coincidir, y por eso esta tabla guarda
-- `window_months`: sin él, la diferencia sería inexplicable.
CREATE TABLE finding_recurrence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  finding_id uuid NOT NULL REFERENCES finding (id),

  -- Denormalizado: la política RLS necesita el sitio en la fila. La FK compuesta de
  -- abajo impide que diga algo distinto del sitio de su hallazgo.
  site_id uuid NOT NULL REFERENCES site (id),

  -- NOT NULL, y es lo que hace imposible una marca sobre un hallazgo manual: la FK
  -- compuesta contra `finding (id, item_key)` no encuentra destino cuando la del
  -- hallazgo es NULL. La regla de §5 riesgo A —sin concepto estable no hay serie— queda
  -- en el motor y no en una comprobación del servicio.
  item_key text NOT NULL,

  -- Copiada del hallazgo por la misma razón que `site_id`, y porque `prior_count` no se
  -- entiende sin saber respecto de qué ubicación se contó.
  location_id uuid NOT NULL REFERENCES location (id),

  -- Con qué ventana se contaron los dos números de abajo. Es el campo que hace legible
  -- la diferencia entre esta marca y cualquier reporte que la contradiga.
  window_months integer NOT NULL,

  -- Cuántos hallazgos previos de la misma `item_key` Y la misma ubicación: la pregunta
  -- accionable de §6-bis pregunta 11, la que nombra un lugar al que alguien puede ir.
  prior_count integer NOT NULL,

  -- Los de la misma `item_key` en cualquier ubicación del sitio: la pregunta sistémica.
  prior_count_site_wide integer NOT NULL,

  -- El `occurred_at` del más viejo de los previos. NULL cuando no hubo ninguno, que es
  -- la única forma en que puede ser NULL.
  first_prior_occurred_at timestamptz,

  computed_at timestamptz NOT NULL DEFAULT now(),

  -- CALCULADA POR EL MOTOR, igual que `finding_risk_assessment.risk_level` y que
  -- `scheduled_inspection.period_end`. Se lee, no se escribe: no está en
  -- `NewFindingRecurrence` y no hay camino por el que alguien la ponga en desacuerdo con
  -- `prior_count`. Un booleano de "es recurrente" mantenido a mano es exactamente el
  -- tipo de dato que un día dice que sí sobre un conteo de cero.
  is_recurrent boolean NOT NULL GENERATED ALWAYS AS (prior_count > 0) STORED,

  -- Una marca por hallazgo. Es también lo que hace que reintentar la ingesta no pueda
  -- duplicarlas: el único falla antes de que exista la segunda.
  CONSTRAINT finding_recurrence_finding_uq UNIQUE (finding_id),

  -- El sitio de la marca es el de su hallazgo. Sin esto, la columna denormalizada que la
  -- política RLS lee podría decir una cosa mientras la fila que describe dice otra.
  CONSTRAINT finding_recurrence_finding_site_fk
    FOREIGN KEY (finding_id, site_id) REFERENCES finding (id, site_id),

  -- LA BARRERA DEL HALLAZGO MANUAL. Junto con `item_key NOT NULL` de arriba: un hallazgo
  -- cuya `item_key` es NULL no tiene con qué satisfacer esta FK, así que su marca no
  -- llega a existir. Y una marca no puede reclamar una `item_key` que no es la de su
  -- hallazgo, que es la misma garantía que 0010 le da al hallazgo respecto de su ítem.
  CONSTRAINT finding_recurrence_finding_item_fk
    FOREIGN KEY (finding_id, item_key) REFERENCES finding (id, item_key),

  CONSTRAINT finding_recurrence_counts_check CHECK (
    prior_count >= 0
    AND prior_count_site_wide >= 0
    -- Los de la misma ubicación son un subconjunto de los del sitio. Si esto se viola,
    -- la consulta que los calcula tiene los filtros cruzados.
    AND prior_count <= prior_count_site_wide
  ),

  -- Las dos mitades de un mismo hecho. "Hubo previos pero no sé desde cuándo" y "no hubo
  -- previos pero acá está la fecha del primero" son las dos incoherentes.
  CONSTRAINT finding_recurrence_first_prior_check CHECK (
    (prior_count = 0) = (first_prior_occurred_at IS NULL)
  ),

  -- El mismo rango que `recurrenceQuerySchema` en `@hs/contracts`. El contrato lo
  -- rechaza antes para devolver un error legible; esto lo rechaza igual por cualquier
  -- otro camino, incluido un INSERT directo.
  CONSTRAINT finding_recurrence_window_check CHECK (window_months BETWEEN 1 AND 60)
);

--> statement-breakpoint

-- El índice del listado de hallazgos: `FINDING_SELECT` llega a la marca por `finding_id`
-- en un LEFT JOIN. El UNIQUE de arriba ya crea el índice, así que no hace falta ninguno
-- más — queda escrito para que nadie agregue el duplicado.

-- ---------------------------------------------------------------------------
-- 2-bis. EL ÍNDICE QUE NO SE AGREGA, Y POR QUÉ. (tarea 8.2 del change)
--
-- La duda era legítima: `finding_recurrence_idx` de 0010 es `(site_id, item_key,
-- location_id)` y NO lleva `occurred_at`, así que el filtro de ventana no puede
-- resolverse por índice. El plan diría si hacía falta uno nuevo. Se sembró volumen
-- realista —5 años × 2 sitios × 12 hallazgos derivados por mes, 1560 filas en `finding`,
-- 1440 de ellas derivadas, cuatro versiones de plantilla— y se corrió `EXPLAIN (ANALYZE,
-- BUFFERS)` sobre las dos agrupaciones. Esto es lo que devolvió:
--
--   SERIES item_location 12m   Index Scan using finding_recurrence_idx   4.9 ms
--   SERIES item 12m            Index Scan using finding_recurrence_idx   6.6 ms
--   SERIES item_location 60m   Index Scan using finding_recurrence_idx   8.6 ms
--
-- DOS COSAS QUE EL PLAN DEJÓ CLARAS:
--
--   1. El índice de 0010 SÍ se usa. La ventana se aplica como `Filter` sobre el índice
--      —«Rows Removed by Filter: 1176» a 12 meses— y descartar 1176 filas ya traídas
--      cuesta menos de 5 ms. Con 2 plantas y periodicidad mensual, el peor caso a cinco
--      años son ~1400 filas: no hay nada que optimizar todavía.
--
--   2. Un índice nuevo por `occurred_at` podría EMPEORARLO. El plan aprovecha el orden
--      del índice de 0010 para un `Incremental Sort` con «Presorted Key: site_id,
--      item_key, location_id», que es exactamente el `GROUP BY` de la consulta. Un
--      índice ordenado por `occurred_at` haría el filtro más barato y el agrupamiento
--      más caro, y el agrupamiento es el trabajo real.
--
-- POR ESO NO SE AGREGA NINGÚN ÍNDICE ACÁ. Queda escrito con el plan al lado para que la
-- próxima persona que se haga la misma pregunta la encuentre contestada, y para que
-- sepa cuál es la medición que habría que rehacer si el volumen cambiara de orden.

-- ---------------------------------------------------------------------------
-- 3. Inmutabilidad y aislamiento.
--
-- Registrar que un peligro ya se había repetido tres veces es una afirmación fechada. Si
-- se puede editar después, no prueba nada — y es exactamente el dato que un inspector
-- del MLITSD pediría para saber si el empleador sabía.
SELECT hs_make_immutable('finding_recurrence');

--> statement-breakpoint

SELECT hs_apply_site_isolation('finding_recurrence');

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Los privilegios de hs_app.
--
-- SELECT e INSERT, y se acaba la lista. NO HAY UN SOLO `GRANT UPDATE` EN ESTA MIGRACIÓN,
-- Y ESA AUSENCIA ES EL REQUISITO — igual que en 0009, 0010, 0011 y 0012.
--
-- Acá la tentación tiene una forma propia y conviene nombrarla: "actualizar las marcas
-- cuando llega un hallazgo nuevo", para que la serie esté siempre al día. No. Eso es
-- confundir la marca con la serie. La serie se calcula al leer y siempre está al día por
-- construcción; la marca dice qué se sabía ese día y tiene que seguir diciéndolo.
GRANT SELECT, INSERT ON finding_recurrence TO hs_app;
