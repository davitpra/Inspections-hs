# hs-platform

Plataforma de higiene y seguridad para dos plantas de Ontario: inspecciones mensuales
del JHSC, hallazgos, acciones correctivas e incidentes.

- `apps/api` — NestJS + Postgres (RLS por planta, ADR-002) + pg-boss (ADR-005).
- `apps/web` — PWA offline-first: React, TanStack Router/Query, Dexie.
- `packages/contracts` — los esquemas Zod que comparten los dos.
- `packages/forms` — el motor de formularios isomórfico: corre igual en el dispositivo y
  en el servidor sobre la misma entrada, y viaja dentro del bundle del service worker
  (ADR-007).
- `docs/adr` — las decisiones y por qué.

## Arranque local

```bash
cp .env.example .env          # revisá POSTGRES_PORT si ya tenés algo en 5432
pnpm install
pnpm setup                    # db:up + db:migrate + db:jobs:install + db:seed
```

`pnpm setup` es el atajo de los cuatro pasos de base; si algo falla conviene correrlos
sueltos para ver cuál fue:

```bash
pnpm db:up                    # Postgres + MinIO
pnpm db:migrate
pnpm db:jobs:install          # el esquema `pgboss`; sin esto la API no arranca
pnpm db:seed                  # plantilla, plantas, ubicaciones, coordinador, reglas
```

Con eso la base queda consistente **pero vacía de trabajo**, a propósito: los seeds no
crean credenciales ni asignan inspecciones. Ver más abajo.

Después, en una sola terminal:

```bash
pnpm dev                      # API en :3000 y PWA en :5173
```

Compila `contracts` y `forms` (los otros dos los consumen por su `dist`) y levanta los
dos watchers en paralelo, prefijando cada línea con `apps/api dev:` / `apps/web dev:`.
Ctrl-C corta ambos. No verifica que Postgres esté arriba: si la base no corre, la API
falla al iniciar y hay que pasar por `pnpm setup` (o `pnpm db:up`).

Para correrlos por separado, en dos terminales:

```bash
pnpm --filter api start:dev   # http://localhost:3000
pnpm --filter web dev         # http://localhost:5173
```

## Datos de demo

Recién seedeado, el PWA no se puede usar: la única cuenta es la del coordinador, que no
tiene contraseña. Y aunque se pudiera entrar, `/` estaría vacío — las inspecciones que
abre el calendario nacen sin inspector asignado, y `GET /me/pending-inspections` filtra
por `inspector_id`.

Con la API corriendo:

```bash
pnpm demo:data
```

Deja el entorno listo y dice con qué credenciales entrar. Concretamente: crea un
`jhsc_member` con contraseña conocida, siembra roster, abre el período corriente
—encolando el trabajo real, `inspections.open-period`— y le asigna la inspección de St.
Thomas. El rol importa: `requireInspector()` rechaza cualquier otro, porque §4 dice que
los miembros del JHSC son los únicos que ejecutan inspecciones.

Es idempotente: se corre las veces que haga falta.

**No es un seed y no lo va a ser.** `pnpm db:seed` corre en CI y en cualquier entorno;
sembrar ahí una contraseña conocida sería una puerta abierta en todos ellos. `demo:data`
se corre a mano y se niega a correr con `NODE_ENV=production`. La contraseña sale de
`DEMO_PASSWORD` (mínimo 12 caracteres).

Para la primera credencial del coordinador —el arranque real, sin datos inventados— el
comando es `pnpm auth:bootstrap`, que emite una invitación y muestra su token una sola
vez.

### Dar de alta a alguien

**Un miembro del JHSC, por la pantalla.** `/roster` —coordinador o management— muestra, junto a
cada persona sin cuenta, un botón "Invite as JHSC member". Pide el email, y con eso crea
la cuenta y emite la invitación en un solo `POST /accounts` (design D4 del change que lo
agregó): el sitio es el que la pantalla está mirando, no una elección aparte. El link de
un solo uso se muestra ahí mismo para copiar —`https://<host>/accept-invitation?token=…`—
y no se vuelve a mostrar. Con cuenta, la fila muestra el rol en vez del botón.

