## Context

Ver `proposal.md — Why`. Lo que condiciona el diseño es dónde está escrita hoy la
elegibilidad y con qué garantías:

- `apps/api/src/inspections/inspector-eligibility.ts` es el único lugar donde se dice qué
  hace que una cuenta pueda recibir una inspección, y existe justamente para que el
  listado de candidatos y la validación de la asignación no puedan divergir.
  `requireInspector` no comparte la decisión sino las condiciones, porque produce tres
  mensajes distintos y hay tests que los afirman.
- `app_user` es una tabla **parcialmente mutable** (ADR-002): sin UPDATE por default, con
  `GRANT UPDATE (columna)` concedido una por una en `0005_identity.sql`, más
  `hs_identity_guard()` congelando `id`, `person_id` y `created_at` contra cualquier rol.
- `app_user` no lleva política RLS —no tiene un sitio, tiene un alcance—, y su auditoría se
  escribe con `hs_account_audit_fanout()` en la cadena de CADA planta del alcance vigente,
  diferida a COMMIT.
- `app_user.person_id` es UNIQUE. No existe la opción de una segunda cuenta.

**Este change toca una tabla parcialmente mutable** (`app_user`): agrega una columna y la
concede por `GRANT UPDATE`, sin tocar las congeladas ni el guard.

## Goals / Non-Goals

**Goals:**

- Que el asiento en el JHSC sea un hecho de la cuenta, con su momento y su evento de
  auditoría, y que solo `hs_coordinator` pueda llevarlo — forzado por el motor.
- Que la elegibilidad de inspector siga siendo **un solo predicado compartido**.
- Que el acto viva en la consola del roster, junto a los otros tres que administran quién
  entra al JHSC.

**Non-Goals:**

- No se agrega ni se cambia ningún rol, y ninguna ruta de este change escribe `app_user.role`.
- No se toca la ingesta del envío, el paquete de campo ni la pantalla de captura: cuelgan de
  la inspección, no de la cuenta.
- No se reasignan inspecciones al quitar un asiento, ni se avisa a nadie.
- No se modela la composición del comité (siete asientos, mandatos, copresidencias): esto es
  un atributo de UNA cuenta, no un registro del JHSC.

## Decisions

### D1 — Una columna en `app_user`, no un rol nuevo ni una tabla de membresía

`jhsc_seat_granted_at timestamptz NULL` en `app_user`.

- **Contra un sexto rol** (`hs_coordinator_jhsc`): rompería la nota de vocabulario de §4 y
  el `CHECK` de cinco valores, y obligaría a revisar cada `role === 'hs_coordinator'` del
  sistema —permisos de roster, plantillas, catálogo, programación— para que el rol nuevo
  también los pasara. El asiento no es una cuenta distinta: es la misma coordinadora.
- **Contra una tabla `jhsc_membership`**: una fila por asiento con su alcance sería el
  modelo correcto si el sistema administrara el comité (mandatos, reemplazos, quórum), y no
  lo hace ni está en v1. Hoy la pregunta es booleana y por cuenta.
- **Contra un booleano**: el sistema registra *cuándo* pasó cada cosa (`deactivated_at`,
  `revoked_at`, `granted_at`). Un `timestamptz` nullable da el mismo `NULL` por default y
  además el momento, que es lo que la entrada de auditoría lleva en el payload.

Quitar el asiento vuelve la columna a `NULL`, y eso no pierde historia: el rastro es la
cadena de auditoría, igual que con `deactivated_at` y `revive()`.

### D2 — El `CHECK` que ata el asiento a `hs_coordinator`

`CHECK (jhsc_seat_granted_at IS NULL OR role = 'hs_coordinator')`.

Sin él, la columna sería una segunda puerta —más silenciosa que el rol— para volver
inspeccionable a un `management` o a un `supervisor`, que es exactamente lo que §4 no
permite. Con él, «se sienta en el JHSC» tiene dos casos y solo dos, y el segundo no puede
ampliarse por un `UPDATE` a mano. La guarda del servicio existe igual, pero para dar un 409
legible en vez de un 23514: la garantía es el `CHECK`.

Un `jhsc_member` no lleva asiento porque su rol YA es el asiento. Que la columna sea
inválida para él evita el estado ambiguo «miembro con y sin asiento».

### D3 — El predicado compartido crece, la función de validación conserva su forma

`inspector-eligibility.ts` gana `ACCOUNT_HOLDS_JHSC_SEAT` y compone
`ACCOUNT_SITS_ON_JHSC = (role = 'jhsc_member' OR jhsc_seat_granted_at IS NOT NULL)`, que es
lo que usa `isEligibleInspector`. `requireInspector` sigue proyectando las condiciones por
separado —ahora también el asiento— porque su valor es el mensaje: al coordinador sin
asiento hay que decirle que le falta el asiento, no que su rol no sirve. Colapsarlo en un
booleano compartido daría un «inspector inválido» y perdería el único dato accionable.

