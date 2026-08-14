# hs-platform

Plataforma de higiene y seguridad para dos plantas de Ontario: inspecciones mensuales
del JHSC, hallazgos, acciones correctivas, incidentes y el reporte de cumplimiento.

- `apps/api` — NestJS + Postgres (RLS por planta, ADR-002) + pg-boss (ADR-005).
- `apps/web` — PWA offline-first: React, TanStack Router/Query, Dexie.
- `packages/contracts` — los esquemas Zod que comparten los dos.
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

**Un miembro del JHSC, por la pantalla.** `/roster` —solo coordinador— muestra, junto a
cada persona sin cuenta, un botón "Invite as JHSC member". Pide el email, y con eso crea
la cuenta y emite la invitación en un solo `POST /accounts` (design D4 del change que lo
agregó): el sitio es el que la pantalla está mirando, no una elección aparte. El link de
un solo uso se muestra ahí mismo para copiar —`https://<host>/accept-invitation?token=…`—
y no se vuelve a mostrar. Con cuenta, la fila muestra el rol en vez del botón.

**Los otros cuatro roles, y el arranque sin coordinador, siguen siendo el comando.** Un
supervisor, un management o un auditor externo se dan de alta una vez cada varios meses y
traen decisiones que no caben en un botón de una fila —alcance multi-planta, ventana de
fechas—, y la primera cuenta del sistema no tiene, todavía, un coordinador con sesión que
apriete ningún botón. Tres pasos, y los tres son actos distintos a propósito (ADR-011):

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
   reemplaza ninguna credencial. Para `external_auditor` no sirve: ese rol necesita
   `expires_at`, `records_from` y `records_to`, y va por SQL.

   Reusa el mismo `INSERT` que `POST /accounts` —`account.repository.ts`— compilado desde
   `dist/`, así que necesita `pnpm --filter api build` corrido antes; si falta, el comando
   lo dice.

2. **Emitir la invitación.** `pnpm auth:bootstrap <userId>`, o `POST /auth/invitations`
   con sesión de coordinador. Devuelve el token **una sola vez**: del otro lado queda su
   hash y no hay ruta que lo vuelva a mostrar. Si se pierde, se revoca y se emite otro.
3. **Pasarle el link.** `https://<host>/accept-invitation?token=<token>`. Ahí elige su
   contraseña (mínimo 12) y de ahí va a iniciar sesión. Vence a las 72 horas y se usa una
   sola vez.

El paso 3 es también el **reinicio de contraseña**: sin correo transaccional no hay a
dónde mandar un link, así que el coordinador revoca la credencial
(`POST /auth/credentials/revoke`), emite una invitación nueva y el titular vuelve por la
misma pantalla.

### Historial: que todas las pantallas tengan algo que mostrar

`demo:data` deja el entorno *usable* y ahí se detiene. Con eso `/` tiene una fila y el
resto de la aplicación está en blanco: acciones correctivas, incidentes, recurrencia y
cumplimiento son consecuencias de meses de trabajo que un entorno recién levantado no
tuvo.

```bash
pnpm demo:content
```

Siembra cinco meses de historial en St. Thomas —tres inspecciones enviadas, una cancelada
y un período omitido—, y con eso: hallazgos derivados y clasificados, una serie recurrente
de tres ocurrencias, un hallazgo de entrada manual, acciones correctivas en los cuatro
estados más una vencida, tres incidentes (cerrado, en investigación y recién reportado) y
un reporte de cumplimiento congelado con su PDF.

**Todo pasa por la API, con sesión**, salvo dos cosas que ningún endpoint puede hacer y no
debería poder: las inspecciones programadas de los meses pasados —el planificador abre el
período corriente y nada más— y una acción ya vencida, porque `due_at` lo calcula el
servidor sobre su propio reloj. Esas dos van por SQL con los GRANT de `hs_app`, y están
declaradas en la cabecera del script.

Necesita `pnpm demo:data` corrido antes, la API arriba y MinIO arriba (sube fotos de
verdad). Es idempotente.

Usa las dos cuentas y hacen falta las dos: el coordinador clasifica, abre acciones,
investiga y genera el reporte, y el `jhsc_member` es el único que ejecuta inspecciones.
**No cambia ninguna contraseña.** La del inspector sale de `DEMO_PASSWORD` —es la cuenta
que crea `demo:data`—; la del coordinador, de `DEMO_COORDINATOR_PASSWORD`, porque esa
cuenta es real y puede tener ya la suya:

```bash
DEMO_COORDINATOR_PASSWORD='la que tenga' pnpm demo:content
```

### Cuando te quedás afuera

```bash
pnpm auth:reset-password coordinator@example.com            # contraseña nueva, al azar
pnpm auth:reset-password coordinator@example.com --unlock   # solo destraba el bloqueo
pnpm auth:reset-password <userId> --password <pw>           # una que elijas vos
```

Dos situaciones distintas y conviene no confundirlas. **Cuenta trabada**: cinco intentos
fallidos bloquean quince minutos (D8), y el servidor responde `account_locked` *antes* de
verificar la contraseña — así que desde afuera se ve igual que una contraseña mal puesta,
a propósito: si respondiera distinto, el bloqueo sería un oráculo. `--unlock` limpia el
contador sin tocar la credencial. **Contraseña perdida**: no se recupera, solo se
reemplaza; sin `--unlock` el comando revoca la credencial, corta las sesiones vivas y
pone una nueva por la vía normal (invitación emitida y aceptada), que es por qué necesita
la API corriendo.

No corre con `NODE_ENV=production`, y ahí la ausencia es la respuesta: el bloqueo se
espera, y la credencial la revoca el coordinador desde la aplicación
(`POST /auth/credentials/revoke`).

## Comandos

| Comando | Qué hace |
| --- | --- |
| `pnpm dev` | Compila `contracts` y `forms`, y levanta API (:3000) y PWA (:5173) en paralelo. |
| `pnpm setup` | Los cuatro pasos de base: `db:up`, `db:migrate`, `db:jobs:install`, `db:seed`. |
| `pnpm db:up` / `db:down` / `db:reset` | El compose: Postgres y MinIO. `reset` borra los volúmenes. |
| `pnpm db:migrate` | Migraciones (`hs_migrator`). |
| `pnpm db:jobs:install` | Instala/actualiza el esquema `pgboss`. Paso de despliegue, no de arranque. |
| `pnpm db:seed` | Datos de referencia idempotentes. Sin credenciales. |
| `pnpm demo:data` | Entorno de demo local usable. Solo a mano. |
| `pnpm demo:content` | Historial de demo: hallazgos, acciones, incidentes, recurrencia y cumplimiento. |
| `pnpm auth:create-account` | Crea la cuenta de una persona del roster. El único `auth:*` que corre en producción. |
| `pnpm auth:bootstrap [userId]` | Emite la invitación de una cuenta sin credencial. |
| `pnpm auth:reset-password <userId\|email>` | Contraseña nueva, o `--unlock` para destrabar. Solo fuera de producción. |
| `pnpm roster:import <csv>` | Importa el roster de ADP. |
| `pnpm test` | Unitarios. |
| `pnpm --filter api test:int` | Integración, contra Postgres real (testcontainers). |
| `pnpm typecheck` / `pnpm lint` | Lo de siempre. |

## Lo que todavía no tiene UI

**Emitir la invitación de un rol que no sea `jhsc_member`.** `POST /auth/invitations`
existe y solo lo puede llamar el coordinador, pero fuera del botón de `/roster` —que
crea la cuenta e invita en un solo acto, y solo para `jhsc_member`— no hay pantalla para
los otros cuatro roles: se emite con `pnpm auth:bootstrap` o con curl.

Crear una cuenta de `jhsc_member` y aceptar la invitación, en cambio, ya no están acá: son
el botón de `/roster` (o `pnpm auth:create-account` para los otros roles) y
`/accept-invitation` — ver "Dar de alta a alguien".

**Elegir a una persona en el reporte de incidente.** El `PersonPicker` de
`/incidents/report` sigue siendo un campo de id: falta una ruta que liste `PersonOption`
—cuatro columnas, solo activas— para esa pantalla. **No sirve `GET /people`**, que es del
coordinador y devuelve el perfil completo; colgar el selector de ahí rompería §4 R4.

**Corregir el roster.** `/roster` ya deja *ver* quién está en cada planta —con filtro de
estado y búsqueda—, pero es de solo lectura: corregir un apellido, transferir de planta o
dar de baja se siguen haciendo con `pnpm roster:import`, que es la fuente de verdad del
roster.