**Management y el arranque sin una cuenta administrativa siguen siendo el comando.** Una
cuenta de management se da de alta rara vez y puede llevar alcance multi-planta; la primera
cuenta del sistema tampoco tiene todavía una sesión administrativa que apriete un botón.
Tres pasos, y los tres son actos distintos a propósito (ADR-011):

1. **Crear la cuenta.** La persona ya está en el roster; falta el `app_user` con su
   alcance:

   ```bash
   pnpm auth:create-account --employee ADP-1234 --email nombre@example.com \
     --role jhsc_member --site st-thomas --actor coordinator@example.com
   ```

   `--actor` es la cuenta en cuyo nombre se da el alta: va a la cadena de auditoría de
   cada planta del alcance, y por eso no tiene default. La cuenta nace **sin credencial**
   —no puede iniciar sesión— y el comando imprime el paso 2 listo para copiar. Es
   idempotente y no crea personas: si no está en el roster, entra por `roster:import`.

   Es el **único `auth:*` que corre en producción**, y la razón es que no siembra ni
   reemplaza ninguna credencial. Solo acepta `hs_coordinator`, `jhsc_member` y `management`.

   Reusa el mismo `INSERT` que `POST /accounts` —`account.repository.ts`— compilado desde
   `dist/`, así que necesita `pnpm --filter api build` corrido antes; si falta, el comando
   lo dice.

2. **Emitir la invitación.** `pnpm auth:bootstrap <userId>`, o `POST /auth/invitations`
   con sesión administrativa. Devuelve el token **una sola vez**: del otro lado queda su
   hash y no hay ruta que lo vuelva a mostrar. Si se pierde, se revoca y se emite otro.
3. **Pasarle el link.** `https://<host>/accept-invitation?token=<token>`. Ahí elige su
   contraseña (mínimo 12) y de ahí va a iniciar sesión. Vence a las 72 horas y se usa una
   sola vez.

El paso 3 es también el **reinicio de contraseña**: sin correo transaccional no hay a
dónde mandar un link, así que el coordinador revoca la credencial
(`POST /auth/credentials/revoke`), emite una invitación nueva y el titular vuelve por la
misma pantalla.

### Historial: que todas las pantallas tengan algo que mostrar

`demo:data` deja el entorno _usable_ y ahí se detiene. Con eso `/` tiene una fila y el
resto de la aplicación está en blanco: hallazgos, acciones correctivas e incidentes son
consecuencias de meses de trabajo que un entorno recién levantado no tuvo.

```bash
pnpm demo:content
```

Siembra cinco meses de historial en St. Thomas —tres inspecciones enviadas, una cancelada
y un período omitido—, y con eso: hallazgos derivados, un mismo peligro que reaparece en
los tres envíos, un hallazgo de entrada manual, acciones correctivas en los cuatro estados
más una vencida y tres incidentes (cerrado, en investigación y recién reportado).

**Todo pasa por la API, con sesión**, salvo dos cosas que ningún endpoint puede hacer y no
debería poder: las inspecciones programadas de los meses pasados —el planificador abre el
período corriente y nada más— y una acción ya vencida, porque `due_at` explícito permite
sembrarla con una fecha pasada. Esas dos van por SQL con los GRANT de `hs_app`, y están
declaradas en la cabecera del script.

Necesita `pnpm demo:data` corrido antes, la API arriba y MinIO arriba (sube fotos de
verdad). Es idempotente.

Usa las dos cuentas y hacen falta las dos: el coordinador abre acciones,
investiga y genera el reporte, y el `jhsc_member` es el único que ejecuta inspecciones.
**No cambia ninguna contraseña.** La del inspector sale de `DEMO_PASSWORD` —es la cuenta
que crea `demo:data`—; la del coordinador, de `DEMO_COORDINATOR_PASSWORD`, porque esa
cuenta es real y puede tener ya la suya:

```bash
DEMO_COORDINATOR_PASSWORD='la que tenga' pnpm demo:content
```

### Con qué entrar

Corridos los dos comandos, en http://localhost:5173 entran estas dos cuentas y ninguna
más:

| Email                        | Contraseña                  | Rol              | Alcance              | Persona                                          |
| ---------------------------- | --------------------------- | ---------------- | -------------------- | ------------------------------------------------ |
| `coordinator@example.com`    | `DEMO_COORDINATOR_PASSWORD` | `hs_coordinator` | St. Thomas + Glencoe | Health and Safety Coordinator (`BOOTSTRAP-0001`) |
| `demo.inspector@example.com` | `demo-inspector-2026`       | `jhsc_member`    | St. Thomas           | Dana Inspector (`DEMO-0001`)                     |

Sin esas variables en el entorno la contraseña de las dos es `demo-inspector-2026`, el
`DEFAULT_PASSWORD` de `scripts/demo-data.mjs`. **Es una contraseña de desarrollo y nada
más**: los dos comandos se niegan a correr con `NODE_ENV=production`, y ninguno de los
dos corre en CI.

El coordinador sale del seed y **no tiene contraseña hasta que alguien se la pone**:
`demo:content` no la cambia —ver arriba—, así que la primera vez hay que emitirle la
credencial con `pnpm auth:bootstrap` o fijarla con
`pnpm auth:reset-password coordinator@example.com --password '…'`. El inspector no
necesita ese paso: `demo:data` crea la cuenta y acepta su propia invitación.

El resto del roster que siembra `demo:data` son **cinco personas sin cuenta**, que es el
caso normal (§4) y lo que hace que `/roster` tenga algo que mostrar y a quién invitar:

| Persona        | Legajo      | Sitio      |
| -------------- | ----------- | ---------- |
| Alex Boivin    | `DEMO-1001` | St. Thomas |
| Priya Raman    | `DEMO-1002` | St. Thomas |
| Sam Okafor     | `DEMO-1003` | St. Thomas |
| Marie Tremblay | `DEMO-1004` | Glencoe    |
| Chen Wu        | `DEMO-1005` | Glencoe    |

### Cuando te quedás afuera

```bash
pnpm auth:reset-password coordinator@example.com            # contraseña nueva, al azar
pnpm auth:reset-password coordinator@example.com --unlock   # solo destraba el bloqueo
pnpm auth:reset-password <userId> --password <pw>           # una que elijas vos
```

Dos situaciones distintas y conviene no confundirlas. **Cuenta trabada**: cinco intentos
fallidos bloquean quince minutos (D8), y el servidor responde `account_locked` _antes_ de
verificar la contraseña — así que desde afuera se ve igual que una contraseña mal puesta,
a propósito: si respondiera distinto, el bloqueo sería un oráculo. `--unlock` limpia el
contador sin tocar la credencial. **Contraseña perdida**: no se recupera, solo se
reemplaza; sin `--unlock` el comando revoca la credencial, corta las sesiones vivas y
pone una nueva por la vía normal (invitación emitida y aceptada), que es por qué necesita
la API corriendo.

No corre con `NODE_ENV=production`, y ahí la ausencia es la respuesta: el bloqueo se
espera, y la credencial la revoca el coordinador desde la aplicación
(`POST /auth/credentials/revoke`).

## Las pantallas

**Quién ve qué lo decide el rol, y lo garantiza RLS y no el menú.** Las tablas de abajo
están agrupadas por función y no por rol a propósito: varias pantallas devuelven distinto
según quién mire —`/incidents` es el caso claro— y describirlas por rol haría parecer que
el filtro está en el componente.

