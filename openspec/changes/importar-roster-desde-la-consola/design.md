## Context

Ver `proposal.md` — Why. Lo que condiciona el diseño es el estado del importador, que ya
existe entero y está partido a propósito:

- `apps/api/src/roster/parse-roster-csv.ts` — la mitad pura: texto del archivo → filas
  válidas + rechazos numerados. No toca la base ni conoce NestJS.
- `apps/api/src/roster/apply-roster.ts` — la mitad transaccional:
  `applyRoster(pool, parsed, scope, options)` abre **su propia** transacción con
  `withSiteScope`, resuelve el catálogo de plantas, hace el upsert por `employee_number`,
  escribe `roster_import` + el desglose por planta + los rechazos, y devuelve el reporte.
- `apps/api/scripts/roster-import.mjs` — el único llamador de hoy, y el que dejó escrito
  que el endpoint iba a venir: «el módulo importador está escrito para que el endpoint del
  change de auth lo llame sin reescribir nada».

Y el estado de la puerta: `roster.controller.ts` tiene un solo `@Get('people')`, y
`RosterService` un solo `list()` con `requireCoordinator()` privado. La API corre sobre
`@nestjs/platform-express`; hoy **ningún** endpoint recibe archivos.

Restricciones vigentes: ADR-002 (el aislamiento lo pone RLS; nunca DELETE, la baja es
`deactivated_at`), ADR-004 (Postgres + RLS), ADR-011 (dos vías de alcance —la de la sesión
y la declarada— y un endpoint no puede construir la segunda), ADR-008 (capas
`controller → service → repository` y dependencias en una sola dirección).

**Este change no toca ninguna tabla inmutable ni ninguna migración.** `person`,
`roster_import`, `roster_import_site` y `roster_import_rejection` ya existen con sus
grants, sus políticas y el trigger `roster_import_site_audit`. El endpoint usa los
privilegios que `hs_app` ya tiene, sin conceder ninguno nuevo.

## Goals / Non-Goals

**Goals:**

- Una sola implementación de la importación, llamada desde dos entradas —el comando y el
  endpoint— sin duplicar la lógica ni el reporte.
- Que el alcance y la autoría del endpoint salgan de la sesión, no de lo que el request
  diga, sin abrir un agujero en la separación que ADR-011 sostiene.
- Que el coordinador vea, sin salir de la consola, exactamente lo que hoy imprime el
  comando en la terminal: cuántas entraron, cuántas no, y por qué cada una.

**Non-Goals:**

- Escribir `person` de a una desde la pantalla. El motor concede
  `UPDATE (first_name, last_name, site_id, deactivated_at)` a `hs_app`, pero esos
  privilegios existen para la importación; corregir desde la pantalla es otro change, con
  su discusión sobre qué gana cuando el siguiente CSV pise el cambio.
- Una vista de importaciones pasadas. `roster_import` las guarda todas; leerlas es otra
  pantalla.
- Cambiar el formato del archivo, la validación por fila o el criterio de rechazo. Este
  change los expone, no los revisa.

## Decisions

### D1 · El alcance lo abre el llamador, no el importador

**Decisión.** Partir `applyRoster` en dos: `applyRosterRows(client, parsed, scope,
options)`, que recibe un `PoolClient` **ya dentro de una transacción con alcance** y
contiene todo el cuerpo actual, y dos envolturas finas que la llaman:

- el comando de servidor sigue con `withSiteScope(pool, { siteIds, userId }, …)`;
- el servicio entra por `this.db.withSessionClient(session, (client) => …)`.

**Por qué.** `applyRoster` abre hoy su propia transacción con `withSiteScope`, que según
ADR-011 y `CLAUDE.md` es la vía de los seeds, los comandos y los tests: «un endpoint que
llame a estos está fabricando un alcance que no le corresponde, y por eso son métodos
distintos». Si el servicio llamara a `applyRoster` tal cual, el endpoint construiría un
`SiteScope` a mano y esa separación —que es una garantía, no un estilo— dejaría de
significar algo. Al invertir quién abre la transacción, el endpoint no puede declarar
nada: `withSessionClient` resuelve `siteIds` desde `user_site_scope` en ese request y
`userId` desde la sesión, y `roster_import.imported_by` queda en la cuenta que realmente
subió el archivo.

Consecuencia buscada: **la transaccionalidad no cambia**. Aplicar las filas y escribir el
reporte sigue confirmando junto, porque ambas envolturas abren una sola transacción
alrededor de la misma función.

**Alternativa descartada:** pasarle a `applyRoster` un `SessionScope` y que él elija con
cuál de los dos helpers abrir. Mete la decisión de alcance dentro del importador, que es
exactamente el lugar donde no se puede auditar de un vistazo.

### D2 · El archivo viaja como multipart, con un tope explícito

**Decisión.** `POST /people/import`, `multipart/form-data`, **un** campo de archivo. Tope
de **2 MB**, declarado en el interceptor de subida y no en un chequeo escrito a mano; el
archivo se lee entero en memoria y se pasa como texto UTF-8 al parseador. `source_filename`
sale del nombre del archivo subido, como hoy sale de `basename()` en el CLI.

**Por qué el tope y por qué ese número.** Un roster de 200 personas son decenas de KB; 2 MB
son del orden de cuarenta mil filas. Es holgado para el caso real y chico para que leerlo
entero en memoria sea trivial. Sin tope, el endpoint es una forma de subir un archivo
arbitrario a la memoria del proceso.

