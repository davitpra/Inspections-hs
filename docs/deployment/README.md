# Despliegue de hs-platform

Este directorio contiene los documentos del **primer despliegue** del sistema. Cada
documento numerado es un plan paso a paso, escrito para que un agente o una persona lo
ejecute sin haber participado de las decisiones que lo produjeron.

Se leen y se ejecutan **en el orden de dependencias**. El `07` fija primero la configuración
que necesitan `03`–`06`; después de levantar esos componentes, sus secciones de release y
arranque cierran la instalación. El número documenta la responsabilidad del paso, no permite
inventar una dependencia circular.

---

## Contexto compartido

No lo re-decidas y no lo contradigas. Todo documento de este directorio lo asume.

**Producto.** Plataforma de inspecciones e incidentes OHSA. Dos plantas (St. Thomas,
Glencoe), 15-20 usuarios con cuenta, 200+ personas en el roster. Un solo desarrollador.
Monorepo pnpm: `apps/api` (NestJS), `apps/web` (PWA offline), `packages/contracts`,
`packages/forms`.

**Idioma.** Los documentos, los comentarios y los commits van en español. La UI de la
aplicación es solo inglés, sin i18n.

**Se acepta ventana de mantenimiento.** Sin réplicas, sin alta disponibilidad. Una
inspección al mes por planta tolera que el sistema esté caído un rato.

---

## Las tres decisiones que fijan todo lo demás

### 1. Todo en un VPS

Una sola máquina con Docker Compose: Postgres, MinIO, la API y Caddy. Tres subdominios con
TLS automático:

| Subdominio | Sirve |
| --- | --- |
| `app.<DOMINIO>` | El cliente estático. **En la raíz del dominio**, nunca en un subpath |
| `api.<DOMINIO>` | La API de NestJS |
| `s3.<DOMINIO>` | MinIO, en modo path-style |

`s3.` tiene que estar en internet: el teléfono del inspector sube las fotos **directo al
bucket**, con una URL firmada. La API solo firma y nunca ve los bytes.

### 2. Va directo a producción, con datos reales

No hay entorno de ensayo. Consecuencias que no son negociables:

- `pnpm demo:data` y `pnpm demo:content` **no participan**. Se niegan con
  `NODE_ENV=production`, y está bien que lo hagan.
- Toda prueba destructiva se hace **sobre una copia**, nunca sobre la base viva.
- Un error irreversible no tiene deshacer. Los documentos marcan cuáles son.

### 3. El seed de arranque se edita antes de sembrar

`apps/api/seeds/004_bootstrap_coordinator.sql` siembra hoy una persona de relleno:

```
BOOTSTRAP-0001 · "Health and Safety Coordinator" · coordinator@example.com
```

Se reemplazan nombre, número de empleado y email por los de la persona real,
**conservando los UUID literales** — están elegidos a propósito y el encabezado del
archivo explica por qué.

Por ADR-002 este sistema no borra: si se siembra el relleno, queda en el roster y en la
cadena de auditoría para siempre. Lo prepara el documento `01` y lo bloquea el `04`.

---

## Desviación declarada de ADR-008

ADR-008 fija CDN estático, Postgres gestionado **con PITR de al menos 7 días** y object
storage, y declara no negociable *"una restauración de prueba ejecutada antes de que el
sistema tenga datos reales"*.

La decisión 1 no cumple lo primero. La decisión 2 hace imposible lo segundo en su ventana.

Esto **no se resuelve ignorando el ADR**. El documento `01` crea
`docs/adr/026-despliegue-vps-unico.md`, que supera la sección de topología de ADR-008,
declara la desviación y dice qué la sustituye. El documento `08` implementa ese sustituto.

Recordatorio de por qué importa, en palabras del propio ADR-008: *"Un sistema de registro
regulatorio sin recuperación punto-en-el-tiempo tiene inmutabilidad decorativa."*

---

## Los documentos