### D4 — El acto es un `PATCH /accounts/:id` solitario

El asiento entra en `updateAccountRequestSchema` —la ruta que administra el ACCESO de una
cuenta que ya tiene su rol— y no en una ruta propia: es un acto del coordinador sobre una
fila del roster, exactamente como quitar el acceso y como reemitir el link, y una ruta
nueva duplicaría las mismas guardas.

**Booleano en los dos sentidos**, a diferencia de `deactivated: z.literal(true)`. Aquella
es literal porque devolver el acceso NO es su inverso —es invitar de nuevo, y eso es
`POST /accounts`, que revive la cuenta—, así que un `false` hubiera abierto un segundo
camino a una intención que ya tenía el suyo. Acá no hay tal cosa: sentarse y levantarse son
el mismo acto reversible sobre la misma columna, y partirlos en dos rutas sería inventar una
asimetría que el dominio no tiene.

Un `refine` lo declara solitario: `jhsc_seat` no viaja con `deactivated` (contradicción:
darle un asiento a una cuenta que se está dando de baja), ni con `email`/`invite`
(decisiones distintas, con su propia guarda de `can_sign_in`, que el asiento no necesita).

### D5 — La coordinadora se otorga su propio asiento, y eso no necesita nada nuevo

`update()` ya exige que el actor sea `hs_coordinator`, y `asAdministrator` firma la
auditoría con su `userId`: la entrada dice, correctamente, que se sentó ella misma. **No se
copia el patrón de `withdraw`**, que después del COMMIT revoca sesiones: el asiento no da ni
quita acceso, y revocar la sesión de la coordinadora al sentarse la echaría de la pantalla
desde la que apretó el botón.

### D6 — El asiento viaja como booleano derivado, no como fecha

`personAccountSchema` gana `jhsc_seat: boolean` —proyectado como
`u.jhsc_seat_granted_at IS NOT NULL`— y no la fecha. La consola pregunta «¿está en el
comité?»; el «desde cuándo» es de la cadena de auditoría, que es donde se lee un registro
que se defiende ante un regulador. De paso, la fila del roster no crece con un dato que
doscientas filas llevarían sin usar.

### D7 — Quitar el asiento no toca las inspecciones ya asignadas

`scheduled_inspection.inspector_id` es una decisión tomada y auditada; el asiento gobierna
lo que se OFRECE y lo que se ACEPTA de ahí en más. Reasignar en cascada al levantarse
sería una escritura masiva sin actor claro, y borrar la asignación dejaría el período sin
dueño en silencio. `pendingFor` filtra por `inspector_id` y no por rol, así que la persona
sigue viendo lo que debe y puede terminarlo. Lo que hace falta es que el diálogo lo diga,
para que nadie use «levantarse del comité» creyendo que reasigna.

## Risks / Trade-offs

- **Un `hs_coordinator` con asiento aparece como candidato en TODAS las plantas de su
  alcance** → Es correcto: el alcance ya es lo que decide dónde puede actuar, y la
  coordinadora que cubre dos plantas se sienta en los dos comités o en ninguno. Si algún día
  hiciera falta un asiento por planta, el modelo que corresponde es D1-alternativa (tabla de
  membresía con `site_id`), no un segundo booleano.
- **La columna vuelve a `NULL` al quitar el asiento y se pierde «cuándo se levantó» en la
  fila** → La cadena de auditoría lleva los dos eventos con su momento; la fila dice el
  estado de hoy, que es para lo que se lee.
- **Dos lugares dicen quién se sienta en el comité (el rol y la columna)** → Es el costo de
  no tocar el rol. Lo acota el `CHECK`: la columna solo puede ser no-nula para un rol, así
  que la combinación «miembro con asiento» no existe y la lectura tiene una sola respuesta.
- **La coordinadora puede sentarse sola, sin segunda firma** → Es la misma autoridad que ya
  tiene para invitar y para sacar del JHSC a cualquiera, y la segunda firma está fuera de
  alcance en v1. Lo que lo hace revisable es la entrada de auditoría en cada planta.

## Migration Plan

`0035_coordinator_jhsc_seat.sql`, hacia adelante y sin backfill: ninguna cuenta existente
tiene asiento, y el `NULL` por default es exactamente el estado de hoy. Los tres pasos son
`ALTER TABLE ... ADD COLUMN` + `CHECK`, `GRANT UPDATE (jhsc_seat_granted_at) ON app_user TO
hs_app`, y `CREATE OR REPLACE FUNCTION hs_account_changed_audit()` con una rama más — la
función se reemplaza entera, con las cuatro ramas que ya tiene, porque `CREATE OR REPLACE`
no compone.

Nada de esto rompe una versión anterior del código corriendo contra el esquema nuevo: la
columna es nullable y nadie la lee todavía. `audit_log.event_type` es texto sin enumeración,
así que los dos eventos nuevos no requieren ampliar ningún `CHECK`.
