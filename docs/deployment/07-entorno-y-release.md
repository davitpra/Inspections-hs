# 07 — Entorno y release

**Qué resuelve.** Fija el valor de cada variable de entorno de la instalación, produce el
`.env.prod` del VPS, y define los procedimientos de arranque en frío, redeploy, rollback y
apagado. Al salir de este documento el sistema tiene una configuración completa y
reproducible.

**Qué NO resuelve.** El `compose.prod.yml` y el `Caddyfile` son del `03`. La creación de
los roles de Postgres es del `04`. La credencial del bucket es del `05`. El build del
cliente es del `06` — acá se fija el valor de `VITE_API_BASE_URL`, no el procedimiento.

**Artefactos que este documento crea o modifica.**

- `.env.prod` (en el VPS, **nunca commiteado**) — nuevo
- La matriz de variables de esta instalación — vive acá y en ningún otro lado

Si un paso te lleva a tocar algo que no está en esta lista, pará: es de otro documento.

---

## 1. Precondiciones

### El dominio está elegido

Necesitás `<DOMINIO>` resuelto antes de escribir una variable: `BETTER_AUTH_URL`,
`WEB_ORIGINS`, `S3_ENDPOINT` y `VITE_API_BASE_URL` lo llevan adentro.

### Sabés generar secretos

```bash
openssl rand -base64 48 | tr -d '\n' | head -c 64; echo
```

Tiene que imprimir 64 caracteres. Si `openssl` no está, `head -c 48 /dev/urandom | base64`
sirve igual.

### `.env.*` está ignorado por git

```bash
grep -n "^\.env" .gitignore
```

Tiene que mostrar `.env` y `.env.*`, con `!.env.example` como excepción. Si `.env.prod`
pudiera commitearse, este documento no empieza.

### Leíste `apps/api/src/env.ts`

Es la fuente de verdad de todo lo que sigue. Valida el entorno **entero** antes de
construir un solo módulo, y sus mensajes nombran la variable y el problema pero **nunca el
valor** — la mitad son secretos y el log de arranque termina en la consola del servidor.

---

## 2. Decisiones ya tomadas

| # | Decisión | Por qué |
| --- | --- | --- |
| D1 | `sslmode=disable`, **escrito explícitamente** | La base vive en la red privada de Docker, en la misma máquina. El tráfico no sale del host. `env.ts` acepta `disable` solo si está declarado, y `main.ts` deja un aviso en el log |
| D2 | `TRUST_PROXY=1` | Caddy es el único salto delante de la API |
| D3 | `SHUTDOWN_GRACE_MS=8000`, con `stop_grace_period: 30s` en el compose | El default de Compose son 10 s y dejaría 2 s de margen. El valor del compose se lo pido al `03` |
| D4 | `JOBS_ENABLED=true`, siempre | Los dos crons viven dentro del proceso. Sin ellos no se abren períodos ni se escalan acciones |
| D5 | `MIGRATION_DATABASE_URL` **nunca** en el servicio `api` | Es la credencial del rol dueño, que evade RLS. Ver la advertencia del grupo B |
| D6 | Los secretos viven en `.env.prod` en el VPS, con permisos `600` | No hay gestor de secretos en esta topología, y agregarlo sería una quinta pieza |

---

## 3. Pasos

### Paso 1 — Grupo A: las variables del proceso de la API

Van en el `environment:` del servicio `api`. Las valida `apps/api/src/env.ts` enteras,
antes de crear ningún módulo: un despliegue con tres variables mal puestas falla **una vez**
y con los tres problemas listados, no en tres reinicios.

