# Diseño — Incidentes: tercera persona, investigación y relojes regulatorios

## Context

El motivo está en `proposal.md`. Lo que importa acá es qué hay construido y qué de eso se reusa.

**Lo que ya existe y este change no reinventa.** La etapa 5 dejó un motor de estados probado: la
tabla `TRANSITIONS` como dato en `packages/contracts`, escrita otra vez como guarda en SQL y
comparada por un test de integración que evalúa todos los pares ordenados por los dos caminos (D3
y D4 de `corrective-action-lifecycle`). Dejó también el `DISTINCT ON (…) ORDER BY position DESC`
como forma canónica de leer un estado derivado, la restricción diferida «una entidad sin su primer
evento no existe», el `unique (entity_id, position)` contra la bifurcación del stream, y
`hs_make_immutable` + `hs_apply_site_isolation` como el par que se aplica a toda tabla nueva. El
incidente es el **segundo consumidor** de todo eso.

**Lo que no existe y hay que construir.** Tres cosas, y las tres son la razón de que esta etapa no
sea copiar la anterior:

1. **Una guarda que depende del estado de otras filas.** «No se cierra con acciones abiertas» no
   se puede escribir como un `CHECK`: exige recorrer el stream de eventos de cada acción hija.
2. **Una política RLS que no alcanza con `site_id`.** El incidente lo ve quien lo cargó, el
   coordinador y gerencia. La conexión hoy lleva `app.site_ids` y `app.user_id`; le falta el rol.
3. **Reglas de calendario legal.** Días hábiles con feriados de Ontario, y dos relojes que arrancan
   de instantes distintos. Es aritmética, pero es la aritmética que ADR-008 nombra como la segunda
   costura crítica del sistema junto a la ingesta.

**Restricciones que no se negocian.** ADR-001 (object keys, nunca bytes), ADR-002 (inmutabilidad
en el motor, estado derivado de eventos), ADR-004 (el `.sql` es la fuente de verdad, el esquema
Drizzle es un espejo a mano y `drizzle-kit generate` está prohibido), ADR-005 (pg-boss para el
trabajo diferido), ADR-008 (módulos, dependencias en una sola dirección, funciones puras para las
reglas).

**Este change toca cinco tablas inmutables nuevas** —`incident`, `incident_event`,
`incident_witness`, `investigation`, `investigation_cause`— **y hace un `ALTER` sobre una tabla
inmutable existente**, `corrective_action`. El `ALTER` no toca datos: agrega una columna nullable,
relaja un `NOT NULL` y agrega un `CHECK`. La inmutabilidad prohíbe que la **aplicación** cambie
filas; el rol de migración sigue pudiendo cambiar el **esquema**, que es lo que ADR-004 separa a
propósito. Aun así es el primer `ALTER` del proyecto sobre una tabla con datos de producción, y
por eso tiene su propia sección de migración más abajo.

## Goals / Non-Goals

**Goals:**

- Que la guarda de cierre sea imposible de eludir: escrita en SQL, evaluada contra el estado
  vigente real de cada acción hija, y probada por inserción directa además de por endpoint.
- Que la visibilidad angosta viva en el motor. Un `SELECT * FROM incident` crudo dentro de la
  transacción de un supervisor tiene que devolver solo lo suyo.
- Que los relojes sean funciones puras con tabla de casos, comparables contra las citas
  normativas de las que salen, y ejecutables en milisegundos sin base de datos.
- Que el segundo padre de la acción correctiva entre sin backfill y sin reescribir una sola fila.
- Que el registro no filtre por los costados: ni la notificación ni el log de auditoría pueden
  llevar lo que la política RLS acaba de cerrar.

**Non-Goals:**

- Un motor de máquinas de estado genérico. Hay dos consumidores y siguen siendo dos tablas de
  transiciones separadas, cada una con sus guardas. Extraer la abstracción con dos casos es
  adivinar el tercero.
