## Context

Ver `proposal.md` — Why. Lo que condiciona el cómo:

- `person` (0005) tiene `UNIQUE (employee_number)` **global**, no por sitio, y a la vez lleva
  la política `hs_apply_site_isolation`. Las dos cosas juntas son la única dificultad real del
  change: el conflicto puede venir de una fila invisible.
- El motor ya concede `GRANT SELECT, INSERT ON person TO hs_app` y el trigger `person_audit`
  escribe `person.created` en cada INSERT. El importador ya inserta por este camino.
- El importador resuelve el mismo choque con `INSERT … ON CONFLICT (employee_number) DO
  NOTHING` y, si no insertó, un `UPDATE … WHERE employee_number = $1` que puede devolver cero
  filas cuando RLS oculta la que conflictúa (`apps/api/src/roster/apply-roster.ts`).
- ADR-004 (RLS como aislamiento) y ADR-008 (capas delgadas, `controller → service →
  repository`) son los que gobiernan dónde va cada pieza. ADR-002 gobierna qué se puede
  escribir.

**Tabla inmutable: ninguna.** `person` no lo es —el motor le concede `UPDATE (first_name,
last_name, site_id, deactivated_at)` desde 0005 para que el importador pueda aplicar el
archivo— y este change ni siquiera usa ese privilegio: solo inserta. No hay migración, no hay
`GRANT` nuevo y no hay `REVOKE` que revisar.

## Goals / Non-Goals

**Goals:**

- Contestar la pregunta que `roster.service.ts` dejó anotada —qué gana cuando el CSV pisa lo
  hecho a mano— y dejarla escrita en la spec, no en un comentario.
- Un solo camino de escritura por persona, y que sea el más chico posible: crear.
- Que el rechazo por número duplicado no filtre nada de la persona que ya existe.

**Non-Goals:**

- Reusar `upsertPerson`. Lo dice la sección de decisiones: parece ahorro y es un bug.
- Un endpoint genérico de personas (`PATCH /people/:id`, `DELETE`). El único write nuevo es el
  alta; nada en este change deja preparado el terreno para los otros.
- Registrar el alta manual en `roster_import`. Esa tabla describe la aplicación de un archivo,
  con `source_filename` y conteos; una fila sintética la volvería un log de escrituras y
  arruinaría lo único que hoy contesta bien («qué archivos se aplicaron y qué rechazaron»).
  La trazabilidad del alta ya la da `audit_log` por trigger.

## Decisions

### D1 — El CSV gana. El alta manual solo CREA

Cuando el próximo archivo traiga ese `employee_number`, el importador lo trata como a
cualquier otra fila: lo actualiza. El alta a mano no deja ninguna marca que la proteja.

*Por qué.* La identidad del roster es el número de ADP (§4), y ADP es la fuente. Un alta
manual es un adelanto del archivo —«esta persona ya empezó, el export es el lunes»—, no una
corrección de él. La alternativa —una columna `manually_added` que el importador respete—
crearía dos rosters con reglas distintas dentro de la misma tabla, y el día que ADP y la mano
discrepen nadie sabría cuál está mirando.

*Consecuencia directa, y es lo que ata D1 con D2:* si el alta solo crea, entonces el número
duplicado **no puede** resolverse actualizando. Tiene que fallar.

### D2 — El duplicado se detecta con `ON CONFLICT DO NOTHING`, no leyendo antes

`insertPerson` hace `INSERT … ON CONFLICT (employee_number) DO NOTHING RETURNING id` y
devuelve `null` cuando no insertó.

*Por qué no un `SELECT` previo.* Con RLS, ese SELECT no ve la fila de la otra planta: diría
«libre», el INSERT reventaría contra el UNIQUE, y el usuario vería un 500 en el caso que
justamente hay que manejar con cuidado. `ON CONFLICT` pregunta al índice, que no lleva RLS, y
por eso contesta bien en los dos casos con una sola sentencia. Es el mismo mecanismo que ya usa
`upsertPerson`, por la misma razón.

*Por qué no reusar `upsertPerson`.* Aquel, al chocar, hace `UPDATE`: aplicado al alta manual
convertiría «este número ya existe» en «acabás de renombrar y mudar a alguien que no viste».
Es exactamente el write fila por fila que la spec sigue prohibiendo. Son dos funciones porque
son dos actos.

