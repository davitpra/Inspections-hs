# Consola de programación: el coordinador asigna, reprograma y cancela desde la aplicación

## Why

**Este change no cierra ninguna etapa de §7, y `openspec/config.yaml` pide justificar por qué
existe.** La justificación es que una etapa ya declarada completa no lo está del todo.

La tabla de §7 dice que la etapa 4 deja «R1 y R2 completos». Pero R1 empieza, textualmente
(`docs/Requisitos_V1.2.md`, §3): «Un miembro del JHSC **recibe la inspección asignada** de su
sitio para el período». El acto que convierte una inspección en *asignada* nunca tuvo superficie.

La cadena está construida y probada de punta a punta salvo ese eslabón:

- `inspection_schedule` declara la obligación mensual; el seed `005_inspection_schedules.sql`
  la siembra **sin `default_inspector_id`, a propósito** —el único usuario sembrado es el
  coordinador, y un coordinador no es `jhsc_member`, así que sembrar un inspector inventado
  crearía una asignación que ninguna persona real puede cumplir—.
- El trabajo `inspections.open-period` abre el período y copia ese `default_inspector_id`. Si es
  nulo, la inspección nace con `inspector_id` nulo.
- `pendingFor()` filtra `WHERE si.inspector_id = $1`. Una inspección sin inspector **no está en la
  lista de nadie**, y ninguna pantalla la nombra.

El coordinador recibe la notificación `inspection_period_opened` en `/inbox`, que le avisa
exactamente de esto, y su única salida es curl. `PATCH /scheduled-inspections/:id/inspector`
existe, tiene `requireCoordinator`, valida el inspector contra `user_site_scope`, escribe la
entrada de auditoría con los dos valores — y no hay dónde llamarlo.

Lo mismo vale para el resto de la superficie: `GET/POST /inspection-schedules`,
`PATCH /inspection-schedules/:id`, `GET/POST /scheduled-inspections` y
`POST /scheduled-inspections/:id/cancel` están implementados, tienen sus reglas de rol y su
auditoría, y **ninguno tiene pantalla**. `apps/web/src/api/` no tiene módulo de inspecciones y el
router no nombra ninguna de esas rutas.

Este change no agrega capacidades ni verbos: cierra la distancia entre endpoints que ya existen y
una etapa que ya se declaró terminada.

**Y no es una porción anticipada de la etapa 8.** La etapa 8 es el builder visual de *plantillas*
—crear y publicar el contenido del checklist—, que sigue fuera del recorrido crítico y sigue
resolviéndose con seeds en SQL. Administrar *cuándo* y *quién* no es administrar *qué se pregunta*.

## El bug que este change vuelve alcanzable

`InspectionsService.createSchedule` inserta en `inspection_schedule` sin capturar `23505`. La
migración 0008 tiene el único parcial `inspection_schedule_active_uq` sobre
`(site_id, template_id) WHERE deactivated_at IS NULL`, y la spec ya declara el escenario «A second
active rule for the same site and template is rejected». Por el endpoint, hoy, esa violación sale
como un error sin mapear: **un 500**.

Nadie lo notó porque no hay formulario. El día que lo haya, el segundo click en «New rule» es un
crash. Entra al alcance por las dos puntas: se mapea en el servidor y el selector de plantillas
excluye las que ya tienen regla activa en ese sitio.

## Lo que este change NO es

**No es administración de plantillas.** No se crea, edita ni publica ninguna. La consola las
*elige*, y solo entre las que ya tienen versión publicada.

**No es administración de cuentas ni de roster.** No se crean usuarios, no se otorga ni revoca
alcance de sitio, no se importa roster. La consola *lista* los candidatos a inspector según la
regla que ya existe, y nada más.

**No es un calendario.** No hay vista de mes arrastrable, no se mueve un período de fecha, no se
programa fuera del mes. `period_start` sigue siendo el día 1 y el planificador diario sigue siendo
quien abre. La consola muestra lo que hay y cambia el inspector o lo cancela con motivo.

**No es un lugar donde algo se edite.** Cancelar no se deshace, una regla no se borra —se
desactiva— y `template_version_id` sigue congelada. La consola no gana ni un verbo de escritura
que la API no tuviera.

## What Changes

- **La pantalla del coordinador, `/scheduling`**, con dos secciones: las reglas de recurrencia del
  sitio y las inspecciones programadas con su estado. Una sola ruta y no dos, porque «qué debe esta
  planta» y «quién lo está haciendo» son la misma pregunta, y separarlas obliga a llevar un UUID
  de una pantalla a la otra.

- **Lo que no tiene inspector se nombra como tal.** Una inspección con `inspector_id` nulo se lista
  y se marca, en vez de existir sin aparecer en ningún lado. Es la fila que el change existe para
  hacer visible.