| # | Documento | Qué deja hecho |
| --- | --- | --- |
| 01 | [`01-preflight.md`](01-preflight.md) | ADR-026 y los arreglos de código bloqueantes. El repo queda listo para construir |
| 02 | [`02-imagen-api.md`](02-imagen-api.md) | `Dockerfile` y `.dockerignore`. La imagen de la API se construye y arranca |
| 03 | [`03-infraestructura.md`](03-infraestructura.md) | VPS, DNS, firewall, TLS. `compose.prod.yml` y `Caddyfile` completos |
| 04 | [`04-postgres.md`](04-postgres.md) | Roles con contraseñas reales, migraciones, esquema de trabajos y seeds |
| 05 | [`05-objetos-minio.md`](05-objetos-minio.md) | Bucket con versioning, credencial sin borrado, CORS |
| 06 | [`06-cliente-web.md`](06-cliente-web.md) | El bundle construido y servido, con fallback SPA y cabeceras correctas |
| 07 | [`07-entorno-y-release.md`](07-entorno-y-release.md) | La matriz de variables, el arranque, el redeploy y el rollback |
| 08 | [`08-backups.md`](08-backups.md) | Backup fuera de la máquina, **verificado con una restauración real** |
| 09 | [`09-puesta-en-marcha.md`](09-puesta-en-marcha.md) | Roster real, dos cuentas administrativas, y la verificación de punta a punta |
| 10 | [`10-operacion.md`](10-operacion.md) | Qué se mira un martes cualquiera para que esto siga vivo |

### Orden de ejecución

```
01 preflight ──► 02 imagen ──► 07 entorno ──► 03 infraestructura ──► 04 postgres
                                              │                         │
                                              ▼                         ▼
                                           05 objetos ───────────────► 06 cliente
                                                                          │
                                                                          ▼
                      10 operación ◄── 09 puesta en marcha ◄── 08 backups
```

**`08` va antes que `09` a propósito.** Cuando la puesta en marcha termina hay evidencia
regulatoria real en la máquina. Instalar el backup después deja una ventana sin red.

### Estado

| # | Documento | Estado |
| --- | --- | --- |
| 01 | preflight | ☑ escrito |
| 02 | imagen de la API | ☑ escrito |
| 03 | infraestructura | ☑ escrito |
| 04 | postgres | ☑ escrito |
| 05 | objetos | ☑ escrito |
| 06 | cliente web | ☑ escrito |
| 07 | entorno y release | ☑ escrito |
| 08 | backups | ☑ escrito; pendiente de ejecución en el VPS |
| 09 | puesta en marcha | ☑ escrito; pendiente de ejecución en producción |
| 10 | operación | ☑ escrito; pendiente de ejecución en producción |

---

## Contrato de nombres

Congelado. Ningún documento lo cambia; todos lo usan tal cual.

```
imagen               hs-platform-api:<tag>
servicios compose    db, storage, storage-init, api, migrator, caddy
volúmenes            db-data, storage-data, caddy-data, caddy-config
red                  hs-platform
working_dir de api   /app/apps/api
archivos             compose.prod.yml, Caddyfile, .env.prod
placeholder dominio  <DOMINIO>
```

Los placeholders se escriben siempre `<ASÍ>`, en mayúsculas y entre ángulos, para que un
valor sin reemplazar salte a la vista.

---

## Propiedad de artefactos

Cada artefacto tiene **un solo** documento dueño. Los demás lo citan por ruta y por nombre
de servicio, y **tienen prohibido mostrar un fragmento alternativo**. Dos documentos que
muestran dos versiones del mismo archivo es cómo un despliegue se rompe en silencio.

| Artefacto | Dueño | Los demás pueden |
| --- | --- | --- |
| `docs/adr/026-despliegue-vps-unico.md` | `01` | citarlo por número |
| `Dockerfile`, `.dockerignore` | `02` | citar el nombre de la imagen |
| `compose.prod.yml` **completo** | `03` | citar servicio y volumen |
| `Caddyfile` **completo** | `03` | `05` y `06` **especifican requisitos**; `03` los implementa |
| Parametrización de `db/init/01-roles.sh` y `db/init/sql/01-roles.sql` | `04` | `03` declara el montaje |
| Bucket, política y CORS de MinIO | `05` | `03` declara el servicio |
| Build args y cabeceras del cliente | `06` | `03` implementa el bloque de Caddy |
| `.env.prod` y la matriz de variables | `07` | citar **el nombre**, nunca el valor |
| One-off de esquema y bootstrap de base | `04` | — |
| One-off de identidad y puesta en marcha | `09` | — |
| Script, timer, manifiesto y restauración de backups | `08` | citar el procedimiento, nunca una segunda versión |
| Checklist y registro de operación | `10` | citar la salida esperada |

### La salida de escape

> Si al ejecutar un documento descubrís que hace falta cambiar algo que es de otro
> documento, **no lo cambies**. Anotalo en la sección "Lo que este documento le pide a
> otro" y seguí.

---

## Variables: los nombres y quién las consume

Los **valores de la aplicación** viven en `07-entorno-y-release.md` y en ningún otro lado.
Las credenciales del backup viven bajo el dueño de `08`. Esta tabla fija los nombres y,
sobre todo, **dónde tiene permitido vivir cada uno**.

