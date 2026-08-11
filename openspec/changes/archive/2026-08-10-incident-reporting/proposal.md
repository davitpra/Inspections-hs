# Incidentes: tercera persona, investigación y relojes regulatorios

## Why

Hoy el accidente no tiene dónde vivir. Un montacargas choca, alguien se corta, y el sistema
—que ya sabe qué guarda falta en la línea 3, de quién es el problema y para cuándo— no tiene
una sola tabla donde registrar que una persona se lastimó. El recorrido **R4** de
`docs/Requisitos_V1.2.md` §3 no existe, y con él no existe la mitad del nombre del producto:
«Sistema de Inspecciones **e Incidentes**».

Este change cierra la **etapa 6** de §7 —«Incidentes, campos guiados, estados, relojes
regulatorios, pantalla del Form 7», con R4 como propiedad probada— y es el único change de esa
etapa. Es además el momento en que se cobra la deuda que `corrective-action-lifecycle` declaró
por escrito: la acción correctiva pertenece a un `Hallazgo` **o** a una `Investigación`, y el
segundo padre nace acá.

Llega ahora y no antes porque el motor de estados que el incidente necesita ya está construido
y probado con un consumidor real. La etapa 5 dejó dicho que no iba a inventar abstracción para
un usuario que todavía no existía; ese usuario llega en este change, y con él la única pregunta
que el motor todavía no respondió: **una máquina de estados cuya guarda de cierre depende del
estado de otras filas**.

## Lo que este change NO es

**No es reporte en primera persona, ni formulario público, ni canal anónimo.** El incidente lo
carga un supervisor o un gerente **con sesión iniciada**, sobre una persona del roster. No hay
endpoint sin autenticar, no hay kiosco, no hay link compartible y no hay reporte sin autor. La
trazabilidad del autor es lo que hace que el registro sirva ante el MLITSD; un canal anónimo
produce filas que nadie puede sostener en una inspección.

**No es el casi-accidente.** La pregunta cerrada 8 y el riesgo F lo sacaron de las
clasificaciones y el indicador de volumen salió de la analítica. El supervisor que presencia un
casi-accidente lo carga como **hallazgo de entrada manual**, que ya existe desde la etapa 4 y es
donde el evento tiene consecuencias. Este change no agrega esa clasificación ni un atajo hacia
ella.

**No es detalle clínico, y esto es una prohibición y no un recorte.** No hay columna de
diagnóstico, de parte médico ni de restricción funcional, y no las va a haber. «Parte del cuerpo
afectada» es una categoría gruesa y es **el límite**: no se extiende a naturaleza de la lesión.
Ni el coordinador de HS puede consultar en el sistema qué lesión tuvo una persona, solo en qué
categoría cayó el evento. La entidad `DetalleMédico` está eliminada del alcance (§4, riesgo
G-bis) y ningún campo de este change la reintroduce por la puerta de atrás.

**No es el envío al organismo.** El sistema **no manda nada** al MLITSD ni al WSIB (R4). Los
relojes se calculan y se muestran; presentar es un acto de una persona en el portal del
organismo. No hay integración, no hay cola de envío y no hay estado «enviado» que el sistema
pueda afirmar sin saberlo.

**No es el PDF del Form 7.** El riesgo H quedó cerrado en v1.2 a favor de la pantalla: campos
mapeados en solo lectura, con copiar-por-campo y copiar-todo. Generar el formulario oficial crea
una obligación de mantenimiento permanente sobre un formato que no controlamos y el riesgo de
producir un documento desactualizado con apariencia de oficial.

**No es un formulario configurable.** La pregunta cerrada 10 fijó el esquema en código con
versión explícita. El builder visual **no gana un segundo consumidor**: sigue siendo solo de
plantillas de inspección. Los plazos legales que dependen de estos campos no se dejan en manos
de un constructor visual.

**No es el aviso de vencimiento del reloj.** El sistema calcula el plazo, lo muestra y notifica
al coordinador **al reportarse el incidente**, que es lo que R4 pide textualmente. Un cron que
avise «al Form 7 le quedan 4 horas» es trabajo de la etapa 7 y deja libre el tercero de los tres
trabajos que ADR-005 enumeró.

