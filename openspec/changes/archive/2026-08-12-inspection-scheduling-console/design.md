# Diseño — Consola de programación

## Alcance sobre tablas inmutables y migraciones

**Este change no toca ninguna tabla inmutable y no trae migración.** `rules.design` pide declararlo
explícitamente y esta es la declaración. No se crea tabla, no se altera columna, no se agrega
política ni se otorga un privilegio: los `GRANT SELECT` sobre `site`, `template`,
`template_version`, `app_user` y `user_site_scope` ya están en 0003, 0004 y 0005. Por lo tanto
`rules.tasks` —«toda tarea que toque el esquema incluye la migración SQL con REVOKE/RLS»— queda sin
sujeto, y vale más decirlo que dejar el silencio.

Todo lo que este change agrega son lecturas y una pantalla. Las escrituras son las que ya existían.

## ADRs aplicables

ADR-002 (inmutabilidad y aislamiento forzados por el motor), ADR-003 (router en código),
ADR-004 (Postgres + Drizzle + RLS), ADR-007 (el monorepo y `contracts` como la dieta del cliente),
ADR-011 (autenticación y alcance de sesión resuelto en cada request). No se reescribe su contenido.

## D1 — Por qué `GET /sites` filtra en el `WHERE` sin violar la invariante

La invariante del proyecto dice «aislamiento por sitio vía políticas RLS, nunca vía `WHERE` en el
endpoint». `GET /sites` hace `WHERE id = ANY($1)` con el alcance de la sesión, y eso *parece* la
violación exacta.

No lo es, y la razón está escrita en la migración 0004 desde el primer día: `site` **no lleva
política RLS a propósito**. Ponérsela «crearía un arranque circular —para insertar la fila habría
que declarar en `app.site_ids` un id que todavía no existe— a cambio de esconder el hecho de que la
otra planta existe, que no es lo que protege §6 pregunta 5. Lo que esa pregunta protege son los
hallazgos, y viven en tablas con `site_id` y con política. **El aislamiento empieza en
`location`.**»

Entonces no hay política que rodear. El filtro es **selección**, la misma categoría que el
`WHERE site_id` que ya llevan `locationPackage` y `rosterPackage` en `inspections.service.ts` —que
cargan su propio comentario diciendo esto mismo— y `COMPLIANCE_PERIODS_SQL`. El comentario del
servicio nuevo se escribe en ese registro, porque sin él el próximo lector lo "arregla" y rompe
algo real.

`template` es el mismo caso y está igual de escrito (0003): «Sin `site_id` y por lo tanto sin
política RLS, a propósito: una plantilla es contenido de referencia de la organización, no un dato
de sitio». `GET /templates` no recorta nada y su respuesta es idéntica para las dos plantas.

## D2 — El predicado de elegibilidad se escribe una vez

La propiedad que el change tiene que sostener es **«todo lo que la lista ofrece, el `PATCH` lo
acepta»**. Una UI de asignación que ofrece opciones que el servidor rechaza es peor que no tener
UI: convierte un `inspector_invalid` —que hoy solo puede producir un curl mal escrito— en algo que
el coordinador provoca haciendo lo único que la pantalla le pide hacer.

Las tres condiciones —cuenta no desactivada, rol `jhsc_member`, `user_site_scope` vigente para ese
`site_id`— salen a un módulo propio y las consumen la validación y el listado.

`requireInspector` **conserva su forma diagnóstica** y no se reduce a un booleano: produce tres
mensajes distintos («no existe o está desactivada», «el rol X no puede recibir una inspección», «la
cuenta no tiene acceso vigente al sitio Y») y hay tests que los afirman con `/management/` y
`new RegExp(SITE_A)`. La extracción es de las condiciones, no de la función.

## D3 — `LEFT JOIN person`, y por qué el join no va en `requireInspector`

La elegibilidad se define sobre `user_site_scope`. El *nombre* está en `person`. Son dos cosas
distintas y el sistema lo sabe: `person.site_id` es una columna propia y **mutable** —0005: «una
persona sí se muda de planta»— mientras que el alcance de la cuenta vive en `user_site_scope`.
Además `person` **sí** lleva `hs_apply_site_isolation` (0005:815) y `app_user` no.

Consecuencia: un `jhsc_member` con alcance vigente en St. Thomas cuya `person` figura en Glencoe es
**elegible** para la asignación, y un `INNER JOIN person` bajo `withSessionClient` lo borraría de la
lista. La lista y la validación divergirían por la puerta de atrás, sin error y sin síntoma — solo
una opción que falta.

Por eso: `LEFT JOIN`, nombres nullable en el contrato, etiqueta de reserva en la pantalla. Un
nombre faltante es un problema de presentación; una opción faltante es un problema de corrección.

**Y por la razón simétrica, el join de `person` NO se agrega a `requireInspector`.**
`test/helpers/identity.ts` ubica la persona en `siteIds[0]`, y el test «rechaza como inspector a
quien no tiene alcance en la planta, y nombra el sitio» crea una cuenta cuya persona está en SITE_B
mientras la sesión declara SITE_A. Agregar el join convertiría «no tiene alcance en el sitio» en
«no existe», y el mensaje que la spec exige dejaría de salir.

