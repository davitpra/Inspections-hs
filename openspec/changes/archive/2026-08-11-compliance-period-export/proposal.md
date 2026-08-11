# Reporte de cumplimiento por período, con exportación a PDF hasheada

## Why

La métrica número uno de §1 «cómo sabremos que funcionó» es **cobertura de períodos: 24 de 24**,
y la fila de la tabla dice, textualmente, de dónde sale ese número: «Reporte de cumplimiento por
sitio (R5)». Trece migraciones después, el sistema tiene los datos para calcularlo —cada período
abierto es una fila de `scheduled_inspection`, cada período cumplido es su `inspection`— y no
tiene la pregunta escrita en ninguna parte. Hoy, «¿cumplimos los doce meses en St. Thomas?» se
responde mirando la base a mano.

El recorrido **R5** pide dos cosas en una frase: que el coordinador **consulte por sitio la lista
de períodos con inspección completada vs. omitida**, y que la **exporte a PDF con hash del
contenido**. La segunda mitad es la que convierte una pantalla en evidencia: un PDF sin hash es
un documento que el MLITSD tiene que creernos, y un hash que nadie puede recomputar a los seis
meses es peor que ninguno, porque simula una garantía que no da.

Este change cierra los **dos tercios restantes de la etapa 7** de §7 —«reporte de cumplimiento,
exportación a PDF con hash»— sobre la recurrencia que el change `recurrence-detection` dejó
construida y sin consumidor. Al terminar, **R5 está completo** y con él el último recorrido
crítico de v1 fuera del builder visual (etapa 8).

## La decisión que gobierna todo el change: se hashea el payload, no el PDF

ADR-002 la tomó y ADR-006 la repite; acá se implementa y conviene decir por qué manda sobre el
resto del diseño. **La generación de PDF vía navegador headless no es reproducible byte a byte**:
la versión de Chromium, la de las fuentes del contenedor, el kerning, el subsetting del embebido
y hasta la fecha de creación que Chromium escribe dentro del archivo cambian los bytes sin que
cambie una sola letra del contenido. Un hash del PDF sería un número que a los seis meses no
verifica nadie —ni nosotros— porque regenerar el mismo documento daría otro.

El **payload canónico en JSON sí es reproducible**: mismas filas, misma serialización, mismo
digest, hoy y en 2031. De ahí salen tres consecuencias que este change trata como reglas y no
como preferencias:

1. **El payload se congela y se guarda**, no se recalcula al verificar. Un reporte de julio
   verifica contra los datos de julio, no contra los de hoy.
2. **La canonicalización es parte del contrato**, no un detalle del serializador. Va escrita,
   testeada y compartida, porque es lo único que hace que dos procesos distintos lleguen al mismo
   digest.
3. **El PDF es una vista del payload y puede regenerarse cuantas veces haga falta.** Todas las
   regeneraciones del mismo reporte llevan impreso el mismo hash, porque el hash no es del
   archivo.

## Lo que este change NO es

**No es el envío al MLITSD ni al WSIB.** §2 lo dejó fuera de v1 y sigue afuera. El sistema
produce el documento y lo entrega al coordinador; quién lo manda, cuándo y por qué canal es un
proceso humano. No hay integración, no hay correo saliente y no hay "enviar" en ninguna pantalla.

**No son plantillas de reporte configurables.** El documento tiene una sola forma, definida en
código. Un editor de plantillas de reporte es el riesgo B otra vez —la pieza más cara— aplicado a
una superficie que nadie pidió: R5 describe *un* documento, no una familia.

**No es scoring ni analítica.** §5 riesgo E sacó el scoring ponderado de v1. El reporte cuenta
períodos cumplidos y omitidos, lista hallazgos y series recurrentes, y **no** produce un índice de
cumplimiento, un porcentaje ponderado ni un semáforo. Un número inventado en un documento
regulatorio es una afirmación que después hay que defender.

**No es un archivo de reportes que se pueda borrar o corregir.** El registro del reporte es
inmutable como todo lo demás; un reporte equivocado no se edita, se genera otro. El bucket tiene
versioning y la aplicación no tiene ruta de borrado (ADR-006).

## What Changes

- **Un período tiene exactamente tres estados y ninguno es una opinión.** `completed` (existe
  `inspection` para su `scheduled_inspection`), `missed` (el período cerró sin envío y la
  inspección no fue cancelada) y `cancelled` (tiene `cancelled_at` y su motivo). El período
  corriente, todavía abierto, se reporta aparte como `open` y **no cuenta como omitido**: contar
  como incumplido un mes que aún no terminó es fabricar un incumplimiento.