| Variable | Obligatoria | Valor para esta instalación | Si la ponés mal |
| --- | --- | --- | --- |
| `NODE_ENV` | sí | `production` | Sin esto no se activan las reglas de producción y los defaults de desarrollo llegan tal cual |
| `PORT` | no (def. `3000`) | `3000` | Entero 1–65535 o el arranque falla |
| `DATABASE_URL` | sí | `postgresql://hs_app:<HS_APP_PASSWORD>@db:5432/hs_platform?sslmode=disable` | Ver el Paso 2 |
| `BETTER_AUTH_SECRET` | sí, ≥32 | generado, 64 caracteres | Ver el Paso 5 |
| `BETTER_AUTH_URL` | sí en prod | `https://api.<DOMINIO>` | El arranque falla con `BETTER_AUTH_URL: obligatoria en producción` |
| `JOBS_ENABLED` | no (def. `true`) | `true` | Ver el Paso 4 |
| `WEB_ORIGINS` | sí en prod | `https://app.<DOMINIO>` | Ver el Paso 3 |
| `TRUST_PROXY` | sí en prod | `1` | Ver el Paso 3 |
| `SHUTDOWN_GRACE_MS` | no (def. `8000`) | `8000` | Ver el Paso 6 |
| `S3_BUCKET` | sí | `hs-platform` | El módulo de uploads no construye |
| `S3_ACCESS_KEY_ID` | sí | la credencial limitada fijada acá y materializada por el `05` | idem |
| `S3_SECRET_ACCESS_KEY` | sí | idem | idem |
| `S3_ENDPOINT` | no, pero acá sí | `https://s3.<DOMINIO>` | En producción tiene que ser https, o el arranque falla |
| `S3_REGION` | no (def. `us-east-1`) | `us-east-1` | MinIO la ignora, pero SigV4 la firma |
| `S3_FORCE_PATH_STYLE` | no (def. `true`) | `true` | MinIO sirve por path, no por subdominio de bucket |
| `S3_UPLOAD_TTL_SECONDS` | no (def. `300`) | `300` | Tiene que ser entero positivo; antes de `env.ts`, un valor no numérico daba un TTL `NaN` |

**El bucket y su política son del `05`.** Esta matriz fija el par de credenciales que el `05`
materializa en MinIO y que después consume la API.

### Paso 2 — `DATABASE_URL` y por qué `sslmode` va escrito

`env.ts` acepta en producción exactamente dos modos, y rechaza los demás:

```bash
grep -n "PRODUCTION_SSL_MODES" -A2 apps/api/src/env.ts
```

`require`, `prefer` y `verify-ca` se rechazan **aunque parezcan seguros**. El comentario del
archivo lo explica: `pg` 8 los trata hoy como alias de `verify-full`, y anunció que en su
próxima mayor pasan a significar lo de libpq, que es cifrar sin verificar el certificado. Un
`require` que hoy protege y mañana no, sin cambiar una letra de la configuración, no es una
opción.

En esta topología corresponde `disable`, y tiene que estar **escrito**:

```
DATABASE_URL=postgresql://hs_app:<HS_APP_PASSWORD>@db:5432/hs_platform?sslmode=disable
```

`db` es el nombre del servicio del compose, y resuelve por la red interna de Docker. El
tráfico entre la API y la base no sale del host.

`main.ts` deja un aviso en cada arranque cuando ve `disable`. **Ese aviso es correcto y no
se silencia**: el día que la base se mueva fuera de la máquina, es lo único que va a
recordarte que la URL quedó sin TLS.

### Paso 3 — `TRUST_PROXY` y `WEB_ORIGINS`: las dos que fallan raro

Estas dos no rompen el arranque si las ponés mal. Rompen otra cosa, más tarde, con un
síntoma que no las menciona.

**`TRUST_PROXY=1`.** Decide qué valor toma `request.ip`, y de ahí dependen dos cosas: el
límite de intentos de login y la IP que queda guardada en la sesión.

Leé lo que dice `apps/api/src/rate-limit.ts` sobre esto:

```bash
grep -n "TRUST_PROXY" -B4 -A4 apps/api/src/rate-limit.ts
```

Con `0` detrás de Caddy, **todos** los requests llegan con la IP del proxy. El límite deja
de ser por red y pasa a ser global: 30 intentos de cualquiera bloquean el login de toda la
planta. Con Caddy delante el valor es `1`, no `true` — `true` confiaría en todo el
`X-Forwarded-For` y cualquiera podría inventarse una IP distinta en cada intento.

**`WEB_ORIGINS=https://app.<DOMINIO>`.** Orígenes pelados: sin barra final, sin ruta, sin
comodín. Se comparan byte a byte contra el header `Origin`, que nunca trae barra final.

`https://app.<DOMINIO>/` **no coincide con nada**, y el síntoma no es un error de arranque:
es una PWA que muere con «Failed to fetch» en todas las pantallas. Por eso `env.ts` valida
la forma en todo entorno, y la presencia y el `https` solo en producción.

Nunca `*`. Un comodín le daría a cualquier página del navegador del inspector permiso para
hablarle a la API con su sesión.

