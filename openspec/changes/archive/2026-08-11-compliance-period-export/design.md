# Diseño — Reporte de cumplimiento por período, con exportación a PDF hasheada

## Context

Ver `proposal.md` — Why, y `specs/` para los requisitos. Lo que importa acá es qué está
construido y condiciona la forma:

- **La cobertura no se puede leer de `scheduled_inspection` sola.** Una fila por período existe
  solo si el trabajo de apertura corrió ese mes. `schedule_rule` es lo que declara qué debe un
  sitio (change `inspection-scheduling`), y es la única fuente que sabe que abril existía aunque
  abril no tenga fila.
- **El período cumplido ya está determinado por el motor**: `inspection` tiene único sobre
  `scheduled_inspection_id`, así que «cumplido» es la existencia de esa fila y no un estado que
  alguien setea. `period_end` es columna generada desde `period_start` (0008).
- **El reloj de cumplimiento es `occurred_at`**, el del dispositivo al firmar, fijado por §5
  riesgo C y ya usado por la ventana de recurrencia. El borde `open`/`missed` se mide sobre
  `period_end` en `America/Toronto`, el mismo calendario en el que el trabajo de apertura resuelve
  el período corriente.
- **La recurrencia ya está construida y sin consumidor externo**: `ReportingService.recurrence`
  y `recurrence.sql.ts` (change `recurrence-detection`). El payload del reporte la llama; no la
  reimplementa.
- **El almacenamiento de objetos solo sabe firmar PUT.** `ObjectStorageService` expone tres
  `presign*Put` y nada más; la credencial no lleva `DeleteObject` a propósito (ADR-006). Este
  change necesita dos verbos que no existen: escribir desde el servidor y firmar una lectura.
- **La auditoría de todo lo consecuente se escribe por trigger**, no desde el servicio: es lo que
  hace que una fila insertada por fuera del endpoint entre igual a la cadena.
- **El mecanismo está construido**: `hs_make_immutable`, `hs_apply_site_isolation`,
  `withSessionScope`, `JobPayloads` tipado. Este change los usa; no inventa mecanismo.

**Tablas inmutables que este change toca:** crea dos nuevas, `compliance_report` y
`compliance_report_render`, ambas con `hs_make_immutable` y `hs_apply_site_isolation`. **No altera
ninguna tabla existente**: ni columna, ni restricción, ni `GRANT`. La única superficie que cambia
fuera del esquema es la credencial del bucket, que gana `PutObject` y `GetObject` y sigue sin
`DeleteObject`.

ADRs aplicables: **ADR-002** (inmutabilidad por motor; y la decisión de hashear el payload y no el
PDF, que este change implementa), **ADR-006** (bucket con versioning, PDF con Playwright en el
servidor), **ADR-008** (la API no puede ir a serverless por Chromium; dirección de dependencias
entre módulos), **ADR-005** (pg-boss para el trabajo de render), **ADR-004** (SQL crudo para la
consulta de cobertura, RLS por política).

## Goals / Non-Goals

**Goals:**

- Que el digest de un reporte de julio se pueda recomputar en 2031, con código que no sea el
  nuestro, a partir del payload guardado y de un estándar público.
- Que un fallo de Chromium no pueda perder un reporte ni cambiar su digest.
- Que `required_count` sea la cantidad de períodos que el sitio debía, y no la cantidad de filas
  que el planificador alcanzó a crear.
- Que la generación de un documento regulatorio sea imposible de hacer sin dejar la entrada en la
  cadena, igual que todo lo demás: por trigger y no por llamada del servicio.

**Non-Goals:**

- Verificar un digest desde la aplicación. La verificación es del lector: se publica el payload y
  el algoritmo, y con eso cualquiera recomputa. Un botón «verificar» dentro del sistema que
  produjo el documento no prueba nada que el sistema no se esté afirmando a sí mismo.
- Firmar criptográficamente el PDF (PAdES, certificado, sello de tiempo). Es otra pieza, con
  gestión de claves propia, que R5 no pide y que la cadena de auditoría de ADR-002 ya cubre en lo
  que importa: detectar manipulación.
- Materializar la cobertura en una tabla o vista. Con 2 sitios y 24 períodos al año la consulta
  directa es correcta por definición.
- Un editor de plantillas de reporte, un reporte multi-sitio en un solo documento, o programar la
  generación por cron. Un reporte lo pide una persona, para un sitio, cuando lo necesita.

## Decisions