### D3 — El rechazo por duplicado no distingue dentro de fuera del alcance

Un solo código —`person_employee_number_taken`, 409— y un mensaje que nombra el número que el
llamador ya tipeó y nada más. No dice si la persona existente es de su planta, ni cómo se
llama, ni si está activa.

*Por qué.* Distinguir los dos casos convertiría el formulario en un oráculo: tipeando números
se podría averiguar qué empleados existen en una planta que no se administra. Es el mismo
criterio con el que el importador dice `unknown or out-of-scope site_code` en vez de decir cuál
de las dos cosas pasó.

*El costo, asumido:* el coordinador que choca contra una persona de otra planta lee un error
que no puede resolver solo. Es correcto que sea así — resolverlo es transferir a alguien de
planta, y eso lo hace el archivo (D1).

### D4 — El sitio se comprueba explícitamente en el servicio, contra `session.siteIds`

`person_site_out_of_scope` (403) antes de tocar la base.

*Por qué no dejárselo a RLS,* si ADR-004 dice que el aislamiento es RLS. Porque son dos cosas
distintas: RLS **garantiza** que no se escriba fuera del alcance —y sigue ahí, y sigue siendo
la garantía—, pero al violarla el INSERT levanta un error de política, que llega como 500. Un
`site_id` que el llamador no administra es un pedido mal formado, y merece una respuesta que lo
diga. Es el mismo chequeo explícito que ya hace `/inspector-candidates`, y por la misma razón
que el `GET /people` **no** lo tiene: aquel lee y RLS devuelve vacío, que es la respuesta
correcta; este escribe y RLS aborta, que no lo es.

### D5 — El alta no crea cuenta, y la UI no encadena las dos

El diálogo pide tres campos y cierra. Dar acceso es el botón «Invite to JHSC» que la fila
recién creada ya ofrece (`rowActions` → `canInvite`, que es verdadero para una persona activa
sin cuenta).

*Por qué.* Persona ≠ Usuario es invariante del proyecto, y la mayoría de las 200 personas del
roster nunca van a tener cuenta: pedir un email en el alta sugeriría lo contrario. Encadenar
`POST /people` + `POST /accounts` desde el cliente además inventaría una transacción que no
existe — si la segunda falla, queda una persona creada y un formulario que no sabe qué decir.

### D6 — El disparador va en el encabezado de la ruta, no en la barra de la tabla

Junto al `SitePicker`, y oculto cuando no hay ninguna planta activa.

*Por qué.* La barra de la tabla es el ámbito de «lo que estoy mirando» —buscar, contar—;
«Import roster» está ahí porque el CSV es la forma de arreglar lo que la tabla muestra mal. El
alta no arregla la tabla: agrega a alguien a la planta del encabezado, que es el ámbito que el
`SitePicker` define. Y sin planta activa el botón abriría un formulario sin destino.

## Risks / Trade-offs

- **[El alta a mano y el CSV se contradicen y nadie lo nota]** → No hay contradicción posible
  por diseño (D1): el archivo pisa. El riesgo residual es de expectativa, no de datos, y se
  mitiga en la spec y en el texto del diálogo, que dice de qué planta es el alta.
- **[Un `employee_number` tipeado mal crea una persona que después el CSV no reconoce]** → Es
  real y no tiene arreglo desde este change: el número es inmutable por trigger
  (`person_guard`), así que la fila mal tipeada queda. Se mitiga solo parcialmente con el
  formato que ya valida `employeeNumberSchema`. La salida es dar de baja esa fila desde el
  CSV, que sigue siendo el único que puede.
- **[El formulario como oráculo de números de empleado]** → D3. El costo es un error que el
  coordinador a veces no puede resolver solo.
- **[La superficie de escritura crece y mañana alguien agrega `PATCH /people/:id` «porque ya
  hay un POST»]** → La spec modificada sigue prohibiéndolo explícitamente, y los docblocks del
  controlador y el servicio tienen que decir por qué el alta sí y la corrección no. Es el
  mismo mecanismo que sostuvo la prohibición hasta ahora.