### Paso 4 — `JOBS_ENABLED=true`, y el cron que falla en silencio

`apps/api/src/jobs/job-registry.ts` declara dos crons:

```bash
grep -n "OPEN_PERIOD_CRON\|ESCALATE_OVERDUE_CRON\|SITE_TIME_ZONE" apps/api/src/jobs/job-registry.ts
```

```
OPEN_PERIOD_CRON       = '0 3 * * *'      apertura de períodos
ESCALATE_OVERDUE_CRON  = '0 4 * * *'      escalamiento de acciones vencidas
SITE_TIME_ZONE         = 'America/Toronto'
```

Tres consecuencias para el despliegue:

1. **`JOBS_ENABLED` vale `true`.** Con `false` la API sirve HTTP y el planificador no
   arranca. Esa salida existe para desarrollo, no para esta instalación.
2. **El contenedor no puede dormir ni escalar a cero.** A las 03:00 tiene que estar vivo.
3. **Un `open-period` que no corre no produce ningún error.** El síntoma aparece semanas
   después, cuando falta la inspección del mes. La verificación periódica es del `10`.

La zona horaria la declara el código, no el host: `SITE_TIME_ZONE` va en cada `schedule()`.
Aun así, conviene que el VPS tenga NTP andando y el reloj correcto.

### Paso 5 — `BETTER_AUTH_SECRET`: generarlo una vez y no perderlo

```bash
openssl rand -base64 48 | tr -d '\n' | head -c 64; echo
```

Mínimo 32 caracteres; 64 no cuesta nada más.

> **Este secreto se genera UNA vez y no cambia nunca más.**
>
> Si un redeploy lo regenera, **todas las sesiones se invalidan a la vez**. El peor momento
> posible: inspectores en la planta, con el outbox cargado y sin poder volver a entrar. Y no
> hay recuperación de contraseña por comando en producción (`reset-password` se niega a
> propósito), así que la salida es que un coordinador reemita invitaciones una por una.

Por eso vive en `.env.prod` y no en un `docker run -e` escrito a mano. Y por eso el redeploy
lo verifica antes de levantar nada:

```bash
sha256sum <<< "$BETTER_AUTH_SECRET" | cut -c1-12
```

Anotá esos doce caracteres al desplegar por primera vez. Si cambian, parás.

### Paso 6 — El apagado

`SHUTDOWN_GRACE_MS=8000` es cuánto espera el proceso a los requests en vuelo antes de
cortarlos. Tiene que ser **menor** que la gracia que la plataforma da entre SIGTERM y
SIGKILL, o el contenedor muere antes de que el cierre ordenado alcance a correr.

El default de Compose son 10 segundos: quedan 2 de margen, que no alcanzan para que pg-boss
termine sus trabajos en vuelo. **Le pido al `03` que declare `stop_grace_period: 30s`** en el
servicio `api`.

Lo que pasa en esos segundos está en `apps/api/src/shutdown.ts`, y el orden es a mano y no
el de Nest: primero se deja de aceptar conexiones, después se cierra la base. Al revés —que
es lo que hace `enableShutdownHooks()`— la API sigue aceptando requests con el pool ya
cerrado, y un envío que cae en ese medio segundo muere en 500.

### Paso 7 — Grupo B: las variables de los comandos one-off

Van **solo** en el `docker compose run --rm` que las necesita. Nunca en el servicio `api`.

| Variable | Quién la lee | Valor |
| --- | --- | --- |
| `MIGRATION_DATABASE_URL` | `drizzle-kit`, `seed.mjs`, `jobs-install.mjs` | `postgresql://hs_migrator:<HS_MIGRATOR_PASSWORD>@db:5432/hs_platform?sslmode=disable` |
| `DATABASE_URL` | `create-account.mjs`, `bootstrap-invitation.mjs`, `roster-import.mjs` | el mismo del grupo A |

> ### `MIGRATION_DATABASE_URL` no entra al servicio `api`. Nunca.
>
> Es la credencial de `hs_migrator`, que es **dueño de las tablas**, y el dueño de una tabla
> evade `FORCE ROW LEVEL SECURITY`. Meterla en el proceso de larga vida anula el aislamiento
> por sitio de ADR-004 para todo lo que ese proceso haga.
>
> `apps/api/src/db/db.service.ts` lo tiene escrito como invariante. Verificalo:
> ```bash
> grep -n "MIGRATION_DATABASE_URL" -B2 -A2 apps/api/src/db/db.service.ts
> ```
>
> Y lo peor: **`env.ts` no conoce esta variable**, así que si la ponés de más, nada falla y
> nadie te avisa. La única defensa es que esté escrito acá y que el `03` no la declare en
> el servicio.

