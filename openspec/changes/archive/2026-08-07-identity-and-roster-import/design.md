## Context

Ver `proposal.md` — Why. Lo que ya está puesto y este change consume tal cual:

- `hs_make_immutable(regclass)` y `hs_apply_site_isolation(regclass)` de
  `0001_immutability_mechanism.sql` (ADR-002, ADR-004). El segundo ya tiene un consumidor,
  `location`, y su comportamiento —`FORCE ROW LEVEL SECURITY`, política sobre `site_id`, sin
  alcance no se ve nada— está probado contra datos de dos sitios.
- SQLSTATE `HS001` como código propio de los triggers del proyecto, distinto de `42501`, para
  poder afirmar en los tests cuál de las dos barreras frenó la sentencia.
- `withSiteScope` (`apps/api/src/db/site-scope.ts`), que fija `app.site_ids` y `app.user_id` con
  `set_config(..., true)`. Hoy `app.user_id` es un uuid arbitrario que nadie valida; este change
  lo convierte en un `app_user.id` con FK.
- El patrón de mutabilidad parcial de `location` y `template_item`: `GRANT UPDATE (columnas)` para
  frenar a `hs_app` con `42501`, más un `BEFORE UPDATE` que frena a **cualquier** rol —
  `hs_migrator` incluido — con `HS001`.
- El patrón de auditoría por trigger de `hs_catalog_audit()` (0004 §4): el actor sale de
  `app.user_id`, el `INSERT` corre bajo la política de `audit_log` porque la función es
  `SECURITY INVOKER`, y `seq`/`prev_hash`/`hash` los sobrescribe el trigger de la cadena de 0002.
- `audit_log` con `site_id NOT NULL` y FK a `site`, y `actor_user_id uuid` **sin FK**, con el
  comentario de 0002 que dice que la referencia llega cuando exista la tabla de cuentas.
- Migraciones escritas a mano y registradas a mano en `_journal.json`. `drizzle-kit generate`
  prohibido (ADR-004).
- Suite de integración con Testcontainers que levanta el mismo `db/init/01-roles.sql` que
  `docker-compose.yml`.

**Tablas inmutables que este change toca:**

- `audit_log` — solo con `ALTER TABLE ... ADD CONSTRAINT` para la FK de `actor_user_id`. No hay
  `UPDATE` ni `DELETE` de filas, y `actor_user_id` ya entra en `hs_audit_canonical` con el mismo
  valor de siempre, así que ningún hash cambia y la verificación de la cadena da lo mismo antes y
  después de la migración.
- `roster_import` y `roster_import_rejection` — **nuevas y totalmente inmutables**, con
  `hs_make_immutable`. Un reporte de importación que se puede editar no es un reporte.
- `person`, `app_user` y `user_site_scope` son **parcialmente mutables** y no llevan
  `hs_make_immutable`: llevan su propio trigger, como el catálogo.

Dos restricciones ordenan el diseño:

1. **Sin auth no hay actor autenticado.** Cualquier cosa que se apoye en "el coordinador hace X"
   es, hoy, una afirmación sin sujeto. Por eso no hay endpoints y por eso la importación es un
   comando de servidor. Lo que sí se puede construir hoy —y es lo que bloquea a las etapas 4 a
   6— es *quién existe* y *qué alcanza*.
2. **`audit_log.site_id` es `NOT NULL`.** Toda tabla de este change que quiera auditarse tiene
   que poder responder "¿de qué sitio es este hecho?". `person` responde sola; una cuenta no, y
   eso obliga a una decisión explícita (D7).

## Goals / Non-Goals

**Goals:**

- Que sea imposible representar el estado que reintroduce el segundo dolor de Atlas: una persona
  que para existir en el roster necesita una cuenta.
- Que "quién puede ver qué sitio" sea un dato con FK y con historia, no un arreglo en una fila ni
  una constante en el código.
- Que el ciclo de vida del auditor externo sea imposible de violar desde cualquier vía de
  escritura, incluida una corrección a mano en `psql`.
- Que una importación de 200 filas con 3 malas termine en un estado que el coordinador pueda
  explicar: 197 aplicadas, 3 rechazadas con motivo y número de fila, cero filas a medias.