**No se decide por el `Content-Type` declarado.** Excel manda `text/csv`,
`application/vnd.ms-excel` o nada según cómo se guardó, y rechazar por ese campo es
rechazar archivos buenos. Lo que decide si el archivo sirve es el parseo: sin encabezado
válido no se aplica nada (D4).

**Alternativa descartada:** el CSV como cuerpo crudo con `Content-Type: text/csv` y el
nombre en la query. Ahorra la dependencia de multipart, pero pone el nombre del archivo
—que va a `roster_import.source_filename`, una columna append-only— en un parámetro de URL,
y deja la puerta de «subir un archivo» sin una forma establecida para el próximo endpoint
que la necesite.

### D3 · Rol y errores, sobre lo que ya existe

**Decisión.** El mismo `requireCoordinator()` privado que ya usa `RosterService.list`, y el
mismo código de error `roster_forbidden` de `roster.errors.ts` con su propio mensaje para
la importación. Se agregan dos códigos nuevos al mismo tipo:

- `roster_file_unusable` → **400**, cuando `parseRosterCsv` lanza `RosterFileError`
  (no es CSV, o al encabezado le falta una columna);
- `roster_file_too_large` → **413**, cuando el archivo pasa el tope de D2.

**Por qué.** `RosterErrorCode` es hoy un solo código porque «la consola es de solo lectura y
lo único que puede salir mal es quién pregunta». Con la importación pueden salir mal dos
cosas más, y las dos son del archivo, no de quien pregunta. El código va en el CUERPO y no
solo en el status, como el resto del sistema, para que el diálogo decida qué decir sin
parsear un mensaje en inglés.

### D4 · Rechazos = 200; solo el archivo ilegible es un error

**Decisión.** El endpoint responde **200 con el reporte** aunque haya rechazado filas —
incluso si rechazó todas. Solo hay error cuando no se puede leer el archivo como CSV con
encabezado, o cuando falta / sobra el archivo en el multipart, o cuando excede el tope: en
esos casos no se aplica nada y no se escribe ningún `roster_import`.

**Por qué.** Es la regla que ya sostiene el importador y la razón por la que se usa: «un
archivo de ADP con tres filas viejas es lo normal, y el comportamiento correcto es aplicar
197 y explicar 3, no rechazar 200. Esa es la diferencia entre un importador que se usa y
uno que el coordinador abandona a la segunda vez». Un 4xx por filas rechazadas le pediría
al cliente que trate el cuerpo de un error como dato, que es la forma de perder el reporte
la primera vez que alguien agregue un manejador genérico de errores.

### D5 · El diálogo, y el aviso que hoy miente

**Decisión.** Un `ImportDialog.tsx` en `routes/RosterRoute/`, montado fuera de la tabla
como los otros cuatro diálogos, con `<input type="file" accept=".csv,text/csv">`, la
mutación, y **el reporte en el mismo diálogo**: los tres números y, si hay rechazos, la
lista con número de fila y motivo. El diálogo no se cierra solo al terminar — el reporte es
lo que el coordinador vino a leer.

La subida invalida `queryKeys.roster(siteId)`. La lógica pura del reporte (el resumen en una
línea, el orden de los rechazos, el texto del botón) vive en `presentation.ts` con su test,
como el resto de la ruta.

Y se reescribe la `.notice-card` de `index.tsx`, que hoy dice «The roster is maintained by
CSV import» sin ofrecer forma de importar: pasa a nombrar el botón que ahora está al lado.

**Por qué el reporte queda a la vista.** Es la única parte de esta pantalla donde el
resultado no se ve en la tabla: una fila rechazada es, por definición, una fila que la
tabla no va a mostrar. Un toast que se va en tres segundos convierte «3 rechazadas» en algo
que hay que volver a importar para averiguar.

**Alternativa descartada:** subir desde un `<input>` suelto en la barra de herramientas, sin
diálogo. Deja el reporte sin lugar donde vivir.

## Risks / Trade-offs

- **Un endpoint que escribe 200 filas de `person` en una transacción, expuesto a la red** →
  El tope de 2 MB de D2 acota el trabajo por request; el rol lo limita al coordinador (D3);
  y el alcance de la sesión (D1) impide escribir una planta que la cuenta no administra —
  con la política RLS de `person` debajo, no en vez de.
- **El endpoint y el comando pueden divergir** → Por eso D1 los deja llamando a la MISMA
  función y no a dos copias, y por eso el delta de la spec exige que ambos produzcan el
  mismo reporte para el mismo archivo. Si mañana uno de los dos necesita algo distinto, se
  va a ver como una rama dentro de una función compartida, no como dos archivos que se
  parecían.
- **Subir un archivo equivocado ahora es fácil** → Un CSV de la planta que no era ya se
  rechaza fila por fila si está fuera del alcance, y el upsert es idempotente: reimportar
  el archivo correcto arregla el error. Lo que NO se puede deshacer es una baja aplicada
  por un `status: inactive` equivocado; se corrige con otro import, y `roster_import` deja
  las dos importaciones registradas.
- **`multer` entra al árbol de dependencias de la API** → Viene con
  `@nestjs/platform-express`, que ya está instalado; lo que se agrega es su tipado en
  `devDependencies`. No toca `packages/forms` ni el service worker, así que no roza ADR-007.

## Migration Plan

No hay migración de esquema ni de datos, y no hay despliegue en dos pasos: el endpoint es
nuevo, nadie lo llama todavía, y el comando de servidor sigue funcionando exactamente igual
durante y después. Volver atrás es quitar la ruta; el roster ya importado queda como está,
porque lo aplicó el mismo código que lo aplicaba antes.