- Un modelo de permisos por fila general. La visibilidad angosta se escribe para el incidente
  porque el incidente es lo único que la pide; no se convierte en un framework de ACL.
- Reglas legales autoritativas. Las tablas de clasificación, de investigación obligatoria y de
  plazos son **configuración en código** con su cita, y llevan escrito que hay que confirmarlas
  contra las obligaciones concretas del empleador antes de producción.

## Decisions

### D1 — La guarda «no se cierra con acciones abiertas» es una función `STABLE` en SQL, invocada desde el trigger de transición

Un `CHECK` no puede consultar otra tabla y un trigger que embeba el `DISTINCT ON` a mano lo
duplicaría en cada lugar donde haga falta. Se escribe una función
`hs_incident_has_open_actions(incident_id uuid) RETURNS boolean`, `STABLE`, que resuelve el estado
vigente de cada `corrective_action` del `investigation` del incidente con el mismo `DISTINCT ON …
ORDER BY position DESC` que usa el repositorio, y devuelve verdadero si alguno no es `closed`. El
trigger de transición del incidente la llama solo cuando `to_state = 'closed'`.

_Alternativa descartada: un contador desnormalizado de acciones abiertas en `incident`._ Sería una
columna que hay que mantener con triggers en las dos tablas y que puede desincronizarse — y en una
tabla donde `UPDATE` está revocado, ni siquiera se puede mantener. La consulta cuesta un índice y
un puñado de filas: una investigación tiene unidades de acciones, no miles.

_Alternativa descartada: comprobarlo en el servicio._ Dos transacciones concurrentes —una que
cierra la última acción y otra que cierra el incidente— pasarían las dos. Dentro del trigger, la
lectura ocurre en la misma transacción que la inserción del evento de cierre y el `unique
(incident_id, position)` serializa el resto.

### D2 — La visibilidad angosta es una **segunda** política RLS, permisiva sobre restrictiva, y no una reescritura de `hs_apply_site_isolation`

Postgres combina políticas `PERMISSIVE` con `OR` y `RESTRICTIVE` con `AND`. La aislación por sitio
que `hs_apply_site_isolation` crea es permisiva y ya está probada en todo el sistema; tocarla para
un caso sería arriesgar diez tablas por una. El incidente la aplica igual y **agrega una política
`RESTRICTIVE`** que exige `reported_by = current_setting('app.user_id')::uuid` **o**
`current_setting('app.role') IN ('hs_coordinator','management')`. Las dos condiciones se
componen con `AND`, que es exactamente la semántica que el requisito pide: sitio **y** visibilidad.

Sin `app.role` en la conexión la política no puede evaluarse, y ese es el comportamiento deseado:
una transacción que no declara rol no ve ningún incidente, en vez de verlos todos.

_Alternativa descartada: resolver el rol dentro de la política leyendo `app_user`._ La política se
evalúa por fila y haría un join por fila contra una tabla que a su vez tiene RLS. El rol ya está
resuelto en la sesión; ponerlo en la conexión es un `set_config` más, con el mismo alcance
transaccional que los otros tres.

### D3 — `app.role` se fija en `runScoped`, junto a `app.site_ids` y `app.user_id`, con alcance de transacción

`site-scope.ts` ya fija tres variables con `set_config($1, $2, true)` —el `true` es el alcance
local a la transacción— dentro del `BEGIN`. `app.role` entra en el mismo lugar y hereda la prueba
que ya existe de que el alcance no se filtra entre requests sobre una conexión del pool. El rol
sale de la sesión resuelta en cada request contra `app_user`, no del token: un rol congelado en el
token dejaría a una cuenta degradada leyendo incidentes hasta que el token expire.

### D4 — La clasificación se congela y la corrección posterior es deuda declarada, no un stream

`finding_risk_assessment` es append-only porque la clasificación de un hallazgo **cambia por
diseño**: el coordinador reclasifica y la vista corriente es la última fila. La clasificación de un
incidente no funciona así en §4: es un atributo de la fila, escrito por quien reporta. Se deja como
columna congelada.