- Que el change de auth encuentre la identidad ya construida y tenga que agregar exactamente una
  cosa: la credencial.

**Non-Goals:**

- Cualquier endpoint HTTP o pantalla. Esquema, contrato Zod, módulo importador y comando.
- Decidir la configuración de better-auth. Acá se decide únicamente que la identidad de dominio
  vive en `app_user` y que no va a haber una segunda copia del email (D2).
- Un modelo de permisos por recurso o por acción. El rol es un valor; qué habilita cada rol lo
  van a decidir los changes que tengan endpoints, apoyándose en el rol y en el alcance que este
  change deja disponibles.
- La ventana de fechas del auditor aplicada a una consulta. Las columnas y su validación están
  acá; el filtro es del change que le dé al auditor algo que leer.

## Decisions

### D1 — La tabla se llama `app_user`, no `user`

`user` es palabra reservada en Postgres: `CREATE TABLE user` no compila y toda referencia
posterior tendría que ir entre comillas para siempre, lo cual se olvida exactamente una vez y
rompe una migración. Además, better-auth crea su propio conjunto de tablas y `user` es el nombre
por defecto de una de ellas: dejarlo libre evita tener que resolver la colisión bajo presión en
el change de auth.

`person` sí se llama `person`, que no es reservada, y es la palabra de `docs/Requisitos_V1.2.md`
§4.

*Alternativa descartada:* `"user"` entre comillas, o `hs_user`. La primera es una trampa; la
segunda prefija con el proyecto una sola tabla de veinte.

### D2 — La cuenta apunta a la persona, y el email vive una sola vez

`app_user.person_id` es `NOT NULL UNIQUE` y es inmutable. La dirección de la referencia importa:
si fuera `person.user_id`, la persona tendría una columna que el 92 % del roster deja nula y que
insinúa que la cuenta es parte de ser persona. Con la referencia en la cuenta, la persona no sabe
que las cuentas existen, que es exactamente la distinción de §4.

`UNIQUE` sobre `person_id` es lo que prohíbe la cuenta compartida y la segunda cuenta "de
administración" de la misma persona. ADR-011 lo pide por nombre: si el `actor_id` no identifica a
una persona real, la inmutabilidad no prueba nada.

El `email` va en `app_user` —único, en minúsculas por `CHECK`, con `CHECK` de formato mínimo— y
esta es la única copia del sistema. Cuando llegue better-auth (ADR-011), se configura para usar
`app_user` como su modelo de usuario y agrega solo lo suyo: credencial, sesión y segundo factor.
La alternativa —tabla de better-auth propia con su propio `email` y una FK a `app_user`— crea dos
verdades sobre la misma dirección y la pregunta "¿cuál gana?" no tiene respuesta buena.

*Alternativa descartada:* email en `person`. La mayoría del roster no tiene email de trabajo y no
lo va a tener; sería una columna casi siempre nula que además invita a mandarle cosas a gente que
no es usuaria del sistema.

### D3 — `person` lleva RLS por sitio; `app_user` y `user_site_scope` no

`person` es contenido operativo de un sitio: quién trabaja en esta planta. Es además la tabla que
alimenta el selector de sujeto de un incidente, y la pregunta cerrada 5 dice que un supervisor de
St. Thomas no tiene por qué ver Glencoe. Lleva `hs_apply_site_isolation('person')` y es el segundo
consumidor real del helper.

`app_user` no tiene un sitio: tiene un alcance, que puede ser de dos. Ponerle RLS exigiría inventar
una política sobre la tabla de alcance —"veo las cuentas que comparten al menos un sitio conmigo"—
que responde una pregunta que nadie hace: la lista de cuentas la administra el coordinador, que
tiene los dos sitios de todos modos. Es el mismo razonamiento que dejó a `site` sin política en el
change anterior (design D1 de 2a): la tabla es dato de organización, no contenido de un sitio.
`user_site_scope` va con ella, porque una política sobre el alcance que se lee para *construir* el
alcance es un arranque circular.