## D4 — El estado del período va al listado, no la pantalla al reporte

`openspec/specs/inspections/spec.md` ya exige que el estado se exponga «for every non-cancelled
`scheduled_inspection`». Hoy la única implementación es `COMPLIANCE_PERIODS_SQL`, que pide
`site_id` explícito y rangos de meses enteros. Es decir: el requisito está escrito y a medio
cumplir, y la consola es el consumidor que lo destapa.

Se descartaron dos alternativas:

- **Que la consola llame a `GET /reports/compliance` por sitio.** Une por período y no por fila, y
  los períodos que el trabajo nunca abrió llegan con `scheduled_inspection_id` nulo: precisamente
  las filas que no se pueden enlazar. Además es una llamada por sitio para pintar una lista.
- **Re-derivar los cuatro estados en TypeScript.** Dos copias de la frontera `America/Toronto`, y
  la que terminaría envejeciendo es la que lleva digest.

Se extrae el `CASE` de `compliance.sql.ts` a un módulo parametrizado por alias y placeholder de
reloj, y lo consumen las dos consultas. El digest del reporte no se ve afectado: se computa sobre
los *valores* del payload, no sobre el texto del SQL, y `compliance-coverage.int-spec.ts` fija esos
valores. Un test nuevo ata las dos lecturas: para el mismo `scheduled_inspection_id`, el estado del
listado y el del reporte coinciden.

## D5 — Los nombres se resuelven en el servidor

Alternativa considerada: traer los tres lookups al cliente y armar los `Map` ahí. Es tentador
—cardinalidad chica, TanStack Query cachea— y para el nombre del **sitio** es lo que se hace.

Para el nombre del **inspector** no alcanza, y la razón es de dominio: una asignación es un hecho
histórico. Si el asignado se desactivó o perdió el alcance, correctamente ya no aparece en
`/inspector-candidates` — de modo que un `Map` construido desde esa lista imprimiría un UUID crudo
justo en las filas que el coordinador más necesita ver. Se resuelve en el `SELECT`, que además ya
hace `JOIN template` para `template_name`: es la forma establecida de estos DTOs, no una nueva.

## D6 — La ruta es `/scheduling` y no cuelga de `/inspections/`

`CAPTURE_ROUTES` en `apps/web/src/sw.ts` matchea `/^\/inspections\//`. Una pantalla de
administración bajo ese prefijo entraría sin querer al shell precacheado y quedaría "disponible"
sin red, mostrando datos de servidor que no puede traer.

La consola es **online** por la misma razón que el reporte de cumplimiento y la recurrencia: se
planifica sentado y con conexión. Y hay una razón propia: una asignación en cola sería un inspector
que no sabe que fue asignado. La online-idad se expresa **no tocando `sw.ts`**, más el comentario
en el `createRoute`, que es como ya lo dicen `recurrenceRoute` y `complianceRoute`.

## D7 — Gating de rol: inline, y el primer link condicional

Se usa la comparación inline `account?.role === 'hs_coordinator'`, igual que `ComplianceRoute`, y
no se introduce un helper de gating: eso es una decisión transversal que cambiaría lo que ve cada
rol en toda la aplicación y merece su propio change.

La ruta queda **alcanzable por URL para cualquier rol y se renderiza de solo lectura**: los GET no
tienen comprobación de rol y RLS ya recorta, así que un miembro del JHSC viendo la programación de
su planta es legítimo — simplemente no ve botones. Las escrituras las rechaza el servidor de todos
modos, y esa duplicación es deliberada por lo mismo que ya dice `ComplianceRoute`: la comprobación
del cliente evita ofrecer algo que va a fallar, la del servidor es la que manda.

El link de navegación sí se condiciona, y es el **primero** en `Shell()` que lo hace. Queda escrito
en el comentario para que se lea como precedente y no como descuido.

## D8 — `/inspector-candidates` sí lleva comprobación de rol, y el endpoint sí es la frontera

Las otras dos lecturas no llevan `requireCoordinator`, coherente con `GET /inspection-schedules` y
`GET /reports/compliance`: leer el catálogo de la propia planta no es administrar.

`/inspector-candidates` es distinta y lleva **dos** comprobaciones explícitas:

1. `requireCoordinator`. Es la única lectura que proyecta la tabla de cuentas, y existe solo para
   alimentar una operación que ya es exclusiva del coordinador.
2. Que el `site_id` pedido esté en el alcance de la sesión.

La segunda es la incómoda: `app_user` y `user_site_scope` no llevan política, así que **acá el
endpoint sí es la frontera** y no hay motor detrás. Se documenta en ese registro, como ya se
documenta la tensión del auditor en `db/site-scope.ts`, en vez de dejarlo pasar como si RLS
estuviera cubriendo algo.

## Pregunta abierta

**Las lecturas nuevas no pasan `ReadDescriptor`**, así que un `external_auditor` que las lea no
deja entrada en el registro de lecturas. Es consistente con las lecturas de inspecciones que ya
existen —solo cumplimiento y recurrencia pasan descriptor—, pero los lookups ensanchan un poco la
superficie no registrada. Se deja anotado y **no** se agregan descriptores en este change: hacerlo
convierte una lectura en una escritura, y esa decisión merece tomarse a la vista y no de costado.