### Grupo A — proceso de la API

Van en el `environment:` del servicio `api`. Las valida `apps/api/src/env.ts` enteras,
antes de construir un solo módulo.

```
NODE_ENV  PORT  DATABASE_URL  BETTER_AUTH_SECRET  BETTER_AUTH_URL
JOBS_ENABLED  WEB_ORIGINS  TRUST_PROXY  SHUTDOWN_GRACE_MS
S3_BUCKET  S3_ACCESS_KEY_ID  S3_SECRET_ACCESS_KEY  S3_ENDPOINT
S3_REGION  S3_FORCE_PATH_STYLE  S3_UPLOAD_TTL_SECONDS
```

### Grupo B — comandos one-off

Van **solo** en el `docker compose run --rm` que los necesita.

```
MIGRATION_DATABASE_URL     db:migrate, db:jobs:install, db:seed
DATABASE_URL               auth:create-account, auth:bootstrap, roster:import
```

> **`MIGRATION_DATABASE_URL` nunca entra al `environment:` del servicio `api`.** Es la
> credencial del rol dueño, que evade RLS por `FORCE`. Meterla en el proceso de larga vida
> es exactamente lo que `apps/api/src/db/db.service.ts` tiene escrito que no debe pasar.
> `env.ts` no la conoce, así que nadie te va a avisar.

### Grupo C — build del cliente

Es **build-time**. Se hornea en el bundle y no se puede cambiar después.

```
VITE_API_BASE_URL
```

> Si falta al construir, el bundle queda apuntando a `http://localhost:3000` y falla en
> todos los dispositivos a la vez. No hay validación que lo detecte. No está en
> `.env.example` hasta que el `01` la agregue.

### Grupo D — solo infraestructura

Credenciales que consume el compose, nunca el código de la aplicación.

```
POSTGRES_PASSWORD  (superusuario, solo bootstrap del contenedor)
HS_APP_PASSWORD  HS_MIGRATOR_PASSWORD  (los dos roles de ADR-002)
MINIO_ROOT_USER  MINIO_ROOT_PASSWORD  (solo bootstrap; la API usa la credencial limitada)
DOMINIO  API_TAG  (selección de dominio e imagen del release)
```

### Grupo E — backup fuera de la aplicación

Los consume únicamente el script de `08`. No entran en `compose.prod.yml`, en `api` ni en
`.env.prod`.

```
B2_ACCOUNT_ID  B2_ACCOUNT_KEY  RESTIC_REPOSITORY  RESTIC_PASSWORD_FILE
```

Viven en `/etc/hs-platform/restic.env` y en la custodia externa de la contraseña del
repositorio. No se imprimen ni se copian al proceso de la aplicación.

### Nunca llegan a producción

```
API_BASE_URL  DEMO_PASSWORD  DEMO_COORDINATOR_PASSWORD
DEMO_MANAGER_EMAIL  DEMO_MANAGER_PASSWORD   (estas dos ya no las lee nadie)
POSTGRES_PORT  S3_PORT  S3_CONSOLE_PORT      (solo el compose de desarrollo)
```

---

## Hechos del proyecto que condicionan el despliegue

Verificados en el código. Los documentos los citan; no hace falta revalidarlos.

