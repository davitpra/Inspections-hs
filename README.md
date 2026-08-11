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
pnpm db:up                    # Postgres + MinIO
pnpm db:migrate
pnpm db:jobs:install          # el esquema `pgboss`; sin esto la API no arranca
pnpm db:seed                  # plantilla, plantas, ubicaciones, coordinador, reglas
```

Con eso la base queda consistente **pero vacía de trabajo**, a propósito: los seeds no
crean credenciales ni asignan inspecciones. Ver más abajo.

Después, en dos terminales:

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
| `pnpm db:up` / `db:down` / `db:reset` | El compose: Postgres y MinIO. `reset` borra los volúmenes. |
| `pnpm db:migrate` | Migraciones (`hs_migrator`). |
| `pnpm db:jobs:install` | Instala/actualiza el esquema `pgboss`. Paso de despliegue, no de arranque. |
| `pnpm db:seed` | Datos de referencia idempotentes. Sin credenciales. |
| `pnpm demo:data` | Entorno de demo local usable. Solo a mano. |
| `pnpm auth:bootstrap [userId]` | Emite la invitación de una cuenta sin credencial. |
| `pnpm auth:reset-password <userId\|email>` | Contraseña nueva, o `--unlock` para destrabar. Solo fuera de producción. |
| `pnpm roster:import <csv>` | Importa el roster de ADP. |
| `pnpm test` | Unitarios. |
| `pnpm --filter api test:int` | Integración, contra Postgres real (testcontainers). |
| `pnpm typecheck` / `pnpm lint` | Lo de siempre. |

## Lo que todavía no tiene UI

Aceptar una invitación existe en la API (`POST /auth/invitations/accept`) pero no en el
PWA: no hay ruta donde pegar el token y elegir contraseña. Toda cuenta nueva pasa hoy
por curl. `pnpm demo:data` hace esa llamada por vos para la cuenta de demo; no reemplaza
la pantalla que falta.