**No es analítica de incidentes.** Agrupar por equipo, por tarea o por parte del cuerpo son
consultas de `reporting` en la etapa 7. Este change garantiza que los campos existan y sean
consultables; no escribe un dashboard.

## What Changes

- **El incidente se carga en tercera persona: reportante Usuario, sujeto Persona.** El
  `reported_by` es una **cuenta**; el `subject_person_id` es una **Persona del roster que casi
  seguro no tiene cuenta**. Es la distinción central de §4 llevada a su caso más visible: el
  supervisor elige a la persona afectada de un selector que devuelve `PersonOption` —número de
  empleado y nombre para mostrar, nada más— y **no puede ver su perfil**. Los testigos son
  referencias a `person` por el mismo selector.
- **Los nueve campos guiados de §4, fijos en código y versionados.** No hay un cuadro de texto
  libre único: fecha y hora del evento (distinta de la del reporte), ubicación del catálogo
  cerrado, tarea que se realizaba, equipo involucrado, qué ocurrió, parte del cuerpo, tratamiento
  en sitio, testigos, acción inmediata. `incident.form_version` es un entero y existe en código
  un registro `versión → conjunto de campos`, para que un incidente viejo se renderice con los
  campos que existían entonces. **Sin eso, «vacío porque no aplicaba» y «vacío porque no existía»
  se vuelven indistinguibles**, y en un registro inmutable eso no se corrige después.
- **Los campos narrativos registran el idioma en que se escribieron.** La plataforma es solo
  inglés, pero el riesgo G decidió que si un supervisor hispanohablante escribe en español, el
  registro **conserva sus palabras exactas** y anota el idioma. No hay traducción automática
  dentro de un registro inmutable. Esto no es i18n de la interfaz y no abre esa puerta.
- **Cinco clasificaciones y no hay una sexta.** Primeros auxilios, atención médica, tiempo
  perdido o trabajo modificado, lesión crítica, enfermedad ocupacional. `near_miss` no está y su
  ausencia es el requisito.
- **El estado del incidente es un stream de eventos, con el motor de la etapa 5.**
  `reported` → `under_investigation` → `closed`, más la reapertura con motivo, que es un evento
  nuevo y no una edición. La tabla `incident` **no tiene columna de estado** y esa ausencia es el
  requisito, igual que en `corrective_action`.
- **La guarda de cierre es la razón de ser de la máquina.** Un incidente **no se cierra con
  acciones correctivas abiertas**, y eso hace que su estado sea una consecuencia del trabajo real
  y no una declaración administrativa. Es la primera guarda del sistema que depende del estado
  vigente de **otras filas** —el `DISTINCT ON` de los eventos de cada acción— y no del estado de
  la propia entidad.
- **La investigación es obligatoria para tres clasificaciones.** Lesión crítica, tiempo perdido y
  enfermedad ocupacional no pueden ir de `reported` a `closed`. Primeros auxilios y atención
  médica sí, con motivo registrado. La lista vive en código como configuración y **el sistema no
  la trata como regla legal autoritativa** —§4 lo dice con esas palabras y este change lo repite
  en el código, con un comentario que exige confirmarla contra las obligaciones concretas del
  empleador bajo la OHSA antes de salir a producción.
- **La investigación tiene causa raíz estructurada.** Cinco porqués o árbol de causas —el método
  queda registrado, no se infiere— más secuencia de eventos. Cerrar exige causa raíz registrada;
  una investigación sin causa raíz es una carpeta vacía con un nombre.
- **La acción correctiva gana su segundo padre.** `ALTER TABLE corrective_action`: se agrega
  `investigation_id` nullable, se relaja `finding_id NOT NULL` y entra el `CHECK` de
  exactamente-una que §4 pide. **BREAKING** para cualquier consulta que asuma
  `finding_id IS NOT NULL`. Era el paso previsto que la etapa 5 dejó anotado para no ser una
  sorpresa acá.