El costo es real y se declara: un evento de primeros auxilios que a los tres días se vuelve tiempo
perdido dispara una obligación de Form 7 que el sistema no va a mostrar, porque sigue viendo
`first_aid`. La respuesta que §4 ya tiene es `RegistroSuplementario` —`supersedes_id`, autor,
motivo, el original visible y marcado como superado— y no existe todavía. **Hasta que exista, el
camino operativo es reportar el evento nuevo**, y eso queda escrito en la pantalla, no solo en este
documento.

_Alternativa descartada: `incident_classification` append-only ahora._ Es la abstracción correcta
el día que exista `RegistroSuplementario`, y hacerla antes significa inventar reglas —¿desde qué
instante corre el reloj de una clasificación nueva?— para un usuario que todavía no existe. Es
literalmente lo que la etapa 5 se negó a hacer con el motor de estados, y salió bien.

### D5 — Cada reloj declara su origen: la lesión cuenta desde el evento, el Form 7 desde el reporte

No es una sutileza: es la diferencia entre un Form 7 con tres días por delante y uno vencido antes
de existir. Las obligaciones del MLITSD cuelgan del **evento**; la del WSIB cuelga de **cuándo el
empleador se enteró**, que en este sistema es el instante en que se guarda el reporte. Un supervisor
que carga el lunes un accidente del martes anterior tiene los relojes del MLITSD ya vencidos —y el
sistema lo dice, en rojo, porque ocultarlo sería peor— y el del WSIB corriendo desde el lunes.

La firma queda `regulatoryClocks(input: { classification, occurredAt, reportedAt }): Clock[]`, con
`Clock = { authority, obligation, countsFrom, dueAt | immediate, citation }`. Una sola función de
entrada devuelve las obligaciones de las dos autoridades, porque «qué me toca hacer» es una sola
pregunta del coordinador y partirla en dos llamadas invita a que la pantalla se olvide de una.

**La excepción, encontrada al implementar: la enfermedad ocupacional cuenta desde el reporte.** La
OHSA s. 52(2) cuenta sus cuatro días desde que al empleador **se le avisa**, y no desde una
ocurrencia — que en una enfermedad ocupacional nadie puede fijar. Contarla desde `occurred_at`
haría que todo caso reportado meses después de su inicio naciera vencido, y la pantalla mostraría
un rojo permanente sobre el que no se puede accionar: el peor tipo de alarma, la que enseña a
ignorar la pantalla. Por eso `countsFrom` es un campo de cada reloj y no una propiedad de la
autoridad. El spec de `incidents` lo dice y `MLITSD_RULES` lo escribe fila por fila.

### D6 — Los feriados de Ontario se derivan por regla, incluida la Pascua, y no se listan por año

Nueve feriados: cuatro de fecha fija (Año Nuevo, Canada Day, Navidad, Boxing Day), cuatro de
n-ésimo día de semana (Family Day, Victoria Day —el lunes anterior al 25 de mayo—, Labour Day,
Thanksgiving) y uno móvil (Viernes Santo, dos días antes de la Pascua occidental, por el cómputo
de Gauss/Meeus). Una lista por año es una bomba de tiempo: el día que nadie la actualiza, el
sistema empieza a dar plazos optimistas sobre un formulario legal, en silencio.

**No se ajusta el feriado que cae en fin de semana.** Para contar días hábiles da igual: el sábado
ya no cuenta. El «lunes siguiente» es una regla de días de pago, no de plazos.

_Alternativa descartada: contar solo fines de semana._ Ontario tiene nueve feriados y varios caen
en semana; ignorarlos da un plazo más corto del real en el sentido peligroso —el sistema diría que
el Form 7 vence antes de cuando vence, lo cual es conservador— pero también más largo cuando el
feriado cae dentro de la ventana, y eso es un formulario presentado tarde.

### D7 — Los relojes no son columnas, y por eso la clasificación tiene que estar congelada