Consecuencia declarada, y va comentada en la migración: **cualquier rol conectado puede leer la
lista de cuentas.** Que solo el coordinador la administre lo va a exigir el endpoint del change de
auth, y hasta que ese endpoint exista la superficie es cero. Lo que este change sí niega en el
motor es `DELETE` sobre las tres tablas y `UPDATE` sobre todo lo que no sea el conjunto acotado.

### D4 — El alcance son filas con `granted_at`/`revoked_at`, no un arreglo

`user_site_scope (user_id, site_id, granted_at, revoked_at)`, con único **parcial** sobre
`(user_id, site_id) WHERE revoked_at IS NULL`. El alcance efectivo es el conjunto de filas con
`revoked_at` nulo.

Un `site_ids uuid[]` en `app_user` sería una columna sin FK —Postgres no puede referenciar
elementos de un arreglo—, así que un id inexistente entraría sin error, y quitar un sitio sería
sobrescribir la columna: la revocación no dejaría rastro. Con filas, el "quién tenía acceso a
Glencoe en marzo" se contesta leyendo la tabla, que es justo la pregunta de la métrica de §2
("auditoría trimestral de roles vs. sitio de operación").

Revocar es `UPDATE revoked_at`, nunca `DELETE`: la invariante del proyecto no tiene excepciones y
acá tampoco. El único parcial es lo que permite volver a otorgar un sitio revocado sin chocar
contra la fila vieja — mismo patrón que el nombre activo de `location`.

*Alternativa descartada:* borrar la fila al revocar. Es un `DELETE` en un proyecto que no tiene
`DELETE`, y borra exactamente el dato que la auditoría trimestral necesita.

### D5 — Un rol por cuenta, como `CHECK` sobre texto

`role text NOT NULL CHECK (role IN ('hs_coordinator','jhsc_member','supervisor','management',
'external_auditor'))`.

*Un* rol y no un conjunto: con 15 a 20 usuarios, un conjunto convierte cada pregunta de permisos
en una unión que hay que evaluar y que nadie puede auditar de un vistazo, y la tabla de §4 asigna
un rol por persona. Si alguien es supervisor y miembro del JHSC a la vez, el rol es el que
determina qué hace en el sistema y la decisión la toma el coordinador, explícitamente y con un
evento de auditoría, no acumulando permisos por acumulación.

`CHECK` sobre texto y no `CREATE TYPE ... AS ENUM`: agregar un valor a un enum es fácil, pero
quitarlo o renombrarlo requiere recrear el tipo y todas las columnas que lo usan, y el conjunto de
roles es exactamente el tipo de cosa que se ajusta en la v2. Tampoco tabla `role` con FK: cinco
valores fijos que el código conoce por nombre no ganan nada por ser filas, y sí pierden — una
tabla de roles invita a que alguien cree el sexto sin pasar por una migración.

`jhsc_member` cierra la nota de vocabulario de §4: "inspector" no es un rol. Queda libre para ser
`inspection.inspector_id`, que es un campo, no un permiso.

### D6 — El ciclo de vida del auditor externo es un `CHECK`, no una regla de servicio

Riesgo I de §5 y ADR-011 fijan cuatro cosas: `expires_at` obligatorio, default 30 días, máximo 90,
sin renovación automática. Tres de las cuatro son restricciones de datos y van al motor:

```sql
CHECK (
  (role <> 'external_auditor' AND expires_at IS NULL
     AND records_from IS NULL AND records_to IS NULL)
  OR
  (role = 'external_auditor' AND expires_at IS NOT NULL
     AND expires_at <= created_at + interval '90 days'
     AND records_from IS NOT NULL AND records_to IS NOT NULL
     AND records_from <= records_to)
)
```

El default de 30 días es lo único que no es una restricción sino una sugerencia, y vive en el
contrato Zod: el motor no puede distinguir "no lo pusiste" de "pusiste 30".

Va en el motor y no en el servicio porque una cuenta de auditor externo es lo único de este
sistema que le da acceso a los registros a alguien de afuera. Una regla de servicio se saltea con
un `INSERT` a mano el día que haya que arreglar algo apurado; un `CHECK` no.

"Expirada" es una condición de tiempo, no una columna: la cuenta se considera inactiva cuando
`deactivated_at IS NOT NULL OR (expires_at IS NOT NULL AND expires_at <= now())`. Se expone como
vista o como predicado compartido, nunca copiado en cada consulta.

