# Detección de recurrencia

## Why

Doce migraciones y cinco etapas después, el sistema registra hallazgos, los clasifica, los
convierte en acciones correctivas y las escala — y todavía no sabe decir **"la guarda de la
línea 3 falta desde julio"**. Esa frase es, textualmente, la feature más valiosa del sistema
según §5 riesgo A de `docs/Requisitos_V1.2.md`, y es lo único que el recorrido **R5** necesita
que nadie haya construido.

Toda la materia prima está puesta y sin consumir. `finding.item_key` viaja desde la respuesta
negativa (change `findings-and-risk-classification`), la ubicación es una lista cerrada (change
`site-location-catalog`), y **dos índices creados para esta consulta llevan tres migraciones
esperando a su primer lector**: `finding_recurrence_idx` sobre `(site_id, item_key,
location_id)` en 0010 y `inspection_answer_recurrence_idx` en 0009. Sus comentarios dicen
literalmente «la decisión es de la etapa 7». Esta es la etapa 7.

Este change abre la **etapa 7** de §7 y cierra **su primer tercio**: «Recurrencia». Los otros
dos tercios de la etapa —reporte de cumplimiento y exportación a PDF con hash— son changes
aparte; hasta que estén, R5 no está completo y esto queda declarado abajo.

## Lo que este change NO es

**No es el reporte de cumplimiento ni la exportación a PDF.** La etapa 7 tiene tres piezas y
esta es una. El reporte del MLITSD, el hash del PDF y la vista del auditor externo son el
change siguiente. La consecuencia declarada: al terminar este change el coordinador ve qué se
repite y no puede todavía imprimirlo con valor probatorio.

**No es analítica.** Sin gráficos, sin líneas de tendencia, sin proyección y sin predicción. La
salida es una lista ordenada de series con su conteo, su primera y su última ocurrencia. Un
gráfico es una decisión de producto que nadie pidió y que convierte una consulta verificable en
una superficie de interpretación.

**No es el scoring ponderado.** §5 riesgo E lo sacó de v1 y sigue afuera. La severidad de la
clasificación vigente se muestra junto a la serie porque ya existe; no se agrega, no se promedia
y no se convierte en un número por serie.

**No es una alerta ni una notificación.** La marca de recurrente se calcula y se guarda; no
dispara un trabajo de pg-boss, no manda un correo y no abre una acción correctiva. Que un
hallazgo recurrente merezca escalamiento automático es una decisión de producto que no está en
ningún requisito de v1.

## What Changes

- **La clave de recurrencia son dos, no una.** §6-bis pregunta 11 lo cerró: `item_key` +
  `location_id` responde «la guarda de la línea 3 falta desde julio» y dispara arreglar esa
  línea; `item_key` solo responde «faltan guardas en todo el sitio» y dispara un problema
  sistémico. Las dos agrupaciones se exponen como modos de la misma consulta, con
  `item_key` + `location_id` **por defecto**.

- **La ventana temporal es un parámetro, no una constante enterrada.** La consulta acepta una
  ventana en meses (1 a 60, por defecto 12) contada hacia atrás desde hoy sobre `occurred_at`
  —el reloj del dispositivo al firmar, que es el que define el período de cumplimiento por §5
  riesgo C— y no sobre `recorded_at`. Una inspección de octubre que sincronizó en noviembre
  cuenta en octubre, acá también.

- **La marca de recurrente se calcula y se guarda al crear el hallazgo, no al leerlo.** Un
  hallazgo derivado nace sabiendo cuántas veces se repitió lo mismo antes que él, en la misma
  transacción que lo inserta. Es lo que hace que la marca sea un hecho del momento —auditable,
  reproducible, congelado— y no el resultado de volver a correr la consulta con datos de hoy
  sobre un registro de julio.

- **La marca vive en una tabla hermana, `finding_recurrence`, y no en una columna de
  `finding`.** `finding` es íntegramente inmutable y no tiene un solo `GRANT UPDATE`; agregarle
  una columna dejaría a los hallazgos ya existentes con un `NULL` que nadie puede llenar nunca.
  Una fila hermana insertada en la misma transacción da la misma garantía sin tocar la tabla, y
  además puede llevar los parámetros con los que se calculó — cosa que una columna booleana no
  puede.