ADR-008 dice que los relojes se calculan, no se guardan. Eso solo es sostenible si sus entradas no
se mueven, y las tres —clasificación, `occurred_at`, `reported_at`— viven en una fila append-only.
La consecuencia práctica: el detalle del incidente calcula los relojes en cada lectura, sin
consultar nada, y dos lecturas separadas por un mes dan el mismo resultado.

### D8 — La investigación es una fila, no un estado; la causa raíz son filas append-only con `is_root`

`investigation` es una fila por incidente (`unique (incident_id)`) creada en la misma transacción
que la transición a `under_investigation`: no hay incidente en investigación sin investigación, y
la restricción diferida lo garantiza igual que «una acción sin su primer evento no existe».

Las causas son `investigation_cause` con `position`, `statement` e `is_root`. **Una sola tabla para
los cinco porqués y para el árbol**, con `parent_cause_id` nullable: el árbol es la lista con
padres y los cinco porqués son el árbol degenerado en cadena. `method` en `investigation` dice cuál
de los dos se usó, porque inferirlo de la forma del grafo es adivinar.

_Alternativa descartada: JSON con el árbol entero en una columna._ Se leería más fácil y se
auditaría peor: cada causa dejaría de tener su propia entrada en la cadena de hashes, y «se agregó
una causa» y «se reescribió el árbol» serían indistinguibles en una tabla donde `UPDATE` está
revocado justamente para que no lo sean.

### D9 — La acción de una investigación exige `severity` explícita, y el resto del motor no cambia

Un hallazgo tiene clasificación y de ahí sale la severidad. Una investigación no. La opción de
inventar una severidad por defecto —«las acciones de investigación son `major`»— pondría un plazo
legal en una constante escondida. Se le pide al coordinador, con la misma tabla severidad → días y
la misma congelación en la fila. El resto —evidencia obligatoria, verificador distinto,
escalamiento +3/+7, bandeja— no distingue el padre y no debe distinguirlo.

### D10 — `incidents` no llama a `actions`, y `actions` no llama a `incidents`

ADR-008 pone `incidents` después de `actions` y prohíbe los ciclos. La acción de una investigación
se crea por el endpoint de `actions` con `investigation_id` como dato del cuerpo; `actions` valida
que la investigación exista y sea del sitio con una FK compuesta, no con una llamada a un servicio.
En el otro sentido, la guarda de cierre del incidente lee el estado de las acciones **en SQL**, no
llamando a `actions.service`. Las dos flechas se resuelven en el esquema, que es donde la etapa 4
ya resolvió la suya.

### D11 — La notificación lleva la clasificación y el id, nunca el nombre del sujeto

`notification` no tiene la política de visibilidad del incidente: la lee su destinatario y punto. Si
el payload llevara el nombre de la persona accidentada, la regla RLS que acabamos de escribir se
saltaría por una tabla adyacente. Lleva `incident_id`, `site_id`, `classification`, `occurred_at` y
`reported_at`; seguir el enlace vuelve a pasar por la política, y a quien no puede ver el incidente
no le devuelve nada. `notificationSchema` gana su quinto miembro; la unión ya es discriminada desde
la etapa 5, así que agregarlo no rompe a nadie.

Por el mismo motivo, **el payload de auditoría tampoco lleva narrativa ni nombre**: el log se
consulta con otra regla de acceso y sería la segunda filtración lateral.

### D12 — El incidente no acepta fotos

Los hallazgos tienen foto obligatoria y las acciones tienen evidencia antes/después. El incidente
no tiene ninguna, y no es un olvido: la foto de una persona accidentada es detalle clínico por otra
puerta, y el riesgo G-bis avisa que el problema vuelve «por la puerta de atrás y sin control de
acceso». La evidencia de la remediación vive donde tiene sentido, en las acciones correctivas de la
investigación. No hay `presign/incident` en `uploads`.

### D13 — El idioma se declara, no se detecta

`narrative_language` es un campo que el reportante elige. Detectarlo automáticamente sería inferir
un dato dentro de un registro inmutable con una heurística que se equivoca en textos de veinte
palabras. Y no hay traducción: el riesgo G lo prohíbe explícitamente.