*Alternativa descartada:* un job de pg-boss que ponga `deactivated_at` al vencer. Agrega una pieza
móvil para derivar algo que una comparación ya deriva, y si el job no corre, la cuenta sigue viva
— exactamente el fallo que la regla existe para prevenir.

### D7 — Un evento de cuenta se escribe una vez por cada sitio de su alcance

`audit_log.site_id` es `NOT NULL` y la cadena es por sitio (0002). Una cuenta no tiene sitio, así
que "cuenta creada" no tiene una cadena obvia donde ir. Las tres salidas posibles:

1. Hacer `site_id` nullable. Rompe el encadenado —una cadena sin sitio es una cuarta cadena— y
   toca una tabla inmutable en su columna más estructural. Descartada sin más.
2. Una cadena "de organización" con un sitio sintético. Inventa una fila de `site` que no es una
   planta y ensucia todo lo que agrupa por sitio.
3. **Escribir el evento en la cadena de cada sitio del alcance de la cuenta.** Es la elegida.

La razón no es que sea la que sobra: es la que dice la verdad. "A esta persona se le dio acceso a
St. Thomas el 12 de marzo con rol de supervisor" es un hecho **de St. Thomas**, y el registro
regulatorio de St. Thomas es exactamente donde un inspector del MLITSD lo va a buscar. Que el
mismo hecho aparezca en las dos cadenas cuando el alcance es de dos sitios no es duplicación: son
dos afirmaciones distintas sobre dos lugares de trabajo distintos.

Los eventos de alcance (`grant`, `revoke`) van solo a la cadena del sitio otorgado o revocado, que
es el único que cambia.

Consecuencia declarada: **una cuenta creada sin ningún alcance activo no escribe evento de
auditoría**, porque no alcanza ninguna planta. Está en el spec como escenario y va comentada en el
trigger para que no parezca un hueco. El flujo normal —y el seed de bootstrap— crea la cuenta y su
alcance en la misma transacción; el evento de `grant` deja el rastro igual.

### D8 — `person` es parcialmente mutable, y la transferencia de planta es uno de los cambios permitidos

`GRANT UPDATE (first_name, last_name, site_id, deactivated_at) ON person TO hs_app`, más un
`BEFORE UPDATE` que rechaza con `HS001` cualquier cambio de `id`, `employee_number` o `created_at`.

`site_id` mutable es la decisión que hay que justificar, porque en `location` la columna análoga es
inmutable. La diferencia es física: una ubicación no se muda de planta, una persona sí. Si `site_id`
fuera inmutable, transferir a alguien exigiría una segunda fila con el mismo `employee_number`, que
choca contra el único, o inventar un `employee_number` nuevo, que parte el historial de la persona
en dos justo donde tiene que estar entero.

El movimiento queda acotado por la propia política RLS: el `WITH CHECK` exige que el `site_id`
nuevo esté en el alcance de la transacción, así que solo alguien con las dos plantas —el
coordinador— puede transferir, sin que ningún endpoint tenga que verificarlo.

### D9 — Ninguna FK compuesta `(site_id, person_id)`, a diferencia del catálogo

El change del catálogo dejó `UNIQUE (site_id, id)` en `location` para que toda tabla con ubicación
declarara `FOREIGN KEY (site_id, location_id) REFERENCES location (site_id, id)` y una inspección
de St. Thomas con una ubicación de Glencoe fuera un error de FK.

**Con `person` no se hace, y es a propósito.** Esa FK compuesta congela el par (sitio, fila) para
siempre: sería incompatible con D8, porque transferir a alguien invalidaría retroactivamente todos
los incidentes que lo nombran — o peor, `ON UPDATE CASCADE` los reescribiría, que es exactamente lo
que un registro inmutable no puede permitir. Un incidente de St. Thomas de 2026 tiene que seguir
diciendo "el sujeto fue esta persona" aunque en 2027 esa persona trabaje en Glencoe.

La garantía que sí se sostiene es de **selección**, no estructural: el selector de sujeto solo
ofrece personas activas visibles bajo el alcance de la transacción, y eso lo aplica la política RLS
de `person`, no un `WHERE`. Las tablas de las etapas 4 a 6 referencian `person(id)` a secas.