### D1 — El payload se guarda entero como `jsonb`, no se reconstruye al leer

**Decisión:** `compliance_report.payload jsonb NOT NULL` guarda el documento completo:
`schema_version`, sitio, rango, `generated_at`, cobertura, períodos, hallazgos, series de
recurrencia y acciones abiertas.

**Alternativa descartada:** guardar solo el digest y los parámetros, y reconstruir el payload al
leer. Rompe lo único que el reporte tiene que garantizar: una inspección de abril que se sube
tarde cambiaría el `completed_count` de un reporte de mayo, y el digest guardado dejaría de
verificar contra el payload reconstruido. El síntoma sería «el hash no coincide» sobre un
documento correcto — el peor modo de fallo posible en la superficie que existe para dar confianza.

**Costo aceptado:** duplicación de datos. Con dos sitios y un puñado de reportes por año, medida
en kilobytes. Es exactamente el caso en que la normalización está mal.

### D2 — La canonicalización es RFC 8785 y vive en `packages/contracts`

**Decisión:** JSON Canonicalization Scheme, implementado a mano en
`packages/contracts/src/canonical-json.ts`, con los vectores del propio RFC como test.

**Por qué un estándar y no `JSON.stringify` con claves ordenadas:** son casi lo mismo, y el
«casi» es el problema. `JSON.stringify` no define el orden de claves, cambia la serialización de
números en los bordes y no dice nada sobre los pares subrogados. Escribir «ordenamos las claves y
usamos `JSON.stringify`» en un documento regulatorio obliga a que quien verifique adivine nuestra
versión de Node; escribir «RFC 8785» le da una especificación y probablemente una librería en su
lenguaje.

**Por qué en `contracts` y no en la API:** el payload y su serialización son un contrato, no un
detalle del servidor. Si mañana un verificador corre en el navegador o en un script suelto,
importa el mismo módulo. `contracts` no puede depender de Node más allá de lo que ya usa; la
canonicalización es texto puro y el `sha256` se toma de `node:crypto` en la API, con la función
de canonicalización libre de dependencias.

**Regla que se escribe en el archivo:** cambiar la forma del payload cambia todos los digests
posteriores. Por eso `schema_version` viaja dentro del payload y se incrementa a mano, y por eso
el archivo lleva el comentario que lo dice.

### D3 — El render vive en una tabla hermana, no en una columna de `compliance_report`

**Decisión:** `compliance_report_render` con `report_id`, `site_id`, `outcome`, `object_key`,
`error`, `rendered_at`. El reporte expone el último `succeeded`.

**Por qué:** `compliance_report` es inmutable y no tiene un solo `GRANT UPDATE`. Un `object_key`
como columna del reporte tendría que escribirse después del insert, que es precisamente la
operación que el motor niega. Es el mismo razonamiento con el que `finding_recurrence` no fue una
columna de `finding` (change `recurrence-detection`), y da algo más: el historial completo de
intentos, con sus errores, queda legible en vez de perderse en un log.

**Sin estado `queued`:** una fila se inserta cuando el intento terminó. Un `queued` en la tabla
sería un estado mutable —tendría que pasar a `succeeded`— en una tabla que no admite `UPDATE`.
Que un reporte todavía no tenga render se lee de la ausencia de filas, y el estado del trabajo lo
sabe pg-boss, que es de quien es.

**Key por intento:** `object_key` incluye el id del render. Con versioning activo, sobrescribir
tampoco perdería el archivo anterior, pero lo dejaría inalcanzable sin API de versiones; una key
por intento hace que cada fila apunte a un objeto que existe por sí mismo.

### D4 — El render es un trabajo de pg-boss disparado por el usuario, no por cron

**Decisión:** `reporting.render-compliance-pdf` entra a `JobPayloads` con `{ report_id: string }`.
`POST /reports/compliance` congela el reporte y encola; el handler renderiza e inserta la fila.

**Por qué no sincrónico:** Playwright levanta Chromium y produce el PDF en segundos, no en
milisegundos. Sostener el request mientras tanto ata el timeout del proxy a la performance del
navegador y hace que un cuelgue del render se vea como un cuelgue de la aplicación.

**Lo que gana:** el reporte y su digest ya están guardados cuando el render empieza. Un Chromium
que falla es una fila `failed` y un reintento, no un reporte perdido; y el reintento produce el
mismo documento porque parte del payload congelado y no de los datos de hoy.