### D14 — El incidente se carga online

Un accidente se reporta desde una oficina o un teléfono con señal, no desde el fondo del
invernadero a mitad de un recorrido de 48 acres. El outbox y Dexie son para R1. Un incidente que
espera sincronización sería peor que uno cargado veinte minutos más tarde: los relojes del MLITSD
corren desde el evento y un reporte demorado en un dispositivo sería invisible para todos mientras
tanto.

### D15 — `form_version` es un entero en la fila y un registro en código

El registro es `INCIDENT_FORM_VERSIONS: Record<number, readonly FieldName[]>` en
`packages/contracts`. La versión corriente es una constante; la fila guarda la que estaba vigente.
Al leer un incidente, la respuesta incluye qué campos existían en su versión, y la pantalla
distingue «vacío porque no aplicaba» de «no existía». Agregar un campo es una migración más una
entrada nueva en el registro, nunca una edición de la entrada anterior.

### D16 — El mapeo al Form 7 vive junto al registro de versiones y no genera nada

Un `Record<number, Form7Mapping>` paralelo a `INCIDENT_FORM_VERSIONS`. Los campos del Form 7 que el
sistema deliberadamente no tiene —todo lo clínico— se muestran etiquetados como no almacenados, no
como vacíos, para que nadie los lea como «no hubo». Copiar al portapapeles es una API del
navegador; no hay endpoint, no hay Playwright y no hay PDF.

## Risks / Trade-offs

**El `ALTER` sobre `corrective_action` es el primero sobre una tabla inmutable con datos** → El
`ALTER TABLE … ALTER COLUMN finding_id DROP NOT NULL` y el `ADD COLUMN investigation_id uuid` no
reescriben la tabla en Postgres moderno; el `ADD CONSTRAINT … CHECK` sí la escanea. Con el volumen
del proyecto —dos plantas, meses de operación— el escaneo es instantáneo. Se agrega igual como
`NOT VALID` seguido de `VALIDATE CONSTRAINT`, que es el patrón que no toma un lock largo, y el paso
de validación queda en la misma migración para que no exista un despliegue con la restricción sin
validar.

**La guarda de cierre lee filas de otra tabla dentro de un trigger** → Es la primera vez que una
guarda del sistema no es local a la fila. El riesgo es de rendimiento y de deadlock. De
rendimiento: acotado por el índice `corrective_action_finding_idx` y su equivalente nuevo por
investigación, sobre unidades de filas. De deadlock: la función es `STABLE` y solo lee; no toma
locks de escritura sobre `corrective_action`.

**`app.role` es una cuarta variable de sesión que alguien puede olvidar de fijar** → El modo de
falla es cerrado —sin rol no se ve ningún incidente— así que un olvido se manifiesta como «no veo
nada», que se investiga, y no como «veo de más», que no se nota. Un test que abre una transacción
sin rol y comprueba que las cinco tablas devuelven cero filas lo deja fijado.

**Las tablas de clasificación, de investigación obligatoria y de plazos pueden no coincidir con la
obligación legal real** → §4 ya lo advierte y este change lo repite en el código y en la pantalla:
son configuración con su cita, y la responsabilidad del envío es de una persona. El sistema muestra
un plazo calculado, no un dictamen. Confirmar las tres tablas contra las obligaciones concretas del
empleador bajo la OHSA y la WSIA es una tarea previa a producción, no a este change.

**La clasificación congelada deja fuera el evento que se agrava** → D4 lo declara con su costo y su
camino operativo. Es la deuda que `RegistroSuplementario` paga en la etapa 7.

**La visibilidad angosta puede esconder un incidente de quien lo necesita** → §4 dice que el
miembro del JHSC «ve hallazgos e incidentes», y esta política no lo incluye. Está en Open Questions
porque es una decisión de negocio, no de diseño: la política es una línea de SQL y agregar un rol
a la lista es cambiar esa línea.