Queda escrito acá porque es la clase de asimetría que, sin explicación, el próximo change corrige
"por consistencia" y rompe el historial.

### D10 — La importación es un comando de servidor, con el parseo separado de la escritura

Dos piezas:

- **`parseRosterCsv(text)`** — función pura, sin base de datos y sin NestJS: recibe el contenido y
  devuelve `{ rows, rejections }`. Valida encabezado, formato de `employee_number`, nombres
  presentes, `status` en `{active, inactive}` y duplicados dentro del archivo. Es donde vive la
  numeración de filas 1-based que el reporte necesita, y es lo que se puede testear sin levantar
  Postgres.
- **`applyRoster(rows, scope)`** — la escritura, en una transacción con `withSiteScope`. Resuelve
  `site_code` contra `site` (rechazo si no existe o si cae fuera del alcance), hace el upsert por
  `employee_number` y escribe `roster_import` con sus `roster_import_rejection`.

Encima, `pnpm roster:import <archivo.csv>`, un script como `seed.mjs`. Sin endpoint: sin auth no
hay coordinador autenticado a quien exigirle nada, y un endpoint de administración sin dueño es
superficie regalada. Cuando el change de auth traiga el guard de rol, el endpoint llama a las
mismas dos funciones y no se reescribe nada.

CSV se parsea con un parser real, no con `split(',')`: los apellidos con coma entre comillas y los
`\r\n` de un export de Excel son el caso normal, no el borde. Se descarta el BOM de UTF-8 si viene.

### D11 — Una sola transacción, y el rechazo es un dato y no una excepción

Todo el `applyRoster` —las filas aceptadas, la fila de `roster_import` y las de
`roster_import_rejection`— confirma junto. Si algo falla de verdad (la conexión, una restricción
inesperada), no queda nada: ni personas a medias ni un reporte que describa un estado que no
existe.

Las filas rechazadas **no** abortan la transacción: son parte del resultado esperado. Un archivo de
ADP con tres filas viejas es lo normal, y el comportamiento correcto es aplicar 197 y explicar 3,
no rechazar 200. Esa es la diferencia entre un importador que se usa y uno que el coordinador
abandona a la segunda vez.

Detalle de implementación que esto obliga: la validación por fila corre **antes** de tocar la base
para todo lo que no requiere la base, y los rechazos que sí la requieren —`site_code` inexistente,
sitio fuera del alcance— se resuelven con una sola lectura de `site` al inicio, no con un `INSERT`
que falla y hay que atrapar. Un `INSERT` fallido dentro de una transacción la aborta entera en
Postgres salvo con savepoints, y un savepoint por fila para 200 filas es caro y frágil.

### D12 — El upsert es por `employee_number`, y la ausencia no da de baja

`ON CONFLICT (employee_number) DO UPDATE SET first_name, last_name, site_id, deactivated_at`. La
identidad del roster es el número de ADP (§4), así que el mismo número es la misma persona aunque
cambien el apellido y la planta.

La ausencia de una fila **nunca** cambia nada. La baja viene de `status = inactive` en una fila
presente. El motivo es concreto: alguien va a exportar de ADP con un filtro puesto y va a subir un
archivo con 40 filas en lugar de 200. Con la regla contraria —"lo que no está, se da de baja"— ese
día se desactivan 160 personas y desaparecen de todos los selectores; con esta, no pasa nada. El
costo es que dar de baja requiere una fila explícita, lo cual es trabajo del coordinador una vez
por baja, y es el lado correcto en el que equivocarse.

### D13 — La FK de `actor_user_id`, y lo que le rompe a los tests que ya existen

`ALTER TABLE audit_log ADD CONSTRAINT audit_log_actor_user_id_fkey FOREIGN KEY (actor_user_id)
REFERENCES app_user (id) ON DELETE NO ACTION`, nullable como está: seeds, migraciones y eventos de
motor no tienen usuario detrás, y ADR-011 pide que cuando *haya* actor sea una persona real.