**Es el primer trabajo disparado por una acción de usuario** y no por un cron. Por eso su payload
lleva el `report_id` y no el `now` que llevan los otros dos: no hay nada que resolver contra el
reloj, el trabajo tiene un objeto concreto que procesar.

**Reintento:** se deja al reintento de pg-boss, con tope. Cada intento agotado inserta su fila
`failed`; no hay reintento infinito silencioso.

### D5 — El documento es HTML armado en la API, renderizado por Playwright

**Decisión:** `report-document.ts` produce un HTML completo con CSS de impresión (`@page`,
`size: letter`), y `pdf-renderer.ts` lo carga con `page.setContent` y lo imprime con
`page.pdf({ printBackground: true, displayHeaderFooter: true, footerTemplate })`.

**Por qué HTML y no una librería de PDF pura** (`pdfkit`, `pdf-lib`): el documento es tabular con
paginación, encabezados repetidos y un pie por página. En HTML eso es CSS de impresión; en una
librería de dibujo es cálculo manual de saltos de página. ADR-006 ya eligió esta ruta y aceptó su
consecuencia.

**Por qué `setContent` y no una URL de la aplicación:** un render que navega a una ruta del
frontend necesita una sesión, corre el bundle entero y ata el PDF a que el web esté arriba. El
HTML se arma en el mismo proceso que ya tiene los datos, sin red y sin autenticación de por medio.

**El pie por página lo hace Chromium**, con `footerTemplate` y sus tokens de página. Es la única
forma de tener el digest en las cuatro páginas sin calcular dónde caen los cortes.

**Un browser por proceso**, lanzado la primera vez que hace falta y cerrado en `OnModuleDestroy`.
Levantar Chromium por reporte cuesta un segundo largo y con 24 reportes al año no hace falta pool.
Cada render usa su propia `page` con timeout, y una `page` que se cuelga no arrastra al browser.

### D6 — Los períodos que un sitio debe salen de `schedule_rule`, no de `scheduled_inspection`

**Decisión:** la consulta de cobertura genera los meses del rango con `generate_series`, los cruza
con las ventanas activas de `schedule_rule` para saber cuáles el sitio debía, y hace `LEFT JOIN`
contra `scheduled_inspection` y `inspection`. Un mes debido sin fila es `missed` con
`scheduled_inspection_id` nulo.

**Por qué importa:** partir de `scheduled_inspection` haría que un mes en el que el trabajo de
apertura no corrió desapareciera del reporte, y `required_count` bajaría a 11 sin que nadie lo
note. El reporte diría «11 de 11» sobre un año en el que faltó un mes. Es el modo de fallo
silencioso exacto que el reporte existe para impedir, y es la razón por la que la consulta es más
cara de escribir de lo que parecía.

**Alternativa descartada:** que el trabajo de apertura rellene los períodos faltantes hacia atrás.
Inventaría filas de planificación con fecha pasada —diciendo que se planificó algo que no se
planificó— para simplificar una consulta. La consulta se banca la complejidad; el registro no se
toca.

### D7 — El borde `open`/`missed` se evalúa en `America/Toronto`, en SQL

**Decisión:** la comparación es `period_end < (now() AT TIME ZONE 'America/Toronto')::date`, en la
consulta y no en TypeScript.

**Por qué:** el trabajo de apertura ya resuelve el período corriente en ese calendario, y una
inspección abierta en Ontario que se contara como omitida en UTC produciría, cada mes, cinco horas
en las que el reporte declara un incumplimiento inexistente. Que las dos reglas vivan en el mismo
calendario es lo que hace que abrir y cumplir hablen del mismo mes.

### D8 — El almacenamiento gana dos verbos, y sigue sin tener el tercero

**Decisión:** `ObjectStorageService` suma `putComplianceReport(...)` —`PutObject` desde el
servidor, con `ContentType: 'application/pdf'`— y `presignComplianceGet(...)` —`GetObject` firmado,
TTL corto como el de los PUT—. La política de la credencial suma `s3:PutObject` y `s3:GetObject`
sobre el prefijo de reportes.

**Lo que no cambia:** no hay `DeleteObject` en la credencial y no hay método que lo intente. Las
dos mitades de ADR-006 siguen: el día que alguien escriba el método, el bucket lo niega.

**Por qué descarga firmada y no streaming por la API:** un PDF de cientos de kilobytes que
atraviesa el proceso de Node no gana nada, y la URL firmada corta es el mismo mecanismo que ya se
usa para subir. El endpoint decide si el lector puede —alcance de sitio, render exitoso— y firma;
el byte va directo del bucket al navegador.