**El recorrido de una inspección.** Solo lo hace un `jhsc_member`: §4 dice que los
miembros del JHSC son los únicos que ejecutan inspecciones, y `requireInspector()` lo
comprueba.

| Ruta                       | Qué es                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                        | Lo que esta cuenta debe y cuándo. No lista borradores ni cerrados: cada borrador vive en la página de su asignación y lo cerrado está en `/historical`. |
| `/inspections/$id`         | La asignación, y el borrador de ESTE dispositivo si lo hay: donde se retoma y donde se descarta.                                                        |
| `/inspections/$id/capture` | La captura.                                                                                                                                             |
| `/inspections/$id/review`  | Revisar y firmar — el momento en que un borrador deja de serlo. Valida con `validateAnswers` de `@hs/forms`, la misma función que corre el servidor.    |
| `/inspections/$id/report`  | Una inspección enviada, leída de vuelta: el documento **congelado** con el que se contestó, no la versión publicada hoy.                                |
| `/historical`              | Todo lo que esta cuenta cerró, separado por la identidad estable de cada plantilla.                                                                     |
| `/outbox`                  | Lo que no salió de este dispositivo, con el motivo del servidor si fue rechazado.                                                                       |

**Lo que sale del recorrido.**

| Ruta                   | Qué es                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/findings`            | Los recorridos en los que esta cuenta encontró algo que arreglar, separados por tipo.                                                                          |
| `/findings/$id`        | El hilo de un hallazgo: su ciclo y la corrección leídos como una sola cosa, no como dos listas al lado.                                                        |
| `/incidents`           | Los que esta cuenta puede ver. **La lista no filtra nada**: RLS entrega todos los del alcance a coordinador y management, y a un miembro solo los que hubiera reportado. |
| `/incidents/report`    | Reportar uno.                                                                                                                                                  |
| `/incidents/$id`       | El incidente, sus relojes regulatorios y su investigación.                                                                                                     |
| `/incidents/$id/form7` | Los valores mapeados a los campos del Form 7 del WSIB. Solo lectura y con copiar al portapapeles: **sin PDF, a propósito** (riesgo H, cerrado en v1.2).        |

**Administración.**

| Ruta                             | Qué es                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `/scheduling`                    | El año por planta: qué requisitos hay y qué períodos abrieron.                                                                              |
| `/scheduling/$scheduleId`        | Un requisito año por año — abrir un período, asignarle inspector, adelantarle la visibilidad.                                               |
| `/roster`                        | Quién está en cada planta, con filtro de estado y búsqueda. Ver "Dar de alta a alguien" y "Corregir el roster".                             |
| `/templates`                     | Las plantillas publicadas como referencia y las que se están escribiendo.                                                                   |
| `/templates/drafts/$id`          | El editor del borrador.                                                                                                                     |
| `/templates/versions/$versionId` | Una versión publicada, de solo lectura.                                                                                                     |
| `/catalog/locations`             | Una fila por ubicación compartida y una columna por planta: la pregunta es «¿cada lugar que mis plantillas nombran existe en cada planta?». |

**Sin sesión:** `/accept-invitation`, donde el titular de una invitación elige su contraseña.

### Los tres ciclos

Ninguno es una columna: los tres se calculan de eventos inmutables y reglas puras
(ADR-008). Las máquinas viven **como dato y no como `switch`** en `packages/contracts`, y
la misma tabla está escrita como guarda en la migración — hay un test de integración que
evalúa los pares por los dos caminos y los compara.

|                   | Estados                                                           | Dónde está la máquina                 |
| ----------------- | ----------------------------------------------------------------- | ------------------------------------- |
| Hallazgo          | `raised` → `assigned` → `in_progress` → `verification` → `closed` | `packages/contracts/src/findings.ts`  |
| Acción correctiva | `open` → `in_progress` → `awaiting_verification` → `closed`       | `packages/contracts/src/actions.ts`   |
| Incidente         | `reported` → `under_investigation` → `closed`                     | `packages/contracts/src/incidents.ts` |

Dos reglas del ciclo de la acción que explican la mitad de las pantallas: `closed` no
aparece nunca como origen —que el trabajo cerrado se haya deshecho es un hallazgo nuevo,
con su propia fecha— y `awaiting_verification → closed` exige `not_executor`, así que
quien declara hecho el trabajo no puede ser quien lo verifica.

## Comandos

| Comando                                    | Qué hace                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `pnpm dev`                                 | Compila `contracts` y `forms`, y levanta API (:3000) y PWA (:5173) en paralelo.      |
| `pnpm setup`                               | Los cuatro pasos de base: `db:up`, `db:migrate`, `db:jobs:install`, `db:seed`.       |
| `pnpm db:up` / `db:down` / `db:reset`      | El compose: Postgres y MinIO. `reset` borra los volúmenes.                           |
| `pnpm db:migrate`                          | Migraciones (`hs_migrator`).                                                         |
| `pnpm db:jobs:install`                     | Instala/actualiza el esquema `pgboss`. Paso de despliegue, no de arranque.           |
| `pnpm db:seed`                             | Datos de referencia idempotentes. Sin credenciales.                                  |
| `pnpm demo:data`                           | Entorno de demo local usable. Solo a mano.                                           |
| `pnpm demo:content`                        | Historial de demo: hallazgos, acciones e incidentes.                                 |
| `pnpm auth:create-account`                 | Crea la cuenta de una persona del roster. El único `auth:*` que corre en producción. |
| `pnpm auth:bootstrap [userId]`             | Emite la invitación de una cuenta sin credencial.                                    |
| `pnpm auth:reset-password <userId\|email>` | Contraseña nueva, o `--unlock` para destrabar. Solo fuera de producción.             |
| `pnpm roster:import <csv>`                 | Importa el roster de ADP. El mismo CSV entra por el botón de `/roster`.              |
| `pnpm test`                                | Unitarios.                                                                           |
| `pnpm --filter api test:int`               | Integración, contra Postgres real (testcontainers).                                  |
| `pnpm typecheck` / `pnpm lint`             | Lo de siempre.                                                                       |

## Lo que todavía no tiene UI

**Crear e invitar una cuenta de management.** `POST /auth/invitations` existe y lo puede
llamar una cuenta administrativa, pero fuera del botón de `/roster` —que crea la cuenta e
invita en un solo acto, y solo para `jhsc_member`— no hay pantalla para management: se crea
con `pnpm auth:create-account` y se invita con `pnpm auth:bootstrap` o con curl. La promoción
de un miembro activo a coordinador sí está en `/roster` y solo la ofrece a management.

Crear una cuenta de `jhsc_member` y aceptar la invitación, en cambio, ya no están acá: son
el botón de `/roster` (o `pnpm auth:create-account` para management) y
`/accept-invitation` — ver "Dar de alta a alguien".

**Elegir a una persona en el reporte de incidente.** El `PersonPicker` de
`/incidents/report` sigue siendo un campo de id: falta una ruta que liste `PersonOption`
—cuatro columnas, solo activas— para esa pantalla. **No sirve `GET /people`**, que es del
coordinador y devuelve el perfil completo; colgar el selector de ahí rompería §4 R4.

**Renombrar, transferir y reactivar a alguien del roster.** `/roster` ya no es de solo
lectura: da de alta a **una** persona (`POST /people`, tres campos y nada de email — dar
acceso es otro acto), da de baja (`PATCH /people/:personId`) e importa el CSV desde la
misma pantalla (`POST /people/import`). Lo que sigue sin ruta es corregir un apellido,
transferir de planta y reactivar a quien se dio de baja: eso se hace con el CSV, que para
esas tres cosas sigue siendo la fuente de verdad — `pnpm roster:import <csv>` o el botón
de importar.