`ADD CONSTRAINT` sobre una tabla inmutable es legal —`hs_make_immutable` bloquea `UPDATE`, `DELETE`
y `TRUNCATE` de filas, no DDL del dueño— y `actor_user_id` ya forma parte de `hs_audit_canonical`
con el mismo valor, así que ningún hash cambia.

Lo que sí cambia: los tests de auditoría de las etapas 0 y 2a fijan `app.user_id` con un uuid
inventado. Con la FK puesta, esos `INSERT` empiezan a fallar. Se arregla en el helper de fixtures —
una persona y una cuenta sembradas, y el uuid inventado reemplazado por el de esa cuenta— y no
tocando la restricción. El seed `004_bootstrap_coordinator.sql` cubre el mismo hueco fuera de los
tests: sin una primera cuenta, el change de auth no tiene a quién invitar y el sistema no arranca.

## Risks / Trade-offs

- **El fan-out de D7 escribe N entradas por evento de cuenta** → Con dos sitios, N vale 2. El
  costo es nulo y el trigger se escribe con un bucle sobre el alcance activo, no con dos ramas
  cableadas, para que un tercer sitio no requiera tocarlo.
- **Una cuenta sin alcance no deja rastro de auditoría al crearse** → Consecuencia aceptada de
  D7, con escenario propio en el spec y comentario en el trigger. El flujo normal crea alcance en
  la misma transacción y el evento de `grant` cubre el hecho.
- **`app_user` legible por cualquier rol conectado (D3)** → No hay endpoint que la exponga en este
  change, así que la superficie real es cero. Queda anotado como lo primero que el change de auth
  tiene que cerrar cuando aparezca el primer endpoint de administración.
- **El único sobre `person_id` prohíbe la segunda cuenta de la misma persona** → Es lo que pide
  ADR-011. Si algún día hiciera falta una cuenta de servicio, va a ser una cuenta sin persona y va
  a requerir una decisión explícita, que es como tiene que ser.
- **200 filas producen ~200 entradas de auditoría encadenadas en una transacción** → La cadena de
  0002 serializa por sitio con un lock, así que la importación toma el lock del sitio durante toda
  la transacción. Con 200 filas y una importación manual por mes es irrelevante; queda medido en
  el test de importación para que si alguna vez son 5.000 filas, el número esté a la vista antes
  de que sea un problema.
- **El `CHECK` de 90 días usa `created_at`, no `now()`** → Un `CHECK` con `now()` no es inmutable y
  Postgres lo rechaza. Consecuencia: una cuenta de auditor no se puede "extender" con un `UPDATE`
  de `expires_at` más allá de los 90 días desde su creación, ni siquiera renovándola. Es
  exactamente lo que pide "sin renovación automática": renovar es crear una cuenta nueva, con su
  propio evento de auditoría.
- **El email en `app_user` presupone cómo se configura better-auth (D2)** → Si better-auth
  resultara imposible de apuntar a `app_user`, el change de auth tendría que agregar su tabla y
  mantener el email sincronizado. El riesgo se acota verificando esa configuración en el spike del
  change de auth, antes de escribir sus migraciones; nada de este change se invalida si hay que
  cambiarla.

## Migration Plan

1. `apps/api/drizzle/0005_identity.sql`, escrita a mano, registrada a mano en `_journal.json`.
   Aplica sobre la base existente sin tocar datos: crea tablas nuevas y agrega una FK a
   `audit_log`.
2. `apps/api/seeds/004_bootstrap_coordinator.sql`, idempotente: una `person` y un `app_user` de
   coordinador con alcance a los dos sitios, sin credenciales. Declara `app.site_ids` como todo
   seed que toque una tabla con RLS.
3. Helpers de test y fixtures existentes: reemplazar el `app.user_id` inventado por el de la
   cuenta sembrada, antes de correr la suite completa.
4. `pnpm db:reset && pnpm db:migrate && pnpm db:seed` tiene que dejar la base con las dos plantas,
   sus ubicaciones, la plantilla inicial y la cuenta de bootstrap.
5. Rollback: no hay entorno desplegado todavía, así que el rollback es `pnpm db:reset`. A partir
   del primer despliegue, ninguna de estas tablas se puede revertir sin perder registro — que es
   la propiedad, no el defecto.