### D9 — La auditoría la escriben triggers, y el digest viaja dentro de la entrada

**Decisión:** dos triggers, uno `AFTER INSERT ON compliance_report` que appendea
`compliance_report.generated`, y uno `AFTER INSERT ON compliance_report_render` que appendea
`compliance_report.rendered` solo cuando `outcome = 'succeeded'`.

**Por qué el `payload_hash` va dentro del `payload` de la entrada de auditoría:** hace que la
cadena, por sí sola, pruebe que un documento con ese contenido existió en esa fecha. Si mañana
alguien discutiera la tabla de reportes entera, la cadena —encadenada por hash y verificable
según el spec de `audit`— sigue diciendo el digest. Es duplicación deliberada, y es la que
convierte dos mecanismos separados en una sola prueba.

### D10 — Generar es del coordinador; leer lo decide la sesión

**Decisión:** el chequeo de rol para `POST` está en el servicio (`hs_coordinator`), y el alcance
de sitio lo aplica la política RLS en las dos operaciones. Las lecturas no llevan chequeo de rol.

**Por qué las dos capas y no una:** RLS decide *qué sitios*, no *qué roles*; y un chequeo de rol
en el endpoint sin RLS sería el `WHERE site_id` que los invariantes prohíben. Es el mismo reparto
que usan las acciones correctivas y los incidentes.

**El auditor externo lee y sus lecturas se registran** por el mecanismo que ya existe en el spec
de `audit`; este change no le agrega ni le quita nada, salvo una superficie más para leer.

## Risks / Trade-offs

- **Chromium en la imagen y en CI** → el `Dockerfile` de la API instala el navegador con sus
  dependencias del sistema y el pipeline hace `playwright install --with-deps chromium` cacheado.
  El test del render es de integración y corre solo en el job que tiene el navegador; los tests de
  cobertura, canonicalización y digest no lo necesitan y corren siempre. ADR-008 ya había aceptado
  el costo de hosting; acá se cobra también en tiempo de build.

- **El payload congelado envejece respecto de los datos** → es el objetivo, no el riesgo, pero
  confunde a quien mire la pantalla y el PDF el mismo día. Mitigación: la vista muestra el
  `generated_at` de cada reporte junto al digest, y el documento dice en su propio texto que
  refleja el estado a esa fecha.

- **Un cambio de la forma del payload invalida la comparación de digests entre reportes viejos y
  nuevos** → `schema_version` viaja dentro del payload y el comentario del contrato lo declara.
  No es un problema de verificación —cada reporte verifica contra su propio payload— sino de
  lectura humana, y se resuelve mostrando la versión.

- **Un mes debido y nunca abierto aparece como `missed` sin `template_version_id`** → la UI tiene
  que tolerar esos nulos en la grilla y distinguir «se planificó y no se hizo» de «nunca se
  planificó». Se resuelve en el texto de la celda, no agregando un quinto estado: para el
  regulador ambos son un mes sin inspección.

- **El render puede agotar sus reintentos y dejar un reporte sin PDF** → el reporte sigue siendo
  legible y su digest sigue siendo válido; la vista lo muestra con su último intento fallido y
  permite reintentar. Un reporte sin PDF es un problema operativo, no una pérdida de evidencia.

- **`page.setContent` con datos del propio sistema** → los textos que entran al HTML son prompts
  de plantilla, nombres de ubicación y descripciones de hallazgo escritas por usuarios. Se
  escapan al construir el documento; un `<script>` en la descripción de un hallazgo no puede
  ejecutarse en el navegador de render.

## Migration Plan

Una sola migración, `0014_compliance_reports.sql`, escrita a mano (ADR-004, `drizzle-kit generate`
sigue prohibido): crea las dos tablas con sus barreras, sus políticas de aislamiento y sus
triggers de auditoría. **No altera nada existente**, así que no hay orden de despliegue que
respetar entre migración y código: la aplicación anterior ignora dos tablas nuevas.

El único paso de infraestructura acoplado es la credencial del bucket, que necesita `PutObject` y
`GetObject` sobre el prefijo de reportes **antes** de que se genere el primero. Si se despliega el
código sin la política, el efecto es una fila de render `failed` con el error del bucket, que es
un fallo visible y reintentable — no una pérdida.

Rollback: revertir el código. Las tablas quedan, vacías o con filas, sin afectar a nada; borrarlas
requiere el rol de migración y una migración nueva, como toda la vida del esquema.
