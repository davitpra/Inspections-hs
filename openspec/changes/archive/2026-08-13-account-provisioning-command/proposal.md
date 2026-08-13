## Why

Dar de alta a un miembro del JHSC hoy termina en `psql`. Emitir la invitación ya tiene
comando (`pnpm auth:bootstrap`) y aceptarla ya tiene pantalla (`/accept-invitation`), pero
el paso previo —crear el `app_user` y su `user_site_scope`— no existe en ninguna parte
salvo un seed, un script de demo y SQL escrito a mano.

Ese SQL no es una línea. Las dos inserciones tienen que ir en la misma transacción con
`app.site_ids` y `app.user_id` ya declarados, porque el trigger de alta está diferido a
`COMMIT` para encontrar el alcance otorgado. Hecho mal —en dos transacciones, o con una
planta fuera del alcance declarado— el alta **funciona igual pero no escribe auditoría**,
o frena con `HS002` sin explicar por qué. Es un procedimiento manual, correcto solo si
quien lo ejecuta se acuerda de una regla que no está escrita en ningún lado, y el costo de
equivocarse es un hueco silencioso en la cadena de auditoría.

**Etapa de §7: ninguna.** La etapa 2 (Sitio, Persona, Usuario, auth, roster) está cerrada y
este change no la reabre: no agrega comportamiento al sistema, solo pone detrás de un
comando lo que hoy se hace a mano. Existe porque el alta es la única operación rutinaria
del sistema que todavía necesita al desarrollador y una consola de base de datos.

## What Changes

- **Nuevo comando `pnpm auth:create-account`**, en la familia de `auth:bootstrap` y
  `auth:reset-password`: `apps/api/scripts/create-account.mjs`, con su entrada en el
  `package.json` de `apps/api` y en el de la raíz.
- Toma una persona **ya existente en el roster** (por `employee_number`), un email, un rol
  y una o más plantas, y crea la cuenta con su alcance en una sola transacción, con el
  actor de auditoría declarado.
- Falla temprano y con un mensaje que se entiende cuando la persona no existe, cuando ya
  tiene cuenta, cuando el email es de otra cuenta o cuando el rol y el alcance no se
  corresponden.
- **A diferencia de los otros dos comandos de `auth:`, corre en producción**, y esa es la
  decisión que el design tiene que justificar: el alta real de un miembro del JHSC ocurre
  ahí. Los otros dos se niegan porque siembran o reemplazan una **credencial**; este no
  toca ninguna: la cuenta nace sin poder iniciar sesión y sigue necesitando la invitación.
- README: la sección "Dar de alta a alguien" pierde el bloque de SQL y la tabla de comandos
  gana una fila.

**Sin migración, sin cambios en la API HTTP, sin cambios en contracts.** Los `GRANT` que el
comando necesita ya están (`0005_identity.sql:859`).

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

Ninguna. El change declara `skip_specs: true`.

`openspec/specs/identity/spec.md` ya especifica **todo** lo que este comando hace, y por eso
inventarle un requisito sería inventar comportamiento que ya está escrito:

- la cuenta pertenece a una persona y una persona tiene a lo sumo una (línea 144);
- un solo rol de un conjunto cerrado (181);
- un email único (213);
- el alcance es explícito, otorgado y revocable (252);
- el rol por sí solo no otorga nada — un `jhsc_member` normalmente lleva una planta (301);
- un `external_auditor` no se puede crear sin `expires_at` (327).

Y `openspec/specs/audit/spec.md:284` ya exige la entrada de auditoría del alta, escrita una
vez en la cadena de **cada** planta del alcance.

El comando no agrega ni un `SHALL`: hace por un camino ergonómico lo que el motor ya
obliga. Todo lo que podría fallar acá ya tiene su escenario en la spec, y el que lo hace
cumplir es Postgres, no el script.

## Impact

- **Nuevo**: `apps/api/scripts/create-account.mjs`.
- **Modificado**: `apps/api/package.json`, `package.json` (raíz), `README.md`.
- **Reusa**: el patrón de conexión y el `issueInvitation` exportado de
  `apps/api/scripts/bootstrap-invitation.mjs`, y la mecánica de transacción de
  `apps/api/scripts/demo-data.mjs:113-145`.
- **Sin tocar**: esquema, migraciones, RLS, `apps/api/src/**`, `apps/web/**`,
  `packages/**`.
- **Riesgo principal**: es el primer comando de la familia `auth:` que corre en producción.
  El design fija qué lo hace seguro y qué comprobaciones no puede saltear.