### Paso 8 — Grupo C: la variable del build del cliente

```
VITE_API_BASE_URL=https://api.<DOMINIO>
```

Es **build-time**. Vite la inlinea en el bundle; `apps/web/src/api/client.ts:11` cae a
`http://localhost:3000` si falta.

No hay validación que lo detecte. Si se olvida, la PWA sale a producción apuntando a
localhost y falla en todos los dispositivos a la vez, y **no se arregla sin recompilar**.

El procedimiento de build es del `06`. El valor es este.

### Paso 9 — Grupo D: las credenciales de infraestructura

Las consume el compose (`03`) y la parametrización de roles (`04`). No las lee ningún
archivo de `apps/api`.

| Variable | Para qué |
| --- | --- |
| `POSTGRES_PASSWORD` | El superusuario del contenedor. Solo bootstrap: ninguna aplicación lo usa |
| `HS_MIGRATOR_PASSWORD` | El rol dueño del esquema (ADR-002) |
| `HS_APP_PASSWORD` | El rol del runtime, sin `UPDATE`/`DELETE` por default |
| `MINIO_ROOT_USER` | Raíz de MinIO. Solo bootstrap |
| `MINIO_ROOT_PASSWORD` | idem |
| `DOMINIO` | Arma los tres subdominios en el compose y en el Caddyfile |
| `API_TAG` | La etiqueta de la imagen que levanta el compose. El hash corto del commit |

Las cinco credenciales se generan con el mismo comando del Paso 5. `DOMINIO` y `API_TAG` son
selecciones de la instalación, no secretos. **Ninguno reusa un valor del
`docker-compose.yml` de desarrollo**, que trae `postgres`, `minioadmin` y `hs_app_dev`
literales.

### Paso 10 — Escribir `.env.prod` en el VPS

```bash
cat > .env.prod <<'EOF'
# Producción. Ver docs/deployment/07-entorno-y-release.md.
#
# Este archivo NO se commitea y vive solo en el VPS, con permisos 600. No hay gestor
# de secretos en esta topología: agregarlo sería una quinta pieza para mantener.
#
# `start:prod` es `node dist/main` y NO lee ningún .env: estas variables llegan al
# proceso porque el compose las inyecta, no porque Node las lea de un archivo.

NODE_ENV=production
PORT=3000

# --- El despliegue: las lee el compose, no el codigo ------------------------
# DOMINIO arma los tres subdominios. API_TAG es el hash corto del commit de la
# imagen: nunca `latest`, o el dia del rollback nadie sabe que estaba corriendo.
DOMINIO=<DOMINIO>
API_TAG=<HASH_CORTO_DEL_COMMIT>

# --- Grupo D: credenciales de infraestructura -------------------------------
# Generadas una vez con: openssl rand -base64 48 | tr -d '\n' | head -c 64
# NINGUNA reusa un valor del docker-compose.yml de desarrollo.
POSTGRES_PASSWORD=<GENERAR>
HS_MIGRATOR_PASSWORD=<GENERAR>
HS_APP_PASSWORD=<GENERAR>
MINIO_ROOT_USER=<GENERAR>
MINIO_ROOT_PASSWORD=<GENERAR>

# --- Grupo A: el proceso de la API ------------------------------------------
# sslmode=disable ESCRITO, no omitido: env.ts lo exige explícito y main.ts avisa
# en cada arranque. El aviso es correcto y no se silencia.
DATABASE_URL=postgresql://hs_app:<HS_APP_PASSWORD>@db:5432/hs_platform?sslmode=disable

# Se genera UNA vez y no cambia nunca. Cambiarlo invalida todas las sesiones a la
# vez, y en producción no hay reset de contraseña por comando.
BETTER_AUTH_SECRET=<GENERAR>
BETTER_AUTH_URL=https://api.<DOMINIO>

# Origen pelado: sin barra final, sin ruta, sin comodín. Se compara byte a byte
# contra el header Origin. Una barra de más deja la PWA en «Failed to fetch».
WEB_ORIGINS=https://app.<DOMINIO>

# 1 = solo Caddy delante. En 0, todos los logins comparten la IP del proxy y 30
# intentos de cualquiera bloquean a toda la planta.
TRUST_PROXY=1

# Menor que el stop_grace_period del servicio (30s), o la plataforma corta antes
# de que el cierre ordenado alcance a correr.
SHUTDOWN_GRACE_MS=8000

# Los dos crons (03:00 y 04:00, America/Toronto) viven dentro del proceso.
JOBS_ENABLED=true

# --- Grupo A: almacenamiento de objetos -------------------------------------
# El documento 05 materializa este par en MinIO: PutObject y GetObject sobre el prefijo,
# y SIN DeleteObject. Esa ausencia es la mitad de ADR-006 que el código no aplica.
S3_ENDPOINT=https://s3.<DOMINIO>
S3_BUCKET=hs-platform
S3_ACCESS_KEY_ID=<GENERAR>
S3_SECRET_ACCESS_KEY=<GENERAR>
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
S3_UPLOAD_TTL_SECONDS=300

# --- Grupo B: SOLO para los comandos one-off --------------------------------
# NO se declara en el servicio `api`. Es la credencial del rol DUEÑO, que evade
# FORCE ROW LEVEL SECURITY. env.ts no la conoce, así que ponerla de más no falla:
# no lo hagas.
MIGRATION_DATABASE_URL=postgresql://hs_migrator:<HS_MIGRATOR_PASSWORD>@db:5432/hs_platform?sslmode=disable
EOF

chmod 600 .env.prod
```

