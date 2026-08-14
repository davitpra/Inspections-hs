## Context

Ver `proposal.md` — Why. Lo que importa acá es el estado del motor, porque casi todo lo que
este change necesita ya está construido:

- `person` tiene política de aislamiento (`hs_apply_site_isolation`), con `USING` y `WITH
  CHECK` sobre `site_id = ANY(app.site_ids)`. **Es el único límite que hace falta acá**: un
  `site_id` de otra planta devuelve cero filas, sin filtración y sin código.
- `hs_app` ya tiene `SELECT` sobre `person`. Nunca tuvo ni tendrá `DELETE`.
- El índice parcial `person_site_active_name_idx (site_id, last_name, first_name) WHERE
  deactivated_at IS NULL` está puesto para exactamente esta consulta.
- `personSchema` está escrito en contracts desde la etapa 2 y no lo consume ningún endpoint.

**Tablas inmutables:** este change **no toca ninguna, y no escribe ninguna tabla en
absoluto.** Es de solo lectura de punta a punta: no hay `INSERT`, `UPDATE` ni `DELETE` en
ningún camino nuevo, así que ni `person` ni `audit_log` reciben una fila por su culpa.

**No hay migración.** Ni tabla, ni columna, ni privilegio, ni política.

## Goals / Non-Goals

**Goals:**

- Que el coordinador pueda **ver** el roster de cada planta sin abrir `psql`.
- Que la superficie nueva no toque la que ya existe: el paquete de campo y el selector de
  sujeto quedan idénticos.

**Non-Goals:**

- **Escribir `person` desde la API.** Corregir un nombre, transferir de planta, dar de baja
  y crear a alguien siguen siendo del CSV. Ver decisión 5.
- Paginación por offset (decisión 3).
- Arreglar el `PersonPicker` de `ReportIncidentRoute` — necesita otra forma de endpoint, ver
  decisión 1.
- Cualquier cosa offline: la pantalla es ONLINE (decisión 8).

## Decisions

### 1. Leer también es del coordinador — acá se reconcilia §4 R4

§4 dice que el supervisor elige a una persona *"sin poder ver su perfil"*, y por eso
`personOptionSchema` es un `pick` estricto de cuatro columnas. Esta pantalla muestra el roster
completo. **El argumento es que esa frase ata al selector, no a la administración.** Es una
afirmación sobre qué recibe un *supervisor* cuando elige a alguien, y esa superficie no se
toca: `GET /scheduled-inspections/:id/roster` conserva sus cuatro columnas. Lo que §4 descarta
es una ficha navegable desde un selector; lo que §6 exige es que el coordinador administre el
roster, y eso es imposible sin verlo. Las dos frases solo chocan si "perfil" se lee como
"cualquier fila de `person`" — y bajo esa lectura la importación CSV, que la misma sección
manda, también sería ilegal.

**Consecuencia, y es una divergencia deliberada del precedente de `/scheduling`:** aquella
consola deja los `GET` abiertos a todos los roles y condiciona solo la escritura, con el
argumento de que RLS ya recorta lo que se ve. Acá el `GET` **también** llama a
`requireCoordinator`, porque un roster de solo lectura para un supervisor es precisamente la
ficha que §4 no quiere. La pantalla, entonces, no degrada a modo lectura: muestra un aviso.

*Alternativa considerada:* seguir el precedente y abrir la lectura. Rechazada por lo anterior;
el costo es que este endpoint no se puede reusar nunca para el selector de sujeto, que es
justo lo que lo mantiene correcto.

### 2. RLS es el límite en la lectura; no hay chequeo explícito de sitio

`GET /inspector-candidates` sí tiene que comprobar `session.siteIds.includes(siteId)` a mano,
porque lee `app_user` y `user_site_scope`, que **no llevan política**. `person` sí la lleva, así
que un `site_id` ajeno en el query devuelve cero filas sin filtración y sin código. El
`WHERE site_id = $1` es **selección entre las plantas del alcance**, no el límite de seguridad
— la misma categoría que `SitesService` y que `rosterPackage`. ADR-002, ADR-004.

Queda escrito en el docblock del service, porque si no el próximo lector lo "arregla" agregando
una comprobación que no hace falta y que sugiere que RLS no alcanza.

### 3. Sin paginación por offset, y es una decisión, no un olvido

`site_id` es obligatorio, así que una respuesta está acotada al roster de una planta (~200
filas). Los filtros de estado viven en el servidor, donde pueden usar el índice parcial; la
búsqueda de texto vive en el cliente sobre la lista ya traída, donde es instantánea y funciona
mientras se tipea. Agregar `limit`/`offset` ahora es un contrato para mantener siempre, por una
lista que entra en una pantalla de JSON.

**Trade-off, escrito:** si el roster crece a miles, este endpoint recibe un cursor. Agregarlo
después es aditivo; sacar una paginación no lo es. Y esto es lo que reemplaza la promesa de
paginación del change archivado: se cumple con filtros y pantalla, no con offset.