- **El estado del período pasa a estar en el listado, con una sola derivación.**
  `openspec/specs/inspections/spec.md` ya exige el estado «for every non-cancelled
  `scheduled_inspection`», y hoy eso solo se honra a través de `COMPLIANCE_PERIODS_SQL`, que exige
  `site_id` explícito y rangos de meses enteros — inservible para un listado. El `CASE` se extrae a
  un módulo y lo consumen **las dos** consultas. Una sola copia de la frontera `America/Toronto`.

- **La superficie de programación nombra personas, no identificadores.** `inspector_name` y
  `default_inspector_name` acompañan a los ids. Se resuelven **en el servidor y no en el cliente**,
  porque una asignación es un hecho histórico: si el asignado se desactivó o perdió el alcance,
  correctamente ya no está entre los candidatos, y resolver el nombre contra esa lista imprimiría
  un UUID crudo justo en las filas que el coordinador más necesita arreglar.

- **Tres lecturas de apoyo que la API no tenía**: `GET /sites` (las plantas del alcance de la
  sesión), `GET /templates` (las que tienen versión publicada, con la versión que el planificador
  congelaría) y `GET /inspector-candidates?site_id=` (las cuentas elegibles para ser asignadas).

- **La lista de candidatos y la validación de la asignación comparten predicado.** No es una
  preferencia de estilo: si divergen, la pantalla ofrece cuentas que el `PATCH` después rechaza con
  `inspector_invalid`, que es el peor modo de falla posible de una UI de asignación. El predicado
  —`jhsc_member`, no desactivado, con `user_site_scope` vigente en ese sitio— se escribe una vez y
  lo consumen las dos, con un test que las ata.

- **Una regla duplicada se rechaza con un motivo, no con un fallo sin manejar.**

## Capabilities

### Modified Capabilities

- `inspections`: el estado de cumplimiento pasa de ser una lectura del reporte a ser parte de todo
  listado de inspecciones programadas, derivado de una expresión compartida; se agrega la lectura
  de candidatos a inspector con el mismo predicado que la asignación; se declara que una
  inspección sin inspector se lista e identifica en vez de desaparecer; se declara que la
  superficie nombra personas; y la regla duplicada gana su respuesta.
- `catalog`: una cuenta puede listar los sitios de su propio alcance. El requisito dice en su
  cuerpo que `site` no lleva política RLS **por decisión escrita** (migración 0004: pondría un
  arranque circular a cambio de esconder que la otra planta existe, que no es lo que protege §6
  pregunta 5 — «el aislamiento empieza en `location`»), y que por eso el recorte por alcance es
  selección y no un rodeo a la política.
- `templates`: las plantillas que se ofrecen para programar son exactamente las que tienen versión
  publicada, a la versión que el planificador congelaría.

### New Capabilities

Ninguna. Las tres capabilities existen y este change las completa donde estaban a medias.

## Impact

- **Esquema**: **ninguno.** No hay migración. `GRANT SELECT` sobre `site`, `template`,
  `template_version`, `app_user` y `user_site_scope` ya está otorgado a `hs_app` en 0003, 0004 y
  0005. No se toca ninguna tabla inmutable y no se agrega ninguna política. La regla de
  `openspec/config.yaml` sobre migraciones con REVOKE/RLS queda vacía, y conviene decirlo en vez de
  callarlo.
- **`packages/contracts`**: `templates.ts` nuevo con `templateOptionSchema`; `inspectorOptionSchema`
  y el `status` y los nombres nullable en `inspections.ts`. `siteSchema` de `catalog.ts` gana su
  primer consumidor después de haber estado escrito sin uso.
- **`apps/api`**: tres módulos tocados y dos nuevos y chicos (`catalog/`, `templates/`). Tres
  extracciones sin cambio de comportamiento —la versión publicada más alta, el `CASE` del estado y
  el predicado de elegibilidad—, que aterrizan **antes** que nada nuevo para que el guard de
  regresión signifique algo.
- **`apps/web`**: `api/inspections.ts` nuevo, `SchedulingRoute` y su módulo de presentación, y el
  primer link de navegación condicionado por rol — que es un precedente y se deja escrito como tal.
- **Auditoría**: sin tipos de evento nuevos. Las escrituras que la consola dispara ya escriben sus
  entradas desde el trigger `inspection_schedule_audit` de 0008.

## Estado al cerrar

R1 arranca desde la aplicación. Un coordinador que recibe `inspection_period_opened` puede abrir
`/scheduling`, ver la inspección que nació sin dueño, asignarla, y que aparezca en el pendiente del
inspector — sin curl y sin SQL.

De §7 sigue quedando solo la **etapa 8**, el builder visual, exactamente donde estaba.