**Cómo sé que salió bien.** No quedó ningún placeholder sin reemplazar:

```bash
! grep -n "<GENERAR>\|<DOMINIO>\|<HS_" .env.prod && echo "sin placeholders"
stat -c '%a %n' .env.prod   # tiene que decir 600
```

---

## 4. Verificación

```bash
# 1. Ninguna variable del grupo B llegó al proceso de la API.
docker compose --env-file .env.prod -f compose.prod.yml exec api printenv | grep -c MIGRATION_DATABASE_URL
```

Tiene que imprimir `0`. Si imprime `1`, pará el despliegue y corregí el compose: el proceso
está corriendo con una credencial que evade RLS.

```bash
# 2. El entorno pasa la validación: la API arrancó.
docker compose --env-file .env.prod -f compose.prod.yml logs api | grep -i "EnvError" && echo "FALLÓ" || echo "entorno válido"
```

```bash
# 3. El aviso de sslmode=disable está presente. Es lo esperado, no un problema.
docker compose --env-file .env.prod -f compose.prod.yml logs api | grep "sslmode=disable"
```

```bash
# 4. request.ip es la del cliente y no la de Caddy. Esto prueba TRUST_PROXY.
curl -s -o /dev/null -w '%{http_code}\n' https://api.<DOMINIO>/health
docker compose --env-file .env.prod -f compose.prod.yml logs --tail=20 api
```

```bash
# 5. CORS responde al origen real y solo a ese.
curl -s -I -X OPTIONS https://api.<DOMINIO>/auth/sign-in \
  -H "Origin: https://app.<DOMINIO>" \
  -H "Access-Control-Request-Method: POST" | grep -i "access-control-allow-origin"

curl -s -I -X OPTIONS https://api.<DOMINIO>/auth/sign-in \
  -H "Origin: https://malicioso.example" \
  -H "Access-Control-Request-Method: POST" | grep -i "access-control-allow-origin" \
  && echo "FALLÓ: acepta cualquier origen" || echo "correcto: solo el origen declarado"
```

```bash
# 6. Los dos crons quedaron registrados, una vez cada uno.
docker compose --env-file .env.prod -f compose.prod.yml exec db \
  psql -U hs_migrator -d hs_platform -c "SELECT name, cron, timezone FROM pgboss.schedule ORDER BY name;"
```

Dos filas, con `0 3 * * *` y `0 4 * * *`, las dos en `America/Toronto`.

```bash
# 7. La huella del secreto, para poder compararla en el próximo despliegue.
docker compose --env-file .env.prod -f compose.prod.yml exec api \
  sh -c 'printf "%s" "$BETTER_AUTH_SECRET" | sha256sum | cut -c1-12'
```

Anotá el resultado.

---

## 5. Criterios de hecho