- **La agregación es por sitio y por período, y la cobertura es una fracción explícita.** El
  reporte de un rango de meses devuelve, por sitio, la lista de períodos con su estado, quién
  inspeccionó, cuándo, contra qué versión de plantilla, y el conteo de cumplidos sobre exigidos.
  Es la fila «24 de 24» de §1, calculada y no estimada.

- **Un reporte se congela: payload canónico, hash SHA-256, y nada de recalcular al leer.** Al
  generarlo se construye el payload completo —cobertura, períodos, hallazgos del rango, series
  recurrentes, acciones correctivas abiertas y vencidas—, se serializa de forma canónica, se
  hashea, y se guarda entero en una tabla inmutable junto con su digest, su rango, su sitio, quién
  lo pidió y cuándo. Leer un reporte es leer esa fila.

- **La canonicalización es JSON Canonicalization Scheme (RFC 8785), escrita en
  `packages/contracts` y testeada contra vectores.** Claves ordenadas por punto de código UTF-16,
  sin espacios, sin `NaN`, sin `undefined`, números en forma canónica, fechas ya normalizadas a
  ISO-8601 UTC por el constructor del payload. Es un estándar y no un invento nuestro
  precisamente para que un verificador externo —el MLITSD, un auditor, nosotros dentro de cinco
  años— pueda recomputar el digest sin nuestro código.

- **El PDF se renderiza en un trabajo de pg-boss, no en el request.** Playwright levanta Chromium
  y tarda segundos; el reporte se congela y se responde de inmediato, y el render llega después.
  Es también lo que hace que un fallo del navegador **no** pierda el reporte: el payload y su hash
  ya están guardados y el render se reintenta.

- **El render es un stream de filas, no una columna.** `compliance_report` es inmutable y no
  tiene un solo `GRANT UPDATE`; el `object_key` del PDF no puede escribirse encima después. Cada
  intento de render inserta su fila en `compliance_report_render` —`queued` no existe, se insertan
  `succeeded` o `failed` con su error— y el reporte expone el último exitoso. Regenerar el PDF de
  un reporte de julio es legítimo y produce otra fila; **el hash impreso sigue siendo el mismo**,
  porque es del payload.

- **El hash va impreso en el pie de cada página**, junto con el sitio, el rango, la fecha de
  generación y el identificador del reporte. Un pie por página y no una sola vez al final: una
  página suelta fotocopiada tiene que seguir diciendo de qué documento salió.

- **El PDF se sube al bucket desde el servidor**, bajo el prefijo del sitio y del reporte, con
  versioning activo y sin ruta de borrado. Es la primera vez que la API escribe en el bucket por
  sí misma —hasta hoy solo firmaba PUT para el dispositivo— y la primera vez que necesita firmar
  un GET, para que el coordinador descargue sin que el PDF atraviese el proceso de Node.

- **Cada generación queda en el log de auditoría**, con `compliance_report.generated` en la cadena
  de hashes del sitio, nombrando el rango, el digest del payload y quién lo pidió. Que un
  documento regulatorio salga del sistema es exactamente la clase de evento que ADR-002 puso la
  cadena para poder demostrar. Cada render exitoso agrega el suyo, `compliance_report.rendered`,
  con el `object_key`.

- **`GET /reports/compliance`** (la vista, calculada al vuelo, sin congelar nada),
  **`POST /reports/compliance`** (congelar y encolar el render), **`GET /reports/compliance/:id`**
  (el reporte congelado y el estado de su render) y **`GET /reports/compliance/:id/pdf`**
  (redirección a una URL firmada de descarga, corta). Todo dentro del alcance de sitios de la
  sesión y recortado por RLS.

- **La vista de cumplimiento por sitio en `apps/web`**: la grilla de meses con su estado, la
  fracción de cobertura, el botón de generar y la lista de reportes ya generados con su hash
  visible y copiable. Solo lectura, solo online: no entra al service worker ni a Dexie.

## Capabilities

### Modified Capabilities

- `reporting`: gana la mitad que le faltaba. Cómo se determina el estado de un período y por qué
  el corriente no cuenta como omitido; qué contiene el payload del reporte y en qué orden; cómo se
  canonicaliza y se hashea; qué garantiza el hash y qué explícitamente no garantiza (los bytes del
  PDF); cómo se relaciona un reporte con sus renders; qué se imprime en el pie.
- `audit`: `compliance_report.generated` y `compliance_report.rendered` entran como tipos de
  evento de la cadena por sitio, con el digest del payload dentro del `payload` de la entrada, de
  modo que la cadena de auditoría sea por sí sola prueba de que ese documento existió con ese
  contenido en esa fecha.