**La política `RESTRICTIVE` también alcanza al rol de migración** → `FORCE ROW LEVEL SECURITY`
hace que el dueño de la tabla quede sujeto a sus propias políticas, así que `hs_migrator` no ve un
incidente sin declarar cuenta o rol. Es correcto y es consecuencia de una decisión vieja (0001),
pero sorprende: los tests que prueban la inmutabilidad tienen que declarar sesión, o su `UPDATE`
alcanza cero filas, no dispara el trigger por fila y «tiene éxito» sin haber tocado nada. Queda
escrito acá porque el próximo que agregue una tabla con visibilidad angosta va a tropezar igual.

## Migration Plan

`0012_incidents.sql`, en un solo archivo y en este orden:

1. Los tipos y las cinco tablas, con sus `CHECK` de dominio cerrado —las cinco clasificaciones,
   los tres estados, los dos métodos, las partes del cuerpo, los tratamientos— duplicados desde
   `packages/contracts` y comparados por un test de integración, igual que `RESPONSE_TYPES` en
   0007 y los estados de la acción en 0011.
2. Las FK compuestas contra `(id, site_id)` y los `unique (id, site_id)` que las tablas hijas
   necesitan como destino.
3. `hs_make_immutable` y `hs_apply_site_isolation` sobre las cinco.
4. La política `RESTRICTIVE` de visibilidad sobre las cinco.
5. `hs_incident_has_open_actions` y los triggers de transición, de investigación obligatoria y de
   estado válido.
6. Las restricciones diferidas: incidente sin evento de reporte, incidente en investigación sin
   `investigation`.
7. Los triggers de auditoría de los cuatro tipos de evento.
8. El `ALTER` de `corrective_action`: `ADD COLUMN investigation_id`, la FK compuesta contra
   `(id, site_id)` de `investigation`, `DROP NOT NULL` sobre `finding_id`, el `CHECK` de
   exactamente-una como `NOT VALID` y su `VALIDATE`.
9. `GRANT SELECT, INSERT` y nada más, para el rol de aplicación.

**Rollback.** No hay `DOWN`: es la política del proyecto desde 0001 y no cambia acá. Volver atrás
es desplegar la versión anterior del código, que sigue funcionando contra este esquema —`finding_id`
nullable no molesta a quien siempre lo escribe, y una columna de más tampoco. Las tablas nuevas
quedan sin uso. La única operación irreversible sería borrar datos, y borrar no se puede.

**Orden de despliegue.** Migración primero, código después, como siempre: el esquema nuevo es
compatible con el código viejo, así que la ventana entre los dos pasos no rompe nada.

## Open Questions

- **¿El miembro del JHSC ve los incidentes?** §4 dice que sí en su tabla de roles; el alcance de
  este change dice que la visibilidad es del reportante, el coordinador y gerencia. Se implementó
  lo segundo, que es lo más restrictivo y lo reversible. Si la respuesta es que sí, es agregar
  `jhsc_member` a la lista de roles de la política `incident_visibility` en 0012 y un escenario al
  spec — no cambia el diseño ni las tareas.

  _Encontrado al implementar:_ como el JHSC no ve el incidente, cuando intenta moverlo recibe
  `incident_not_found` y no `forbidden`. **Es la respuesta correcta y conviene que quede escrita**:
  un `forbidden` le confirmaría que ahí hay un incidente, que es justo lo que la política cierra.
- **¿El auditor externo ve los incidentes?** Por la misma razón queda fuera. Su alcance acotado por
  fecha y su registro de lecturas ya existen; incluirlo sería agregarlo a la misma lista y hacer
  que sus lecturas de incidentes se registren como las demás.
- **¿Alguna clasificación además de `first_aid` queda sin obligación de Form 7?** La tabla escrita
  acá dice que las otras cuatro la tienen. Ajustarla es cambiar una fila de una tabla de casos
  probada celda por celda, y es exactamente el tipo de confirmación que la nota de §4 exige antes
  de producción.