- **Los relojes regulatorios son funciones puras sin base de datos.** ADR-008 los nombra junto a
  la máquina de estados como la segunda costura crítica: `mlitsdClocks(classification, occurredAt)`
  y `wsibClock(reportedAt)` devuelven qué obligaciones aplican y para cuándo, con tabla de casos
  y sin Testcontainers. **Sus tres entradas —clasificación, `occurred_at` y `reported_at`— están
  congeladas en una fila append-only**, así que un reloj da la misma respuesta cada vez que se
  calcula y no hace falta guardarlo como columna. Que la clasificación no se pueda corregir tiene
  un costo declarado: un evento de primeros auxilios que días después se vuelve tiempo perdido es
  un `RegistroSuplementario` de §4, que no existe todavía y es etapa 7. Hasta entonces los relojes
  cuentan desde la clasificación original.
- **Cada reloj declara de qué instante cuenta, y esa diferencia es el diseño.** Los plazos del
  MLITSD por una lesión cuentan desde que **ocurrió** el evento; el del WSIB cuenta desde que el
  empleador **se enteró**, que en este sistema es el momento del reporte. Un solo `occurred_at`
  para los dos daría un Form 7 vencido antes de existir cuando alguien reporta un evento de la
  semana pasada. La enfermedad ocupacional es la excepción y cuenta desde el reporte: la OHSA
  s. 52(2) la cuenta desde que al empleador se le avisa, porque una enfermedad no tiene un instante
  de ocurrencia que alguien pueda fijar.
- **El reloj del WSIB cuenta días hábiles, con los feriados de Ontario en código.** Tres días
  hábiles no es tres días. Los feriados estatutarios de Ontario se derivan por regla —fecha fija y
  n-ésimo día de la semana— y se prueban año por año; contar solo fines de semana daría un plazo
  optimista sobre un formulario que se presenta tarde.
- **Los relojes se muestran, no se cumplen.** La pantalla dice qué obligación aplica, para cuándo
  y **cuál es la cita normativa**. No hay estado «presentado» que el sistema pueda afirmar: no vio
  el envío y no lo va a inventar.
- **La pantalla del Form 7 es solo lectura, con copiar-al-portapapeles.** Los valores del
  incidente mapeados a los campos del formulario del WSIB, campo por campo y todo junto. Sin PDF
  oficial. El mapeo vive en código junto a `form_version`, así que un incidente viejo se mapea con
  el conjunto de campos que tenía.
- **La visibilidad del incidente es más angosta que el sitio, y la impone RLS.** Un incidente lo
  ven quien lo cargó, el coordinador de HS y gerencia —y nadie más, ni siquiera otro supervisor de
  la misma planta, tal como §4 dice: «no ve incidentes de otros». Es la primera política del
  sistema que **no alcanza con `site_id`**: exige que el rol y la cuenta de la sesión estén en la
  conexión, así que `app.role` se suma a `app.site_ids` y `app.user_id` como variable de sesión, y
  la política se escribe sobre las tres. **La regla sigue estando en el motor y no en un `WHERE`
  del endpoint**, que es el invariante que ningún change puede violar.
- **El coordinador es notificado al reportarse un incidente.** R4 lo pide textualmente. La bandeja
  gana un tipo de notificación —`incident_reported`— y el payload lleva la clasificación y el
  sitio, **nunca el nombre del sujeto**: una notificación es una fila menos protegida que el
  incidente y no puede convertirse en la filtración lateral de lo que la política RLS acaba de
  cerrar.

## Capabilities

### New Capabilities

- `incidents`: qué es un incidente en tercera persona, quién lo puede cargar y sobre quién, qué
  campos guiados lo componen y cómo se versionan, qué clasificaciones existen y cuál no existe,
  qué transiciones tiene su estado y qué guarda cada una, cuándo la investigación es obligatoria,
  qué exige la causa raíz, qué relojes regulatorios aplican y desde cuándo cuentan, qué muestra la
  pantalla del Form 7, y quién puede ver un incidente.