- **Un hallazgo manual no recibe marca, y eso es la regla y no un hueco.** Sin `item_key` no hay
  serie. §5 riesgo A y el spec de `findings` ya aceptaron esa consecuencia por escrito; acá se
  vuelve visible: la vista declara cuántos hallazgos del período quedaron fuera de toda serie,
  para que "no hay recurrencia" nunca se confunda con "no se miró".

- **La consulta cruza versiones de plantilla por diseño.** Agrupa por `item_key`, que es el
  concepto estable, y nunca por `template_version_item_id`, que es la fila publicada. Es la
  mitad entera del riesgo A: una consulta que agrupara por la fila devolvería series partidas,
  sin error, sin fila roja y sin que nadie lo note.

- **La prueba de aceptación obligatoria del riesgo A entra como test, no como nota.** Tres
  versiones sucesivas con ediciones realistas —v1 crea el ítem y un hallazgo; v2 le cambia la
  redacción, lo mueve de sección y lo reordena, y genera dos; v3 le cambia el tipo de respuesta
  de `yes_no` a `scale` y genera uno— y la aserción es **una serie de 4**. Si devuelve 1 + 2 +
  1, el change no está hecho. §5 riesgo A la exigía «antes de la primera migración» y llega
  tarde; llega igual, y con datos de las cinco etapas ya construidas.

- **`GET /findings/recurrence`**, dentro del alcance de sitios de la sesión y recortado por RLS
  como todo lo demás, con la ventana y el modo de agrupación como parámetros.

- **La vista de hallazgos recurrentes por sitio en `apps/web`**: la lista de series ordenada por
  conteo, cada una con su ítem, su ubicación, su cuenta, su primera y su última ocurrencia y sus
  hallazgos desplegables. Sin gráfico.

## Capabilities

### New Capabilities

- `reporting`: cómo se agrupan los hallazgos en series a lo largo de versiones de plantilla,
  cuáles son las dos claves de recurrencia y qué responde cada una, cómo se acota la ventana
  temporal, qué queda fuera de toda serie y por qué, y qué se guarda en el hallazgo al momento
  de nacer para que la marca sea un hecho y no un cálculo repetido.

### Modified Capabilities

- `findings`: un hallazgo derivado nace con su marca de recurrencia escrita en la misma
  transacción; la lectura de un hallazgo la devuelve. La regla de que un hallazgo manual queda
  fuera de toda serie pasa de consecuencia aceptada a comportamiento observable.
- `immutability`: `finding_recurrence` entra a la lista de tablas que ningún rol —tampoco
  `hs_migrator`— puede modificar ni borrar, y a la de las que llevan política de aislamiento por
  sitio.

## Impact

- **Esquema**: migración `0013_recurrence.sql`. Crea `finding_recurrence` con
  `hs_make_immutable`, `hs_apply_site_isolation`, FK compuesta contra `finding (id, site_id)` y
  único sobre `finding_id`. `GRANT SELECT, INSERT` y nada más. **No altera ninguna tabla
  existente**: los dos índices que la consulta necesita ya existen desde 0009 y 0010. Se agrega
  un tercer índice sobre `finding (site_id, item_key, location_id, occurred_at)` solo si el
  `EXPLAIN` de la tarea de verificación muestra que el de 0010 no alcanza para el filtro de
  ventana — la decisión se toma con el plan a la vista, no de antemano.
- **`packages/contracts`**: `reporting.ts` con el modo de agrupación, la ventana, la forma de la
  serie y la de la marca; `findings.ts` gana `recurrence` en la forma del hallazgo.
- **`apps/api/src/reporting`**: módulo nuevo. La consulta es **SQL crudo** —`GROUP BY` con
  agregados y filtro de ventana— por el motivo que ADR-004 usa para elegir Drizzle: el
  constructor tipado no expresa esto sin pelear, y esta consulta es la que el proyecto existe
  para poder escribir.
- **`apps/api/src/inspections/submissions.service.ts`**: la derivación gana un paso más dentro
  de la misma transacción — insertar la marca de cada hallazgo derivado. Un envío que produce
  hallazgos produce sus marcas o no se comete.
- **`apps/web`**: ruta nueva `RecurrenceRoute`, en el menú del coordinador y del miembro del
  JHSC. Solo lectura y solo online: no entra al service worker ni a Dexie.
- **Consumidor siguiente**: el reporte de cumplimiento de la etapa 7 lee estas series para la
  sección de patrones del documento del MLITSD.