- `immutability`: `compliance_report` y `compliance_report_render` entran a la lista de tablas que
  ningún rol —tampoco `hs_migrator`— puede modificar ni borrar, y a la de las que llevan política
  de aislamiento por sitio.
- `inspections`: el estado de cumplimiento de un período pasa de ser derivable a ser una lectura
  definida —`completed`, `missed`, `cancelled`, `open`— con reglas escritas sobre el borde del
  período, evaluado en el calendario `America/Toronto` y no en UTC.

### New Capabilities

Ninguna. La capability `reporting` ya existe desde `recurrence-detection` y este change la
completa; abrir una segunda para el mismo tema partiría en dos lo que se lee junto.

## Impact

- **Esquema**: migración `0014_compliance_reports.sql`. Crea `compliance_report` (sitio, rango de
  período, `payload jsonb NOT NULL`, `payload_hash` con `CHECK` de 64 hex, `generated_by`,
  `generated_at`) y `compliance_report_render` (reporte, `outcome`, `object_key` nullable,
  `error` nullable, `rendered_at`, con `CHECK` de que `object_key` está exactamente cuando
  `outcome` es `succeeded`), ambas con `hs_make_immutable` y `hs_apply_site_isolation`. `GRANT
  SELECT, INSERT` y nada más. **No altera ninguna tabla existente.**
- **`packages/contracts`**: `canonical-json.ts` —la canonicalización RFC 8785 y el cálculo del
  digest, sin dependencias de Node más allá de `node:crypto` para el hash del lado servidor— y
  `compliance.ts` con la forma del payload, la del reporte congelado, la del render y la de la
  consulta por rango. La forma del payload es un contrato de verdad: cambiarla cambia todos los
  digests futuros, y eso queda escrito en el archivo.
- **`apps/api/src/reporting`**: el módulo existente crece con `compliance.service.ts` (la
  agregación y el congelamiento), `compliance.sql.ts` (la consulta de cobertura por período, SQL
  crudo por el mismo motivo que la de recurrencia), `report-document.ts` (el HTML del documento) y
  `pdf-renderer.ts` (Playwright).
- **`apps/api/src/uploads/object-storage.ts`**: dos verbos nuevos —`putObject` desde el servidor y
  `presignGet` para la descarga— y, con ellos, `PutObject` y `GetObject` en la credencial de la
  aplicación. `DeleteObject` sigue sin estar y sigue sin haber método que lo intente.
- **`apps/api/src/jobs`**: `reporting.render-compliance-pdf` entra al `JobPayloads` tipado. Es el
  primer trabajo disparado por una acción de usuario y no por un cron, y por eso no lleva
  `now` en el payload sino el id del reporte.
- **Dependencia nueva**: `playwright` en `apps/api`, con Chromium instalado en la imagen. ADR-006
  y ADR-008 ya aceptaron la consecuencia —la API no puede ir a serverless— y acá se cobra: el
  `Dockerfile` crece y el CI necesita el navegador para el test de render.
- **`apps/web`**: ruta nueva `ComplianceRoute` en el menú del coordinador, del gerente y del
  auditor externo. El JHSC y los supervisores leen la grilla; **generar es solo del coordinador**.
- **Cierra la etapa 7 y con ella R5.** Lo único que queda de §7 después de este change es la etapa
  8, el builder visual, que por diseño no está en el recorrido crítico.

## Estado al cerrar

**La etapa 7 de §7 queda cerrada y con ella R5 completo.** Las tres piezas de la etapa
—recurrencia (change `recurrence-detection`), reporte de cumplimiento y exportación a PDF
con hash (este change)— están construidas y probadas. De §7 solo queda la **etapa 8, el
builder visual**, que por diseño no está en el recorrido crítico: las plantillas se cargan
como seeds en SQL y el sistema es utilizable sin él.

Dos cosas quedaron fuera de lo que las tareas anticipaban, y conviene que estén escritas:

- **No hay `Dockerfile` que modificar.** El repositorio todavía no containeriza la API
  —`docker-compose.yml` levanta solo Postgres y MinIO para desarrollo—, así que el
  requisito de Chromium quedó documentado en `.env.example` y aplicado en el job de
  integración de CI. El día que exista una imagen, ese requisito ya está escrito.
- **La descarga devuelve JSON con la URL firmada y no una redirección HTTP.** La sesión
  viaja como `Authorization: Bearer`, así que un `<a href>` del navegador llegaría sin
  token. El cliente pide la URL con su token y después abre la URL firmada contra el
  bucket; el PDF sigue sin atravesar el proceso de Node, que era la propiedad buscada.