### Modified Capabilities

- `actions`: una acción correctiva pertenece a **exactamente un padre**, que ahora puede ser un
  hallazgo **o** una investigación. Cambian el requisito de parentesco, el origen de la fecha
  límite cuando el padre es una investigación —no hay `severity` de hallazgo que copiar— y la
  regla de sitio. **BREAKING**: `finding_id` deja de ser obligatorio.
- `immutability`: `incident`, `incident_event`, `incident_witness`, `investigation` e
  `investigation_cause` entran a la lista de tablas que ningún rol —tampoco `hs_migrator`— puede
  modificar ni borrar. Y la aislación por sitio deja de ser la única política de lectura: el
  incidente agrega una restricción por autor y por rol, encima de la de sitio y nunca en su lugar.
- `audit`: cuatro tipos de evento nuevos —`incident.reported`, `incident.transitioned`,
  `investigation.opened`, `investigation.cause_recorded`— escritos por trigger, con la misma cadena
  de hashes por sitio. La reapertura no es un quinto tipo: es una transición como cualquier otra, y
  que no se distinga de una edición es correcto porque no hay ediciones. **El payload no lleva
  narrativa ni el nombre del sujeto**: el log se lee bajo una regla de visibilidad distinta de la
  del incidente, y sería la segunda filtración lateral después de la notificación.
- `identity`: la sesión pone en la conexión el **rol** además de la cuenta y el alcance de sitios.
  Sin eso, una política RLS no puede distinguir a gerencia de un supervisor, y la visibilidad
  angosta del incidente tendría que resolverse en el endpoint —que es exactamente lo que el
  invariante prohíbe.

## Impact

- **Esquema**: migración `0012_incidents.sql`. Crea las cinco tablas con `hs_make_immutable`, la
  aislación por sitio y la política adicional de visibilidad; la guarda de transición del
  incidente; la guarda «no se cierra con acciones abiertas»; la guarda de investigación
  obligatoria por clasificación; la restricción diferida «un incidente sin evento de reporte no
  existe»; los triggers de auditoría; y el `ALTER TABLE corrective_action` del segundo padre.
  `GRANT SELECT, INSERT` y nada más.
- **`packages/contracts`**: `incidents.ts` con las clasificaciones, la máquina de estados como
  tabla de datos, el registro `form_version → campos`, las funciones puras de los relojes con sus
  citas normativas, el mapeo al Form 7 y las formas de creación y transición. `actions.ts` cambia
  la forma de creación para aceptar cualquiera de los dos padres. `notifications.ts` gana el quinto
  miembro de la unión discriminada.
- **`apps/api/src/incidents`**: módulo nuevo (`controller → service → repository` más las
  funciones puras de relojes y de estados). ADR-008 dice que `incidents` no lo llama nadie hacia
  abajo salvo `reporting`; **`actions` no puede conocer `incidents`** —la flecha va al revés— así
  que la creación de una acción desde una investigación entra por el módulo `actions` con el
  padre como dato, no por una llamada de `incidents` a `actions` ni al revés.
- **`apps/api/src/db/site-scope.ts` y `auth`**: `app.role` se fija en la conexión junto a
  `app.site_ids` y `app.user_id`, con el mismo alcance de transacción y la misma prueba de que no
  se filtra entre requests.
- **`apps/web`**: el formulario de carga en nueve campos, el detalle del incidente con sus relojes,
  la pantalla del Form 7 con copiar-al-portapapeles, y la investigación con su causa raíz y sus
  acciones. La bandeja gana el aviso al coordinador.
- **Deuda declarada hacia la etapa 7**: `reporting` cuenta incidentes por clasificación, por
  equipo y por tarea, y agrupa la recurrencia. Ninguna de esas consultas se escribe acá; los campos
  que necesitan quedan indexados.
- **Sin reclamar**: el tercero de los tres trabajos de ADR-005 —notificaciones al coordinador como
  trabajo diferido— sigue libre. Este change notifica dentro de la transacción del reporte, que es
  lo que R4 pide, y no encola nada.