- [ ] `.env.prod` existe en el VPS con permisos `600` y sin ningún placeholder
- [ ] `.env.prod` **no** aparece en `git status`
- [ ] `MIGRATION_DATABASE_URL` no está en el entorno del servicio `api` (verificado, no asumido)
- [ ] Las cinco credenciales del grupo D son valores generados, ninguno del compose de desarrollo
- [ ] `BETTER_AUTH_SECRET` tiene 32 caracteres o más, y su huella está anotada
- [ ] `DATABASE_URL` declara `sslmode=disable` de forma explícita
- [ ] `TRUST_PROXY` vale `1`
- [ ] `WEB_ORIGINS` es un origen https, sin barra final ni ruta
- [ ] `JOBS_ENABLED` vale `true` y las dos filas de `pgboss.schedule` existen
- [ ] La API arranca sin `EnvError`
- [ ] CORS acepta el origen de la PWA y rechaza cualquier otro
- [ ] `VITE_API_BASE_URL` está fijada y entregada al `06`

---

## 6. Si falla

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| `EnvError` con varias líneas al arrancar | Faltan variables o tienen forma inválida | El mensaje las nombra todas de una vez. Corregí `.env.prod` y reiniciá. Los mensajes nunca muestran el valor: es a propósito |
| `DATABASE_URL: en producción tiene que declarar sslmode=...` | La URL no lo declara, o usa `require`/`prefer`/`verify-ca` | Agregá `?sslmode=disable`. Los otros tres se rechazan porque `pg` va a cambiar su significado |
| `WEB_ORIGINS: cada entrada tiene que ser un origen pelado` | Barra final, ruta o comodín | Dejá solo `https://app.<DOMINIO>` |
| La PWA dice «Failed to fetch» en todas las pantallas, y la API está sana | `WEB_ORIGINS` no coincide byte a byte con el `Origin` del navegador | Comparalos con la verificación 5. Una barra final basta |
| Los inspectores se quedan sin sesión tras un redeploy | `BETTER_AUTH_SECRET` cambió | Restaurá el valor anterior desde el backup de `.env.prod` y reiniciá. Si se perdió, no hay vuelta: un coordinador reemite invitaciones una por una |
| El login se bloquea para todos tras unos pocos intentos | `TRUST_PROXY=0` detrás de Caddy | Ponelo en `1` y reiniciá. Los contadores viven en memoria por proceso, así que el reinicio los limpia |
| La API no arranca: «El esquema `pgboss` no está instalado» | Falta `db:jobs:install` | Es del `04`, y es un paso de despliegue, no de arranque |
| El período del mes no se abrió y no hay ningún error | `JOBS_ENABLED` en `false`, el contenedor reiniciado, o el reloj del host mal | Verificación 6, y después el `10` |
| `pgboss.schedule` con filas duplicadas | No debería pasar: `schedule` es un upsert por nombre de cola | Verificá que no se haya renombrado una cola entre despliegues |

**Punto de retroceso.** Cambiar una variable y reiniciar es reversible. **Perder
`BETTER_AUTH_SECRET` no lo es.** Y una migración aplicada tampoco: ver abajo.

---

## 7. Lo que este documento le pide a otro

| Documento | Qué necesita |
| --- | --- |
| `03-infraestructura.md` | `stop_grace_period: 30s` en el servicio `api` |
| `03-infraestructura.md` | **No declarar `MIGRATION_DATABASE_URL` en el `environment:` del servicio `api`.** Solo en los `run --rm` que la necesitan |
| `03-infraestructura.md` | Inyectar `.env.prod` con `--env-file` e `environment:` **explícito**. `env_file:` volcaría el archivo entero al proceso, incluida `MIGRATION_DATABASE_URL` |
| `03-infraestructura.md` | NTP andando en el VPS: los crons son civiles, no de UTC |
| `04-postgres.md` | Crear los roles con `HS_APP_PASSWORD` y `HS_MIGRATOR_PASSWORD`, no con los literales de desarrollo |
| `05-objetos-minio.md` | Entregar `S3_ACCESS_KEY_ID` y `S3_SECRET_ACCESS_KEY` de la credencial limitada, sin `DeleteObject` |
| `06-cliente-web.md` | `VITE_API_BASE_URL=https://api.<DOMINIO>`, en el build |
| `08-backups.md` | Incluir `.env.prod` en el backup. Sin `BETTER_AUTH_SECRET` no hay restauración útil: la base vuelve y las sesiones no |
| `10-operacion.md` | La verificación periódica de que el cron de las 03:00 abrió el período |