| # | Hecho |
| --- | --- |
| H1 | **Node ≥ 22.12 es obligatorio.** `apps/api` es CommonJS y consume paquetes ESM por `require(esm)`. Con Node 20 compila y explota al arrancar. `.npmrc` fija `engine-strict=true` |
| H2 | **Orden de build:** `@hs/forms` → `@hs/contracts` → `apps/api` y `apps/web`. Se consumen por `exports` → `dist` |
| H3 | **`GET /health` es público.** `AppController` lo marca con `@Public()` para que el healthcheck del contenedor y el proxy funcionen sin sesión |
| H4 | **`VITE_API_BASE_URL` es build-time** y no tiene validación (ver grupo C) |
| H5 | **`start:prod` no carga ningún `.env`.** Todo tiene que ser variable de entorno real del contenedor |
| H6 | **`env.ts` valida el entorno entero antes de crear módulos.** En producción exige `sslmode` explícito, `TRUST_PROXY`, `BETTER_AUTH_URL` y `WEB_ORIGINS` https sin barra final |
| H7 | **`.npmrc` fija `node-linker=hoisted`**, con un comentario que advierte: *"el fallo no aparece en dev — aparece en el primer deploy"*. Los `@hs/*` se resuelven por symlink |
| H8 | **Orden de base obligatorio:** `db:migrate` → `db:jobs:install` → `db:seed`. `jobs:install` **después** de la migración 0008, o `hs_app` no puede tocar el esquema `pgboss` y el worker nunca consume |
| H9 | **Presupuesto de precache: 900 KiB, y el bundle mide 881.6 KiB.** Quedan ~18 KiB. Un `dist/` sucio rompe el build de web |
| H10 | **El cliente va en la raíz del dominio** y necesita **fallback SPA**. `sw.js` no está hasheado → `no-cache`; `assets/*` sí → inmutables. `skipWaiting` hace que un `sw.js` mal cacheado deje teléfonos pegados |
| H11 | **Las fotos van por PUT directo al bucket**, firmado con `ContentType` y `ContentLength`. Necesita CORS, que Caddy preserve el header `Host` (o se rompe SigV4) y sin límite de cuerpo por debajo de 25 MB |
| H12 | **pg-boss corre dentro del proceso** (12 conexiones por réplica), con crons a las 03:00 y 04:00 de Ontario. **El contenedor no puede dormir.** Un `open-period` que no corre **no produce ningún error** |
| H13 | **`shutdown.ts` usa `process.once('SIGTERM')`.** Con `ENTRYPOINT` en forma shell, Node no es PID 1 y nunca recibe la señal. `SHUTDOWN_GRACE_MS` debe ser menor que `stop_grace_period` |
| H14 | **`MIGRATION_DATABASE_URL` no la conoce `env.ts`** (ver grupo B) |
| H15 | **El compose de desarrollo trae credenciales literales** y publica 5432, 9000 y 9001. `docker-entrypoint-initdb.d` corre **una sola vez, con el volumen vacío**: con datos adentro no hay corrección sin borrar la base |
| H16 | **No hay recuperación de contraseña en producción.** `reset-password` se niega a propósito. Con **un solo** coordinador, si se bloquea, el sistema no tiene salida |
| H17 | **`db:seed` siembra identidad**, no solo datos de referencia (ver decisión 3) |
| H18 | **No hay correo transaccional ni Playwright.** Las invitaciones se entregan a mano por link; la imagen es liviana |

---

## Convenciones de los documentos

Cada documento numerado tiene **exactamente estas ocho secciones de primer nivel**, con
este texto y en este orden. Ni una más, ni una menos, ni renombradas:

```markdown
## 1. Precondiciones
## 2. Decisiones ya tomadas
## 3. Pasos
## 4. Verificación
## 5. Criterios de hecho
## 6. Si falla
## 7. Lo que este documento le pide a otro
## 8. Riesgos con datos reales
```

**Los pasos van como `###` dentro de la sección 3**, nunca como secciones de primer nivel:

```markdown
## 3. Pasos

### Paso 1 — <título>
### Paso 2 — <título>
```

Y cualquier título dentro de un paso —por ejemplo los de un archivo que el paso manda a
crear, como una ADR— baja a `####` o va dentro de un bloque de código.

**Las ocho van numeradas y en esas posiciones, siempre.** Un documento puede agregar
secciones propias —«Referencias», «Arranque, redeploy y rollback»— pero **después** de la
octava y **sin número**, para que la numeración signifique lo mismo en los diez.

Qué va en cada una:

1. **Precondiciones** — verificables con un comando, con su salida esperada
2. **Decisiones ya tomadas** — lo que no se re-decide, con una línea de porqué
3. **Pasos** — cada uno con comando literal, salida esperada y cómo saber que salió bien
4. **Verificación** — un bloque completo, repetible dentro de un mes
5. **Criterios de hecho** — checklist binaria y comprobable
6. **Si falla** — síntoma observable → causa probable → qué hacer, con el punto de retroceso
7. **Lo que este documento le pide a otro**
8. **Riesgos con datos reales** — lo que puede romperse de forma irreversible

Y tres reglas de redacción: sin emojis; el estado del sistema al entrar y al salir es
explícito; ningún documento muestra un valor de variable, solo su nombre.

---

## Referencias

- `CLAUDE.md` — idioma, comandos, arquitectura y las comprobaciones que son parte del build
- `README.md` de la raíz — los comandos y sus precondiciones
- `docs/adr/008-system-architecture.md` — la topología que el `01` supera con ADR-026
- `docs/adr/002-engine-enforced-immutability.md` — por qué hay dos roles de Postgres
- `docs/adr/006-object-storage-and-pdf.md` — por qué el bucket no tiene `DeleteObject`
- `docs/adr/011-authentication.md` — por qué no hay auto-registro y qué es una invitación
- `docs/adr/013-retirada-reportes-cumplimiento.md` — por qué ya no hace falta Chromium