### 4. Una sola ruta, y ninguna que escriba

`GET /people?site_id=&status=`. No hay `PATCH`, `POST` ni `DELETE`.

`/people` y no `/roster`: el recurso son las personas; "roster" es la pantalla. Deja la puerta
abierta a un `GET /people/:id` sin inventar un segundo prefijo.

### 5. Por qué la escritura NO entra, aunque el motor la permita

`hs_app` tiene `UPDATE (first_name, last_name, site_id, deactivated_at)` sobre `person` desde
la etapa 2, y el trigger `person_audit` ya sabe escribir `person.renamed`,
`person.transferred`, `person.deactivated` y `person.reactivated`. O sea: abrir una ruta de
escritura era barato. **Se deja afuera igual**, y conviene que quede escrito por qué, porque
es lo primero que alguien va a querer agregar:

- Esos privilegios existen **para la importación**, que es la que los usa hoy.
- El CSV es la fuente de verdad declarada de la spec vigente
  (*"The roster is loaded from a CSV file, never synchronised"*), y `apply-roster.ts` hace
  `deactivated_at = EXCLUDED.deactivated_at`: una fila con `status: active` revierte cualquier
  baja puesta a mano. Una pantalla que escribe obliga a decidir qué gana, y las dos respuestas
  tienen costo — si gana el archivo, la corrección es efímera y engañosa; si gana la pantalla,
  hace falta un "pin" manual, que es exactamente cómo el roster de Atlas terminó
  desactualizado sin que nadie supiera por qué.
- Y hay una trampa concreta esperando a quien lo implemente rápido: `SET deactivated_at =
  now()` sobre alguien **ya dado de baja** pasa el `IS DISTINCT FROM` del trigger, porque
  `now()` difiere del timestamp guardado, y agrega una entrada **falsa** a una cadena
  append-only que no se corrige nunca (ADR-002). Cualquier ruta de escritura necesita sus
  `UPDATE` condicionados por estado y un test que lo pruebe.

Esa discusión es un change propio. Este entrega la lectura, que es lo que desbloquea saber si
hace falta.

### 7. Una planta fuera del alcance devuelve lista vacía, no un error

No hay `404` que dar: la ruta no recibe el id de una persona. Un `site_id` ajeno devuelve cero
filas porque la política ya lo recorta, y devolver un error en ese caso convertiría el endpoint
en un oráculo de qué plantas existen. Es el mismo criterio de "no existe" y "está fuera de tu
alcance" comparten respuesta que documenta `requireActive` en `inspections.service.ts`.

### 8. `/roster`, ONLINE, fuera del precacheo

`CAPTURE_ROUTES` en `sw.ts` matchea `/^\/inspections\//`: colgar una pantalla online de ese
prefijo la metería en el precacheo del service worker y la haría "disponible" sin red,
mostrando datos que no puede traer. Mismo razonamiento ya escrito para `schedulingRoute`.
ADR-001, ADR-003.

Y fuera del outbox: una baja en cola es una persona que sigue apareciendo en el selector del
dispositivo de otro. El offline existe para que no se pierda el trabajo de campo, no para
diferir decisiones de coordinación. ADR-001.

### 9. Sin `ReadDescriptor`

El registro de lectura del auditor externo es sobre **registros**, y el coordinador leyendo su
propio roster no lo es. Además un `external_auditor` no llega a este endpoint (decisión 1).

## Risks / Trade-offs

- **El argumento de §4 R4 puede no aceptarse** → es el riesgo real del change y por eso está
  argumentado arriba en vez de asumido. Si se rechaza, no hay pantalla de roster y la
  administración se queda en `psql`; no hay un punto medio, porque un roster de solo lectura
  para roles no-coordinador es exactamente lo que la objeción prohíbe.
- **El coordinador ve el error y no lo puede arreglar acá** → un apellido mal escrito o una
  persona en la planta equivocada se siguen corrigiendo con `pnpm roster:import`. Es el costo
  aceptado de la decisión 5. Mitigación: la pantalla **dice** que el roster se mantiene por
  importación, para que quien lo ve sepa por dónde se arregla en vez de buscar un botón que no
  existe.
- **El `GET` exige `site_id`**, así que un coordinador con dos plantas no ve la organización
  entera de una vez y tiene que conmutar para verificar una transferencia → se acepta: el
  parámetro obligatorio es lo que acota la respuesta, que es la base de la decisión 3. La
  pantalla lo compensa recordando la planta elegida.
- **Se va a pedir "agregar una persona" a la semana de salir** → no se hace acá; el alta es del
  CSV, y la spec lo dice. Queda anotado.
- **La presión para agregar escritura va a llegar rápido**, y con ella la trampa del
  `IS DISTINCT FROM` de la decisión 5 → está documentada ahí para que quien la implemente no
  la descubra en producción, donde el daño (entradas falsas en un log encadenado) es
  permanente.