---

## 8. Riesgos con datos reales

**`BETTER_AUTH_SECRET` regenerado.** Invalida todas las sesiones a la vez, con inspectores
en la planta y el outbox cargado. Sin reset de contraseña por comando en producción, la
salida es reemitir invitaciones una por una. Se evita guardándolo en `.env.prod`,
incluyéndolo en el backup y comparando su huella en cada redeploy.

**`MIGRATION_DATABASE_URL` en el proceso de la API.** Anula el aislamiento por sitio para
todo lo que ese proceso haga, y **no falla, no avisa y no aparece en ningún log**. El daño
es silencioso y retroactivo. Se evita con la verificación 1, que se corre siempre.

**Rollback con una migración aplicada.** No hay `down`. Un rollback improvisado sobre datos
reales puede dejar el esquema en un estado que ninguna versión del código entiende. El único
camino es la restauración del `08`.

**`.env.prod` commiteado por error.** Publica las cinco credenciales de infraestructura y el
secreto de sesión. `.gitignore` lo cubre, pero verificalo con `git status` antes de cada
commit hecho desde el VPS.

---

## Arranque, redeploy y rollback

### Arranque en frío

```
07  escribir y verificar `.env.prod` (antes de levantar los servicios)
03  levantar la infraestructura (compose, Caddy, TLS)
04  roles, migraciones, esquema de trabajos, seeds
05  bucket, credencial, CORS
06  construir y publicar el cliente
    levantar el servicio `api`
08  instalar y VERIFICAR el backup     <-- antes de que entre un dato real
09  roster, cuentas, verificación end-to-end
```

### Redeploy

```bash
TAG=$(git rev-parse --short HEAD)
# 1. La huella del secreto no cambió.
docker compose --env-file .env.prod -f compose.prod.yml exec api \
  sh -c 'printf "%s" "$BETTER_AUTH_SECRET" | sha256sum | cut -c1-12'
# 2. Migraciones nuevas, si las hay (documento 04).
# 3. Reemplazar el servicio.
docker compose --env-file .env.prod -f compose.prod.yml up -d --no-deps api
```

`--no-deps` evita reiniciar la base y MinIO por un cambio que es solo de la API.

Los crons no se duplican: `schedule` es un upsert por nombre de cola, y el comentario de
`jobs.service.ts` lo dice. Un despliegue que cambia un cron lo reemplaza.

### Rollback

> **Las migraciones de este proyecto no tienen vuelta atrás.** No hay un solo archivo
> `down` en `apps/api/drizzle/`. Verificalo: `ls apps/api/drizzle/ | grep -i down` no
> devuelve nada.

Eso parte el rollback en dos casos:

**Sin migración nueva.** Volvé a la imagen anterior y listo:

```bash
docker compose --env-file .env.prod -f compose.prod.yml up -d --no-deps api   # con el TAG anterior
```

**Con migración nueva ya aplicada.** La imagen vieja puede no entender el esquema nuevo. No
improvises: restaurá desde el backup del `08`, que es el único camino verificado. Por eso el
`08` va antes que el `09`.

### Apagado

```bash
docker compose --env-file .env.prod -f compose.prod.yml stop api
```

Con `stop_grace_period: 30s` y `SHUTDOWN_GRACE_MS=8000`, el log tiene que mostrar el cierre
ordenado. Si el contenedor tarda 30 segundos y muere sin decir nada, no recibió la señal:
volvé al `02`, sección 4, sonda de SIGTERM.

---

---

## Referencias

- `docs/deployment/README.md` — los cuatro grupos de variables y la propiedad de artefactos
- `apps/api/src/env.ts` — qué se valida, cuándo, y por qué los mensajes no muestran valores
- `apps/api/src/cors.ts` — por qué nunca `*`
- `apps/api/src/rate-limit.ts` — qué depende de `TRUST_PROXY`
- `apps/api/src/shutdown.ts` — el orden de apagado, invertido a mano
- `apps/api/src/jobs/job-registry.ts` — los dos crons y la zona horaria
- `apps/api/src/db/db.service.ts` — por qué `MIGRATION_DATABASE_URL` no entra al proceso
- ADR-002, ADR-004 — los dos roles y el aislamiento por RLS
- ADR-011 — por qué no hay auto-registro ni reset de contraseña en producción
