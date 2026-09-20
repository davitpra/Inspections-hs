# 04 — Postgres: los roles, el esquema, los trabajos y los seeds

**Qué resuelve.** Deja la base con sus dos roles creados con credenciales reales, el
esquema migrado, el esquema `pgboss` instalado **en el orden correcto** y los datos de
referencia sembrados, incluida la primera cuenta con los datos de la persona real.

**Qué NO resuelve.** El `compose.prod.yml` y el `Caddyfile` son del `03`. Los valores de
las variables son del `07`, que también es el dueño del arranque de la API. El bucket es
del `05`. El roster completo y la credencial del coordinador son del `09`.

**Estado al entrar.** `03` dejó solo `caddy` levantado; `db` todavía no fue inicializada y
**su volumen `db-data` no tiene ni una tabla de la aplicación**. `api` no arranca —le falta el
esquema `pgboss`— y eso es lo esperado.
`db/init/01-roles.sql` todavía crea los dos roles con contraseñas literales de desarrollo.
`apps/api/seeds/004_bootstrap_coordinator.sql` todavía siembra la persona de relleno.

**Estado al salir.** `hs_migrator` y `hs_app` existen con las contraseñas de `.env.prod`.
Las 51 migraciones están aplicadas. El esquema `pgboss` está instalado y `hs_app` tiene
`SELECT/INSERT/UPDATE/DELETE` sobre sus tablas, comprobado contra el catálogo. Los seis
seeds están aplicados y el roster tiene **una** persona: el coordinador real. Un `UPDATE`
con el rol de la aplicación falla en el motor. La API ya puede arrancar.

**Artefactos que este documento crea o modifica.**

- `db/init/01-roles.sh` — nuevo. El que ejecuta el entrypoint de Postgres
- `db/init/sql/01-roles.sql` — el archivo de hoy, movido y parametrizado. **Este documento
  es el único dueño de su parametrización**
- `docker-compose.yml` (el **de desarrollo**, no el de producción) — dos líneas, para que
  `pnpm db:reset` siga funcionando después del cambio de arriba
- `apps/api/seeds/004_bootstrap_coordinator.sql` — la **ejecución** de la edición que
  especificó el `01`, Paso 6

`compose.prod.yml` no está en esa lista y no se toca acá: lo que este documento necesita de
él está en la sección 7.

---

## 1. Precondiciones

### 1.1 El `03` está ejecutado y `db` todavía no está inicializada

```bash
ssh <USUARIO>@<HOST_VPS> 'cd /srv/hs-platform && docker compose --env-file .env.prod -f compose.prod.yml ps -a db'
```

No tiene que haber un contenedor `db` inicializado con tablas de la aplicación. Si existe y está
`healthy`, el Paso 3 comprueba primero el volumen y decide si todavía se puede recrear sin datos.

### 1.2 El volumen de la base está vacío de datos de la aplicación

**Esta es la precondición que manda sobre todas las demás.**

```bash
ssh <USUARIO>@<HOST_VPS> "cd /srv/hs-platform && docker compose --env-file .env.prod -f compose.prod.yml up -d db && docker compose --env-file .env.prod -f compose.prod.yml exec -T db \
  psql -U postgres -d hs_platform -Atc \"SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('public','pgboss')\""
```

Esperado: `0`. Este arranque inicial solo sirve para inspeccionar el volumen; el Paso 3 lo
recrea con `db/init/` ya copiado. Si devuelve otra cosa, **este documento ya se corrió** —total o
parcialmente— y no se empieza de cero: se va a la sección 6 y se busca el síntoma.

### 1.3 Los roles todavía no existen, o existen mal

```bash
ssh <USUARIO>@<HOST_VPS> "cd /srv/hs-platform && docker compose --env-file .env.prod -f compose.prod.yml exec -T db \
  psql -U postgres -Atc \"SELECT rolname FROM pg_roles WHERE rolname IN ('hs_app','hs_migrator') ORDER BY 1\""
```

Dos salidas posibles, y las dos tienen camino:

- **Vacío.** El `03` levantó `db` antes de que existiera `db/init/`, tal como su Paso 6
  permite. Los roles no se crearon. Como no hay datos (1.2), el camino es el Paso 3 con un
  `down -v` previo, que en este punto no cuesta nada.
- **Las dos líneas.** Los roles se crearon con los literales de desarrollo. También sin
  datos, así que también se resuelve con `down -v` en el Paso 3.

Lo que **no** puede pasar es llegar acá con datos reales y roles mal creados. Si eso pasó,
la salida es `ALTER ROLE` y está en la sección 6, fila 1.

### 1.4 La imagen existe y `.env.prod` declara las cinco variables de este documento

```bash
ssh <USUARIO>@<HOST_VPS> "docker images hs-platform-api --format '{{.Tag}}'"
ssh <USUARIO>@<HOST_VPS> "cut -d= -f1 /srv/hs-platform/.env.prod | grep -xE 'POSTGRES_PASSWORD|HS_APP_PASSWORD|HS_MIGRATOR_PASSWORD|DATABASE_URL|MIGRATION_DATABASE_URL' | sort"
```

El segundo comando tiene que imprimir los cinco nombres, uno por línea. `cut -d= -f1`
está a propósito: imprime el nombre y nunca el valor.

### 1.5 Los cuatro datos del coordinador real, a mano

El Paso 7 **no se puede ejecutar sin ellos** y el Paso 8 no se puede ejecutar sin el Paso 7.
Los especifica el `01`, Paso 6, y son:

1. Nombre y apellido tal como van a figurar en el roster.
2. El número de legajo **real** de ADP.
3. El email corporativo.
4. En cuál de las dos plantas está la persona.

No hay comando que verifique esto. Si alguno de los cuatro no está definitivo, se para acá:
después del Paso 8 no hay vuelta atrás (sección 8, R1).

---

## 2. Decisiones ya tomadas

| # | Decisión | Por qué |
| --- | --- | --- |
| D1 | El script de roles se parte en **un `.sh` que ejecuta el entrypoint** y **un `.sql` que vive en `db/init/sql/`** | `docker-entrypoint-initdb.d` corre los `.sql` con `psql` sin variables y los `.sh` con el entorno del contenedor. Un `.sh` es la única forma de que el script vea `HS_APP_PASSWORD`. El `.sql` baja a un subdirectorio porque el entrypoint **ignora los directorios**: si se quedara arriba, se ejecutaría dos veces, y la segunda sin variables |
| D2 | Las contraseñas viajan a `psql` por `--set` y se interpolan con `:'nombre'` | `:'x'` produce un literal SQL correctamente escapado. Un `envsubst` sobre una plantilla escribiría el secreto a un archivo en disco y lo dejaría ahí |
| D3 | El script **falla ruidoso** si falta alguna de las dos variables. Sin valor por default | Un default silencioso es exactamente el fallo que este documento existe para evitar: `hs_app/hs_app_dev` en un VPS. Que `db` no arranque es el resultado correcto |
| D4 | El compose **de desarrollo** recibe los dos literales de desarrollo escritos | Es el mismo criterio que D2 del `03`: el de desarrollo trae credenciales literales y el de producción no trae ninguna. Así `pnpm db:reset` sigue funcionando sin configuración |
| D5 | El script **no** se hace idempotente con `CREATE ROLE ... IF NOT EXISTS` / `ALTER ROLE` | Un script que reescribe contraseñas cada vez que se lo corre es un arma distinta. La corrección sobre una base viva es un procedimiento consciente, no un efecto secundario del arranque (sección 6, fila 1) |
| D6 | El orden es `migrate` → `jobs:install` → `seed`, y los tres por el servicio `migrator` | H8. `jobs:install` antes de la migración 0008 es irreversible en la práctica: ver el Paso 6 |
| D7 | La edición del seed se ejecuta **acá**, y **antes** de reconstruir la imagen | El `01` D7 la preparó y la dejó con dueño. La imagen se construye desde el árbol del repositorio (`COPY . .`), así que el seed que corre es el que estaba al construir, no el del disco del VPS |
| D8 | Las consultas de verificación de privilegios corren como el superusuario `postgres` | Dos razones, y las dos producen un cero engañoso si se ignoran: `information_schema.table_privileges` solo muestra las filas de roles habilitados para el que consulta, y las tablas con `FORCE ROW LEVEL SECURITY` le devuelven cero filas incluso a `hs_migrator` si no hay `app.site_ids` declarado |

---

## 3. Pasos

### Paso 1 — Parametrizar el script de roles

Esto se hace **en el repositorio**, en tu máquina, y se copia al VPS en el Paso 3.

#### Por qué el archivo de hoy no sirve en producción

`db/init/01-roles.sql` crea los dos roles con `'hs_migrator_dev'` y `'hs_app_dev'`
escritos. Su propio encabezado dice que *"en los entornos gestionados los roles se crean con
el mismo script y credenciales de secreto"* — **pero no hay nada en el archivo que lo
permita**. Copiado tal cual al VPS deja `hs_app` con una contraseña que está publicada en el
repositorio, en una base que está detrás de Caddy y de `ufw` pero que no tiene otra barrera.

#### Mover el SQL y parametrizar sus dos líneas de contraseña

```bash
mkdir -p db/init/sql
git mv db/init/01-roles.sql db/init/sql/01-roles.sql
```

Después se editan exactamente **tres cosas** del archivo: el párrafo final del encabezado,
que hoy afirma algo que dejará de ser cierto, y las dos líneas de `PASSWORD`. Todo el resto
—que es lo que explica ADR-002, por qué `hs_app` no recibe `UPDATE`/`DELETE` por default y
por qué hay que revocarle a `PUBLIC`— queda **intacto**.

El archivo completo, ya editado:

```bash
cat > db/init/sql/01-roles.sql <<'EOF'
-- ADR-002 — Inmutabilidad forzada por el motor, no por código de aplicación.
--
-- Dos roles desde el arranque del contenedor, no después:
--
--   hs_migrator  dueño de la base y del schema. Crea tablas, triggers, políticas
--                RLS y los GRANT/REVOKE. Es el único que puede cambiar el esquema.
--   hs_app       runtime de apps/api. Sin CREATE. Por default privileges solo
--                recibe SELECT e INSERT: UPDATE y DELETE hay que concederlos
--                tabla por tabla, en la migración, y de forma explícita.
--
-- El spike 2 (etapa 0 de requisitos-v1.2 §7) es exactamente esto: un UPDATE con
-- el rol de la app tiene que fallar en el motor. Si el proyecto arrancara
-- conectándose como superusuario, la primera migración se escribiría asumiendo
-- permisos que el rol real nunca va a tener, y desandarlo después es caro.
--
-- ESTE ARCHIVO NO LLEVA CONTRASEÑAS. Las recibe de `db/init/01-roles.sh`, que es
-- lo que ejecuta el entrypoint de Postgres y lo único que ve el entorno del
-- contenedor. Por eso vive en este subdirectorio: el entrypoint recorre
-- /docker-entrypoint-initdb.d/* e IGNORA los directorios, así que acá abajo no
-- se ejecuta solo — y si se ejecutara solo, correría sin las variables y crearía
-- los roles con una contraseña vacía. Ver docs/deployment/04-postgres.md.

\set ON_ERROR_STOP on

CREATE ROLE hs_migrator LOGIN PASSWORD :'hs_migrator_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

CREATE ROLE hs_app LOGIN PASSWORD :'hs_app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;

-- PUBLIC es un rol al que pertenece todo el mundo. Si no se le revoca primero,
-- le regala a hs_app justo lo que el resto del script intenta no darle.
REVOKE ALL ON DATABASE hs_platform FROM PUBLIC;

ALTER DATABASE hs_platform OWNER TO hs_migrator;
GRANT CONNECT ON DATABASE hs_platform TO hs_migrator, hs_app;

ALTER SCHEMA public OWNER TO hs_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO hs_migrator;
GRANT USAGE ON SCHEMA public TO hs_app;

-- Default privileges sobre lo que cree hs_migrator de acá en adelante.
-- Sin UPDATE ni DELETE: la inmutabilidad es el default, no la excepción.
ALTER DEFAULT PRIVILEGES FOR ROLE hs_migrator IN SCHEMA public
  GRANT SELECT, INSERT ON TABLES TO hs_app;

-- Sin esto, los INSERT sobre columnas identity/serial fallan con un error que no
-- menciona secuencias en ningún lado.
ALTER DEFAULT PRIVILEGES FOR ROLE hs_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO hs_app;

ALTER DEFAULT PRIVILEGES FOR ROLE hs_migrator IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO hs_app;

-- Nota para las migraciones de ADR-004: hs_migrator es dueño de las tablas y el
-- dueño de una tabla evade RLS. Toda tabla con políticas por sitio necesita
-- ALTER TABLE ... FORCE ROW LEVEL SECURITY, o el aislamiento no aplica al rol
-- que corre las migraciones.
EOF
```

#### El envoltorio que sí ve el entorno

```bash
cat > db/init/01-roles.sh <<'EOF'
#!/bin/sh
# Ver docs/deployment/04-postgres.md. Lo ejecuta el entrypoint de Postgres, UNA
# SOLA VEZ, con el volumen vacío.
#
# POR QUÉ EXISTE ESTE ARCHIVO. docker-entrypoint-initdb.d corre los .sql con psql
# y sin variables: un .sql no puede leer HS_APP_PASSWORD. Un .sh sí ve el entorno
# del contenedor, y es la única forma de que los dos roles de ADR-002 se creen con
# la credencial de .env.prod en vez de con la literal de desarrollo.
#
# El SQL está en sql/01-roles.sql, un subdirectorio, PORQUE el entrypoint ignora
# los directorios. Arriba se ejecutaría dos veces: una por este script y otra por
# el propio entrypoint, la segunda sin las variables.
#
# Funciona ejecutado (bit +x) o "source"-ado, que son los dos modos del
# entrypoint. Por eso no usa `set -u`: sourceado, se lo dejaría puesto al shell
# del entrypoint.
set -e

if [ -z "$HS_MIGRATOR_PASSWORD" ] || [ -z "$HS_APP_PASSWORD" ]; then
  echo "01-roles.sh: faltan HS_MIGRATOR_PASSWORD y/o HS_APP_PASSWORD en el" >&2
  echo "entorno del servicio db. NO se crean los roles con un valor por" >&2
  echo "default: eso es lo que dejaría hs_app con la contraseña de desarrollo" >&2
  echo "en producción. Ver docs/deployment/04-postgres.md." >&2
  exit 1
fi

# :'nombre' en el .sql interpola como literal SQL correctamente escapado. Las
# contraseñas no tocan el disco ni la línea de comandos de otro proceso.
psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --no-password \
  --set ON_ERROR_STOP=1 \
  --set hs_migrator_password="$HS_MIGRATOR_PASSWORD" \
  --set hs_app_password="$HS_APP_PASSWORD" \
  --file /docker-entrypoint-initdb.d/sql/01-roles.sql

echo "01-roles.sh: hs_migrator y hs_app creados con las credenciales del entorno."
EOF

chmod +x db/init/01-roles.sh
git add db/init/01-roles.sh db/init/sql/01-roles.sql
git update-index --chmod=+x db/init/01-roles.sh
```

**Cómo sé que salió bien.** No es que el archivo exista: es que no quede ninguna contraseña
literal, que el `.sql` no haya quedado en el nivel que se ejecuta solo, y que el shell del
envoltorio sea sintácticamente válido.

```bash
grep -rn "hs_app_dev\|hs_migrator_dev" db/init/ \
  && echo "FALLÓ: contraseña literal en db/init" || echo "sin contraseñas literales"

ls -1 db/init/
# Esperado, exactamente: 01-roles.sh y sql/

sh -n db/init/01-roles.sh && echo "sintaxis del envoltorio: ok"
test -x db/init/01-roles.sh && echo "bit de ejecución: puesto"
```

### Paso 2 — Que el entorno de desarrollo siga arrancando

El cambio del Paso 1 rompe `docker-compose.yml` —el **de desarrollo**— si no se lo
acompaña: su servicio `db` no declara ninguna de las dos variables, así que el envoltorio
saldría con error y el contenedor no llegaría nunca a `healthy`.

Se arregla con dos líneas, y con los literales escritos **a propósito**: D2 del `03` ya dice
que el compose de desarrollo trae credenciales literales y el de producción no trae ninguna.
Así `pnpm setup` sigue funcionando sin que nadie tenga que configurar nada.

En `docker-compose.yml`, servicio `db`, el bloque `environment:` queda así:

```yaml
    environment:
      # El superusuario existe solo para el bootstrap del contenedor. Ninguna app
      # lo usa: la API se conecta como hs_app y las migraciones como hs_migrator
      # (ADR-002). Ver db/init/01-roles.sh y .env.example.
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: hs_platform
      # Las consume db/init/01-roles.sh. Literales A PROPÓSITO y SOLO acá: este es
      # el compose de desarrollo. compose.prod.yml las toma de .env.prod y no
      # tiene ningún valor por default. Tienen que coincidir con las URLs de
      # .env.example.
      HS_MIGRATOR_PASSWORD: hs_migrator_dev
      HS_APP_PASSWORD: hs_app_dev
```

Y el comentario del montaje, que nombra el archivo que se movió:

```yaml
      # Los scripts de este directorio corren una única vez, cuando el volumen
      # está vacío. Si cambiás db/init/sql/01-roles.sql, hace falta `pnpm db:reset`.
      - ./db/init:/docker-entrypoint-initdb.d:ro
```

**Cómo sé que salió bien.**

```bash
docker compose config --quiet && echo "compose de desarrollo: válido"
grep -n "HS_MIGRATOR_PASSWORD\|HS_APP_PASSWORD" docker-compose.yml
grep -n "hs_app_dev\|hs_migrator_dev" .env.example
```

Los dos últimos tienen que coincidir: si el compose crea el rol con un literal y
`.env.example` arma la URL con otro, el entorno de desarrollo deja de conectarse.

> **No verifiques esto con `pnpm db:reset`.** `db:reset` es `docker compose down -v`: se
> lleva la base de desarrollo entera. Si hace falta probar el arranque de verdad, se hace
> con un proyecto aparte y un volumen aparte
> (`docker compose -p hs-roles-probe up -d db`, y `down -v` sobre **ese** proyecto), nunca
> sobre el volumen de trabajo.

### Paso 3 — Copiar `db/init/` al VPS y crear los roles

El `03` ya declara el montaje `./db/init:/docker-entrypoint-initdb.d:ro`. Lo que falta es el
contenido y —esto sí es del `03`— las dos variables en el `environment:` del servicio `db`
(sección 7, fila 1). **Sin esas dos líneas en `compose.prod.yml` el contenedor no arranca**,
que es el comportamiento que pide D3.

```bash
scp -r db/init <USUARIO>@<HOST_VPS>:/srv/hs-platform/db/
ssh <USUARIO>@<HOST_VPS> 'chmod +x /srv/hs-platform/db/init/01-roles.sh'
```

El `chmod` no es paranoia: `scp` no siempre preserva el bit de ejecución, y aunque el
entrypoint también sabe hacer `source` de un `.sh` sin él, no conviene depender de por cuál
de los dos caminos entra.

Ahora, la única ventana en la que esto se puede hacer sin costo. Como 1.2 garantiza que no
hay datos:

```bash
ssh <USUARIO>@<HOST_VPS> '
  cd /srv/hs-platform
  docker compose --env-file .env.prod -f compose.prod.yml stop db
  docker compose --env-file .env.prod -f compose.prod.yml rm -f db
  docker volume rm hs-platform_db-data
  docker compose --env-file .env.prod -f compose.prod.yml up -d db
'
```

> **Este `docker volume rm` es legal exactamente una vez: acá, con la base vacía.** Después
> del Paso 8 el mismo comando destruye la evidencia regulatoria. Ver la sección 8.

**Cómo sé que salió bien.** El log del contenedor tiene que traer la línea que imprime el
envoltorio, y no un error:

```bash
ssh <USUARIO>@<HOST_VPS> 'cd /srv/hs-platform && docker compose --env-file .env.prod -f compose.prod.yml logs db | grep -E "01-roles.sh|ERROR|FATAL"'
```

Esperado: `01-roles.sh: hs_migrator y hs_app creados con las credenciales del entorno.` y
ningún `ERROR`. Si aparece `faltan HS_MIGRATOR_PASSWORD`, el `03` todavía no agregó las dos
variables al servicio `db`: se agregan allá, no acá.

### Paso 4 — Verificar los roles ANTES de que entre un dato

Este paso es el que hace que los tres siguientes se puedan ejecutar sin miedo, y es el único
momento del despliegue en que un error de roles sale gratis. **Los cuatro chequeos se corren
enteros antes de seguir.**

Para abreviar, todo lo que sigue usa esta forma —superusuario, por D8—:

```bash
ssh <USUARIO>@<HOST_VPS> 'cd /srv/hs-platform && docker compose --env-file .env.prod -f compose.prod.yml exec -T db psql -U postgres -d hs_platform'
```

#### 4.1 Los dos roles existen con los atributos correctos

```sql
SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin, rolinherit
  FROM pg_roles
 WHERE rolname IN ('hs_app', 'hs_migrator')
 ORDER BY rolname;
```

Esperado, dos filas:

| rolname | rolsuper | rolbypassrls | rolcreatedb | rolcreaterole | rolcanlogin | rolinherit |
| --- | --- | --- | --- | --- | --- | --- |
| `hs_app` | `f` | `f` | `f` | `f` | `t` | `f` |
| `hs_migrator` | `f` | `f` | `f` | `f` | `t` | `t` |

`rolbypassrls = f` en los dos es lo que sostiene ADR-004: un rol con `BYPASSRLS` haría
decorativo todo el aislamiento por sitio. `rolinherit = f` en `hs_app` es el `NOINHERIT` del
script.

#### 4.2 Las contraseñas de desarrollo NO entran

Es la comprobación decisiva del Paso 1, y la única que distingue "el script corrió" de "el
script corrió parametrizado". Se intenta iniciar sesión con el literal del repositorio; la
conexión por TCP fuerza autenticación por contraseña, a diferencia del socket local:

```bash
ssh <USUARIO>@<HOST_VPS> 'cd /srv/hs-platform && docker compose --env-file .env.prod -f compose.prod.yml exec -T \
  -e PGPASSWORD=hs_app_dev db psql -h 127.0.0.1 -U hs_app -d hs_platform -Atc "SELECT 1"'
```

**Tiene que fallar** con `password authentication failed for user "hs_app"`. Si devuelve
`1`, la base quedó con la contraseña de desarrollo: se para y se va a la sección 6, fila 1.

Lo mismo con el otro rol:

```bash
ssh <USUARIO>@<HOST_VPS> 'cd /srv/hs-platform && docker compose --env-file .env.prod -f compose.prod.yml exec -T \
  -e PGPASSWORD=hs_migrator_dev db psql -h 127.0.0.1 -U hs_migrator -d hs_platform -Atc "SELECT 1"'
```

También tiene que fallar. `hs_app_dev` y `hs_migrator_dev` son los literales públicos del
repositorio, no valores de `.env.prod`: escribirlos acá no filtra nada.

#### 4.3 Las credenciales reales SÍ entran, por las dos URLs

Sin escribir ningún valor: las dos URLs ya están en el entorno del servicio `migrator`.

```bash
ssh <USUARIO>@<HOST_VPS> '
  cd /srv/hs-platform
  docker compose --env-file .env.prod -f compose.prod.yml --profile tools run --rm migrator \
    node -e "
      const { Client } = require(\"pg\");
      const check = async (label, url) => {
        const c = new Client({ connectionString: url });
        await c.connect();
        const { rows } = await c.query(\"SELECT current_user, current_database()\");
        console.log(label, rows[0]);
        await c.end();
      };
      check(\"MIGRATION_DATABASE_URL ->\", process.env.MIGRATION_DATABASE_URL)
        .then(() => check(\"DATABASE_URL ->\", process.env.DATABASE_URL))
        .catch((e) => { console.error(e.message); process.exit(1); });
    "
'
```

Esperado: `hs_migrator` y `hs_app` respectivamente, los dos sobre `hs_platform`. Si alguna
falla con `password authentication failed`, la URL de `.env.prod` y la contraseña del rol no
coinciden: se corrige **la URL** en `.env.prod` (es del `07`), no el rol, mientras la base
siga vacía.

#### 4.4 La propiedad de la base y del esquema

```sql
SELECT d.datname, pg_get_userbyid(d.datdba) AS dueno_base,
       n.nspname, pg_get_userbyid(n.nspowner) AS dueno_schema
  FROM pg_database d, pg_namespace n
 WHERE d.datname = 'hs_platform' AND n.nspname = 'public';
```

Los dos dueños tienen que ser `hs_migrator`. Y los default privileges, que son lo que hace
que la inmutabilidad sea el default y no la excepción:

```sql
SELECT defaclobjtype, defaclacl
  FROM pg_default_acl d
  JOIN pg_namespace n ON n.oid = d.defaclnamespace
 WHERE n.nspname = 'public';
```

Para `defaclobjtype = 'r'` (tablas) tiene que leerse `hs_app=ar/hs_migrator`: **`a`
(INSERT) y `r` (SELECT), y nada más**. Si aparece una `w` (UPDATE) o una `d` (DELETE), el
script se editó de más y todo lo que se cree de acá en adelante nace mutable.

### Paso 5 — `db:migrate`

El primero de los tres comandos, y el que fija los `ALTER DEFAULT PRIVILEGES` del esquema
`pgboss` que el Paso 6 necesita.

```bash
ssh <USUARIO>@<HOST_VPS> '
  cd /srv/hs-platform
  docker compose --env-file .env.prod -f compose.prod.yml --profile tools run --rm migrator pnpm db:migrate
'
```

`db:migrate` es `drizzle-kit migrate`, que resuelve `drizzle.config.ts` y `./drizzle`
contra el `working_dir` `/app/apps/api` y se conecta con `MIGRATION_DATABASE_URL`
(`apps/api/drizzle.config.ts`). Las migraciones están escritas a mano: `drizzle-kit
generate` está prohibido en este proyecto, y el porqué está en el encabezado de ese archivo.

**Cómo sé que salió bien.** No alcanza con que el comando devuelva 0: hay que contar lo que
quedó aplicado contra lo que hay en el repositorio.

```bash
ls -1 apps/api/drizzle/*.sql | wc -l     # en tu máquina: 51
```

```sql
SELECT count(*) AS aplicadas FROM drizzle.__drizzle_migrations;
```

Los dos números tienen que ser iguales. Y las tablas de la aplicación tienen que existir:

```sql
SELECT count(*) AS tablas_public
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
```

Tiene que ser un número bastante mayor que cero. Cero con `aplicadas = 51` sería un esquema
migrado en otra base.

### Paso 6 — `db:jobs:install`, y por qué no puede ir antes

#### El orden, que no se puede deshacer

El encabezado de `apps/api/scripts/jobs-install.mjs` lo dice sin rodeos: la migración
`0008_inspection_scheduling.sql` fija los `ALTER DEFAULT PRIVILEGES` del esquema `pgboss`
**antes de que existan sus tablas**, porque los default privileges **no son retroactivos**.

La migración 0008 hace, en este orden:

```
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION hs_migrator;
GRANT USAGE ON SCHEMA pgboss TO hs_app;
ALTER DEFAULT PRIVILEGES FOR ROLE hs_migrator IN SCHEMA pgboss
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hs_app;
```

Si `db:jobs:install` corre primero, pg-boss crea sus tablas cuando esos default privileges
todavía no existen, y ningún `ALTER DEFAULT PRIVILEGES` posterior se las va a conceder.
El resultado es un esquema `pgboss` que `hs_app` no puede tocar. **Y el síntoma no es un
error**: la API arranca —`isInstalled()` devuelve `true`, el esquema está— y el worker
**no consume nunca**. Los dos crons de las 03:00 y las 04:00 de Ontario no abren el período
y, como dice H12, un `open-period` que no corre no produce ningún error.

Irreversible en la práctica no quiere decir imposible de arreglar, quiere decir que el
arreglo es un `GRANT` tabla por tabla sobre un esquema de infraestructura que nadie revisó,
descubierto un mes después, cuando ya faltan inspecciones. La forma de no tener ese problema
es el orden.

#### Antes de correrlo: comprobar que 0008 está aplicada

```sql
SELECT n.nspname, d.defaclobjtype, d.defaclacl
  FROM pg_default_acl d
  JOIN pg_namespace n ON n.oid = d.defaclnamespace
 WHERE n.nspname = 'pgboss';
```

Tiene que haber una fila con `defaclobjtype = 'r'` y una ACL que le dé a `hs_app`
`arwd` (`hs_app=arwd/hs_migrator`). Si la consulta vuelve vacía, **no se corre el comando**:
falta el Paso 5.

#### Correrlo

```bash
ssh <USUARIO>@<HOST_VPS> '
  cd /srv/hs-platform
  docker compose --env-file .env.prod -f compose.prod.yml --profile tools run --rm migrator pnpm db:jobs:install
'
```

Esperado en la salida: ``Esquema `pgboss`: installed.`` El script es idempotente: sobre un
esquema ya instalado dice `up-to-date` y no hace nada.

#### Cómo sé que salió bien: el privilegio, no el código de salida

Que el comando devuelva 0 solo dice que las tablas se crearon. Lo que hay que confirmar es
que **`hs_app` las puede tocar**, que es justo lo que el orden invertido rompe en silencio:

```sql
SELECT table_name,
       string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privilegios
  FROM information_schema.table_privileges
 WHERE table_schema = 'pgboss' AND grantee = 'hs_app'
 GROUP BY table_name
 ORDER BY table_name;
```

Cada tabla del esquema tiene que aparecer con `DELETE, INSERT, SELECT, UPDATE`. La que más
importa es **`job_common`**: es la partición por default de `pgboss.job`, donde caen los
trabajos de todas las colas de este proyecto. `apps/api/src/jobs/jobs.service.ts` llama a
`createQueue(name)` sin opciones, y el default de pg-boss 12 es `partition: false`, así que
no se crean particiones por cola en tiempo de ejecución — que es lo que salva a `hs_app`,
que no tiene `CREATE` sobre el esquema `pgboss`.

Y la versión binaria, que es la que se pega en el checklist:

```sql
SELECT count(*) AS tablas_sin_permiso_completo
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'pgboss'
   AND c.relkind IN ('r', 'p')
   AND NOT (has_table_privilege('hs_app', c.oid, 'SELECT')
        AND has_table_privilege('hs_app', c.oid, 'INSERT')
        AND has_table_privilege('hs_app', c.oid, 'UPDATE')
        AND has_table_privilege('hs_app', c.oid, 'DELETE'));
```

**Tiene que ser `0`.** Cualquier otro número es el fallo silencioso de arriba, y se ataja
acá o no se ataja.

### Paso 7 — Ejecutar la edición del seed de arranque

**Precondición bloqueante de `db:seed`.** El `01` preparó esta edición en su Paso 6 y la dejó
con dueño; acá se ejecuta. No se corre el Paso 8 hasta que este termine y verifique.

#### Las cinco líneas

Cuatro son datos y se reemplazan mecánicamente:

| Línea | Hoy | Qué va |
| --- | --- | --- |
| 51 | `'BOOTSTRAP-0001',` | El número de legajo real de ADP |
| 52 | `'Health and Safety',` | El nombre de pila, como va en el roster |
| 53 | `'Coordinator',` | El apellido, como va en el roster |
| 64 | `'coordinator@example.com',` | El email corporativo |

La quinta es una **decisión**, no un reemplazo:

| Línea | Hoy | Qué va |
| --- | --- | --- |
| 54 | `'5717e900-0000-4000-8000-000000000001')` | El UUID de la planta **de la persona**: `…0001` es St. Thomas, `…0002` es Glencoe |

Es el sitio de la persona en el roster, no el alcance de la cuenta: el alcance son las dos
plantas y se otorga abajo, en el `INSERT INTO user_site_scope` de las líneas 77-81. Solo se
toca la 54 si el coordinador real no es de St. Thomas.

#### Lo que se conserva intacto

Los UUID literales **no se tocan**, y no es estilo: hay código que los nombra por valor.

| Valor | Líneas | Quién más lo nombra |
| --- | --- | --- |
| `acc00000-0000-4000-8000-000000000001` (la cuenta) | 62, 78 | `apps/api/scripts/bootstrap-invitation.mjs` (es el argumento por default de `pnpm auth:bootstrap`), `apps/api/seeds/005_inspection_schedules.sql`, `apps/api/test/helpers/identity.ts` |
| `7e150000-0000-4000-8000-000000000001` (la persona) | 50, 63 | `apps/api/test/helpers/identity.ts` |
| `5717e900-…0001` / `…0002` (las plantas) | 37 | `apps/api/seeds/002_sites.sql`, y medio repositorio |

Cambiar el UUID de la cuenta deja a `pnpm auth:bootstrap` sin a quién invitar —que es el
comando con el que el `09` le da credencial al coordinador— y hace fallar al seed
`005_inspection_schedules.sql`. Se conservan también los `ON CONFLICT` (líneas 55, 66, 81),
el `set_config('app.site_ids', …)` de las líneas 35-38, el `WHERE s.code IN ('st-thomas',
'glencoe')` de la línea 80 y el rol `'coordinator'` de la línea 65.

#### Comprobación: que no quede ningún valor de relleno

```bash
grep -n "BOOTSTRAP-0001\|coordinator@example.com\|'Health and Safety'\|'Coordinator'" \
  apps/api/seeds/004_bootstrap_coordinator.sql
```

**No tiene que imprimir ninguna línea.** Y los tres UUID tienen que seguir ahí:

```bash
grep -c "acc00000-0000-4000-8000-000000000001" apps/api/seeds/004_bootstrap_coordinator.sql  # 2
grep -c "7e150000-0000-4000-8000-000000000001" apps/api/seeds/004_bootstrap_coordinator.sql  # 2
grep -c "5717e900-0000-4000-8000-00000000000"  apps/api/seeds/004_bootstrap_coordinator.sql  # 3
git diff --stat -- apps/api/seeds/
```

El `git diff --stat` tiene que listar **un solo archivo**, con cinco líneas cambiadas como
máximo. Si toca otro seed, algo se editó de más.

#### Y ahora la parte que es fácil hacer al revés: la imagen

El seed **no se lee del disco del VPS**. `pnpm db:seed` es
`node scripts/seed.mjs`, que lee `apps/api/seeds/` **relativo a sí mismo**
(`SEEDS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../seeds')`), y el `seed.mjs`
que corre es el que está adentro de la imagen, en `/app/apps/api/seeds/`. La imagen se
construye con `COPY . .` desde el árbol del repositorio (`02`, Paso 3), y `.dockerignore`
excluye `.git` — o sea que lo que entra a la imagen es el **árbol de trabajo**, commiteado o
no.

El orden, entonces, es este y no otro:

```
editar el seed  ->  reconstruir la imagen (02, Paso 5)  ->  transferirla al VPS (02, Paso 6)
                ->  actualizar API_TAG en .env.prod      ->  recién ahí, db:seed
```

Reconstruir y transferir:

```bash
docker build -t "hs-platform-api:<TAG_NUEVO>" .
docker save "hs-platform-api:<TAG_NUEVO>" | gzip | ssh <USUARIO>@<HOST_VPS> 'gunzip | docker load'
```

Sobre `<TAG_NUEVO>` hay una decisión real, y las dos salidas son defendibles:

- **Commitear la edición y usar `git rev-parse --short HEAD`.** El tag vuelve a significar
  lo que dice el `02`: un hash que identifica exactamente el contenido. El costo es que el
  nombre, el apellido, el legajo y el email del coordinador quedan en la historia de git
  para siempre — el mismo dato que el `01` decidió no poner en el `README.md`.
- **No commitearla y usar un tag derivado, `<hash>-bootstrap`.** La historia queda limpia,
  pero el árbol queda sucio: un `git checkout`, un `git stash` o un `git clean` distraído se
  lleva la edición sin avisar, y hay que rehacerla de memoria.

Elegí una, anotá cuál, y si elegís la segunda **guardá una copia del archivo editado fuera
del repositorio** antes de seguir. Lo que **no** es una opción es dejar el tag anterior: dos
imágenes distintas con el mismo tag es cómo se termina sembrando el relleno creyendo que se
sembró el dato real.

**Cómo sé que salió bien.** No se mira el archivo del repositorio: se mira **adentro de la
imagen que va a correr `migrator`**, que es la única comprobación que no se puede falsear.

```bash
ssh <USUARIO>@<HOST_VPS> '
  cd /srv/hs-platform
  docker compose --env-file .env.prod -f compose.prod.yml --profile tools run --rm migrator \
    grep -n "BOOTSTRAP-0001\|coordinator@example.com" seeds/004_bootstrap_coordinator.sql
'
```

**No tiene que imprimir nada** (y `grep` va a salir con código 1, que acá es el éxito). Si
imprime, la imagen es la vieja: revisá `API_TAG` en `.env.prod` y que el `docker load` haya
traído el tag nuevo.

### Paso 8 — `db:seed`

Solo si el Paso 7 verificó. **Desde acá no hay vuelta atrás** (sección 8, R1).

```bash
ssh <USUARIO>@<HOST_VPS> '
  cd /srv/hs-platform
  docker compose --env-file .env.prod -f compose.prod.yml --profile tools run --rm migrator pnpm db:seed
'
```

Esperado: `Seeds aplicados:` con los seis archivos, en orden de nombre —
`001_monthly_general_inspection.sql`, `002_sites.sql`, `003_locations.sql`,
`004_bootstrap_coordinator.sql`, `004_organization_locations.sql`,
`005_inspection_schedules.sql`. Cada uno va en su propia transacción
(`apps/api/scripts/seed.mjs`), así que uno que falle no deja a medias los anteriores, y los
seis son idempotentes por contrato.

**Cómo sé que salió bien.** Contra la base, no contra la salida del comando — y como
superusuario, por D8: `person` lleva `FORCE ROW LEVEL SECURITY`, así que una consulta como
`hs_migrator` sin `app.site_ids` declarado devuelve **cero filas siempre**, y un cero ahí
significaría "RLS lo escondió", no "no está".

```sql
SELECT (SELECT count(*) FROM site)            AS sitios,          -- 2
       (SELECT count(*) FROM person)          AS personas,        -- 1
       (SELECT count(*) FROM app_user)        AS cuentas,         -- 1
       (SELECT count(*) FROM user_site_scope) AS alcances;        -- 2
```

Y la que importa de verdad: que no haya entrado ni un valor de relleno.

```sql
SELECT (SELECT count(*) FROM person   WHERE employee_number = 'BOOTSTRAP-0001')        AS legajo_relleno,
       (SELECT count(*) FROM app_user WHERE email = 'coordinator@example.com')         AS email_relleno,
       (SELECT count(*) FROM person   WHERE first_name = 'Health and Safety')          AS nombre_relleno;
```

**Los tres tienen que ser `0`.** Cualquiera en `1` es el riesgo R1 ya materializado: se
para, se lee la sección 8 y se decide con la cabeza fría, porque el borrado no es una opción
que este sistema tenga.

Y que la persona quedó en la planta que se decidió en la línea 54:

```sql
SELECT p.employee_number, p.first_name, p.last_name, s.code AS planta, u.email, u.role
  FROM person p
  JOIN site s ON s.id = p.site_id
  JOIN app_user u ON u.person_id = p.id;
```

### Paso 9 — La inmutabilidad, comprobada contra la base real

Es el spike 2 de `Requisitos_V1.2.md` §7 y la razón de ser de ADR-002. Hasta acá se verificó
que los privilegios **están declarados**; esto verifica que el motor **los aplica**.

`apps/api/drizzle/0001_immutability_mechanism.sql` pone dos barreras distintas, y el spike
consiste en ver las dos:

- **El privilegio.** `hs_app` no tiene `UPDATE` sobre una tabla inmutable. Falla con
  `SQLSTATE 42501`, `permission denied`.
- **El trigger `hs_forbid_mutation`.** Alcanza a *cualquier* rol, incluido `hs_migrator`,
  que como dueño de las tablas siempre podría modificarlas. Falla con `SQLSTATE HS001`.

Que los códigos sean distintos es a propósito: es lo que permite distinguir cuál de las dos
frenó, y por lo tanto comprobar que están las dos y no una sola.

Se usa `audit_log`, que es inmutable desde la migración 0002 y no recibe ningún `GRANT
UPDATE` en ninguna de las 51. Las dos consultas van dentro de una transacción con `ROLLBACK`,
aunque ninguna pueda llegar a escribir nada:

```bash
ssh <USUARIO>@<HOST_VPS> '
  cd /srv/hs-platform
  docker compose --env-file .env.prod -f compose.prod.yml --profile tools run --rm migrator \
    node -e "
      const { Client } = require(\"pg\");
      const intentar = async (label, url) => {
        const c = new Client({ connectionString: url });
        await c.connect();
        try {
          await c.query(\"BEGIN\");
          await c.query(\"UPDATE audit_log SET recorded_at = now()\");
          console.log(label, \"FALLÓ EL SPIKE: el UPDATE fue aceptado\");
          process.exitCode = 1;
        } catch (e) {
          console.log(label, \"rechazado con SQLSTATE\", e.code);
        } finally {
          await c.query(\"ROLLBACK\").catch(() => {});
          await c.end();
        }
      };
      intentar(\"hs_app      ->\", process.env.DATABASE_URL)
        .then(() => intentar(\"hs_migrator ->\", process.env.MIGRATION_DATABASE_URL));
    "
'
```

Esperado, exactamente:

```
hs_app      -> rechazado con SQLSTATE 42501
hs_migrator -> rechazado con SQLSTATE HS001
```

Un `42501` en la segunda línea también sería un rechazo, pero significaría que el trigger no
está y que la única barrera es el privilegio — y el privilegio no alcanza al dueño.

#### Y que RLS está activo, con `FORCE`

`hs_apply_site_isolation` hace `ENABLE` **y** `FORCE`, y el `FORCE` es lo que hace que la
política alcance también a `hs_migrator`, que es dueño de las tablas. Sin él, el aislamiento
por sitio no aplica al rol que corre las migraciones y los seeds.

```sql
SELECT count(*) FILTER (WHERE c.relrowsecurity)                            AS con_rls,
       count(*) FILTER (WHERE c.relrowsecurity AND c.relforcerowsecurity)  AS con_force
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r';
```

Los dos números tienen que ser **iguales y mayores que cero**. Y la lista de las que evaden
el `FORCE`, que tiene que salir vacía:

```sql
SELECT c.relname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r'
   AND c.relrowsecurity AND NOT c.relforcerowsecurity
 ORDER BY 1;
```

Cero filas. En este esquema toda activación de RLS pasa por `hs_apply_site_isolation` o por
`hs_apply_record_window`, y las dos hacen `FORCE`: una tabla en esta lista sería un `ALTER
TABLE` suelto.

La contraparte funcional, que es la que demuestra que `FORCE` no es decorativo: `hs_migrator`
—el dueño— no ve nada sin alcance declarado.

```bash
ssh <USUARIO>@<HOST_VPS> '
  cd /srv/hs-platform
  docker compose --env-file .env.prod -f compose.prod.yml --profile tools run --rm migrator \
    node -e "
      const { Client } = require(\"pg\");
      const c = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
      c.connect()
        .then(() => c.query(\"SELECT count(*)::int AS n FROM person\"))
        .then((r) => console.log(\"hs_migrator sin app.site_ids ve\", r.rows[0].n, \"personas (esperado: 0)\"))
        .finally(() => c.end());
    "
'
```

Esperado: `0`. Y `0` acá es lo correcto, al revés que en el Paso 8 — donde el mismo cero
habría sido el error. La diferencia es el rol con el que se pregunta, y es exactamente lo
que D8 advierte.

### Paso 10 — El presupuesto de conexiones

Dos pools por proceso de la API, y ninguno de los dos es configurable por entorno:

| Origen | `max` | Dónde está escrito |
| --- | --- | --- |
| `DbService` | **10** (el default de `pg`: el constructor se llama con `new Pool({ connectionString })`, sin `max`) | `apps/api/src/db/db.service.ts` |
| pg-boss | **2**, declarado | `apps/api/src/jobs/jobs.service.ts` |

Son **12 por réplica**, que es lo que dice H12. Con la topología del `03` hay una sola
réplica de `api`, más los `run --rm migrator`, que son de a uno y efímeros.

```sql
SHOW max_connections;
SHOW superuser_reserved_connections;
```

`postgres:17-alpine` sin configuración extra deja `max_connections = 100`. El compose del
`03` no monta ningún `postgresql.conf` ni pasa `-c max_connections`, así que ese es el
número.

**Conclusión: no hace falta ajustar nada.** 12 de 100, con margen para el `migrator`, para
un `psql` de diagnóstico y para el `pg_dump` del `08`. El día que haya que mirarlo de nuevo
es si aparece una segunda réplica de `api`, y entonces son 24 — que siguen entrando.

Lo que sí conviene dejar anotado para el `10`: el número a vigilar no es el techo sino las
conexiones ociosas de un proceso que no se apagó bien.

```sql
SELECT usename, state, count(*)
  FROM pg_stat_activity
 WHERE datname = 'hs_platform'
 GROUP BY usename, state
 ORDER BY 1, 2;
```

---

## 4. Verificación

Bloque completo y repetible. Dentro de un mes tiene que dar lo mismo. Todo lo que dice
`psql` va por:

```bash
ssh <USUARIO>@<HOST_VPS> 'cd /srv/hs-platform && docker compose --env-file .env.prod -f compose.prod.yml exec -T db psql -U postgres -d hs_platform'
```

```sql
-- 1. Los dos roles, con los atributos de ADR-002.
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin, rolinherit
  FROM pg_roles WHERE rolname IN ('hs_app', 'hs_migrator') ORDER BY 1;
```

```sql
-- 2. Los default privileges de `public`: solo a (INSERT) y r (SELECT) para hs_app.
SELECT defaclobjtype, defaclacl
  FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
 WHERE n.nspname = 'public';
```

```sql
-- 3. Las 51 migraciones.
SELECT count(*) AS aplicadas FROM drizzle.__drizzle_migrations;
```

```sql
-- 4. pgboss: ninguna tabla sin los cuatro privilegios para hs_app. Tiene que ser 0.
SELECT count(*) AS tablas_sin_permiso_completo
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'pgboss' AND c.relkind IN ('r', 'p')
   AND NOT (has_table_privilege('hs_app', c.oid, 'SELECT')
        AND has_table_privilege('hs_app', c.oid, 'INSERT')
        AND has_table_privilege('hs_app', c.oid, 'UPDATE')
        AND has_table_privilege('hs_app', c.oid, 'DELETE'));
```

```sql
-- 5. RLS: ninguna tabla con RLS y sin FORCE. Tiene que ser 0 filas.
SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r'
   AND c.relrowsecurity AND NOT c.relforcerowsecurity;
```

```sql
-- 6. Los seeds, y ningún valor de relleno. Los tres últimos tienen que ser 0.
SELECT (SELECT count(*) FROM site)            AS sitios,
       (SELECT count(*) FROM person)          AS personas,
       (SELECT count(*) FROM app_user)        AS cuentas,
       (SELECT count(*) FROM person   WHERE employee_number = 'BOOTSTRAP-0001')  AS legajo_relleno,
       (SELECT count(*) FROM app_user WHERE email = 'coordinator@example.com')   AS email_relleno,
       (SELECT count(*) FROM person   WHERE first_name = 'Health and Safety')    AS nombre_relleno;
```

```sql
-- 7. El presupuesto de conexiones.
SHOW max_connections;
```

```bash
# 8. Las contraseñas de desarrollo siguen sin entrar. LAS DOS TIENEN QUE FALLAR.
ssh <USUARIO>@<HOST_VPS> 'cd /srv/hs-platform && docker compose --env-file .env.prod -f compose.prod.yml exec -T \
  -e PGPASSWORD=hs_app_dev db psql -h 127.0.0.1 -U hs_app -d hs_platform -Atc "SELECT 1"'
ssh <USUARIO>@<HOST_VPS> 'cd /srv/hs-platform && docker compose --env-file .env.prod -f compose.prod.yml exec -T \
  -e PGPASSWORD=hs_migrator_dev db psql -h 127.0.0.1 -U hs_migrator -d hs_platform -Atc "SELECT 1"'
```

```bash
# 9. El spike 2: 42501 con hs_app, HS001 con hs_migrator. Es el bloque del Paso 9.
```

```bash
# 10. La imagen que corre `migrator` NO tiene los valores de relleno. No imprime nada.
ssh <USUARIO>@<HOST_VPS> '
  cd /srv/hs-platform
  docker compose --env-file .env.prod -f compose.prod.yml --profile tools run --rm migrator \
    grep -n "BOOTSTRAP-0001\|coordinator@example.com" seeds/004_bootstrap_coordinator.sql
'
```

---

## 5. Criterios de hecho

- [ ] `db/init/` contiene exactamente `01-roles.sh` y `sql/01-roles.sql`
- [ ] No hay ninguna contraseña literal en `db/init/`
- [ ] `db/init/01-roles.sh` tiene el bit de ejecución, en el repositorio y en el VPS
- [ ] Los comentarios de ADR-002 del archivo original están íntegros en `sql/01-roles.sql`
- [ ] El compose **de desarrollo** declara `HS_MIGRATOR_PASSWORD` y `HS_APP_PASSWORD` con los
      literales que usa `.env.example`
- [ ] `hs_app` y `hs_migrator` existen, sin `SUPERUSER` y sin `BYPASSRLS`
- [ ] `hs_app` es `NOINHERIT`
- [ ] Iniciar sesión con `hs_app_dev` y con `hs_migrator_dev` **falla**
- [ ] `MIGRATION_DATABASE_URL` conecta como `hs_migrator` y `DATABASE_URL` como `hs_app`
- [ ] `hs_migrator` es dueño de la base `hs_platform` y del esquema `public`
- [ ] Los default privileges de `public` dan a `hs_app` solo `SELECT` e `INSERT`
- [ ] `drizzle.__drizzle_migrations` tiene tantas filas como `.sql` hay en `apps/api/drizzle/`
- [ ] Los `ALTER DEFAULT PRIVILEGES` de `pgboss` estaban **antes** de instalar el esquema
- [ ] Ninguna tabla de `pgboss` le falta alguno de los cuatro privilegios a `hs_app`
- [ ] `pgboss.job_common` existe y `hs_app` la puede leer, insertar, actualizar y borrar
- [ ] Ninguna tabla de `public` tiene RLS sin `FORCE`
- [ ] `hs_migrator` sin `app.site_ids` ve cero filas en `person`
- [ ] `UPDATE` sobre `audit_log` falla con `42501` como `hs_app` y con `HS001` como `hs_migrator`
- [ ] `apps/api/seeds/004_bootstrap_coordinator.sql` no tiene ningún valor de relleno
- [ ] Los tres UUID literales del seed están intactos
- [ ] La **imagen** que usa `migrator` contiene el seed editado, verificado desde adentro
- [ ] `API_TAG` en `.env.prod` apunta a esa imagen
- [ ] Los seis seeds están aplicados
- [ ] `person`, `app_user` y `user_site_scope` tienen 1, 1 y 2 filas
- [ ] Ninguna consulta de relleno devuelve más de `0`
- [ ] `max_connections` deja margen para las 12 conexiones por réplica

---

## 6. Si falla

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| Los roles existen con la contraseña de desarrollo **y ya hay datos reales** | El volumen se inicializó antes del Paso 1 | **No se borra el volumen.** Ver el procedimiento de abajo: `\password` sobre la base viva |
| `db` no arranca: `faltan HS_MIGRATOR_PASSWORD y/o HS_APP_PASSWORD` | El `03` no agregó las dos variables al servicio `db` | Es el comportamiento correcto de D3. Se agregan en `compose.prod.yml` (sección 7, fila 1) y se reintenta |
| `db` arranca pero el log no menciona `01-roles.sh` | El volumen ya estaba inicializado: `initdb.d` no corre de nuevo | Si **no** hay datos, Paso 3 completo con `docker volume rm`. Si hay datos, `\password` |
| El log dice `ignoring /docker-entrypoint-initdb.d/sql` | Es correcto y esperado: es la línea que confirma que el `.sql` no se ejecuta solo | Nada |
| `psql: no such file or directory .../sql/01-roles.sql` | El `scp -r` no llevó el subdirectorio | `scp -r db/init <USUARIO>@<HOST_VPS>:/srv/hs-platform/db/` otra vez y verificá con `ls -R` |
| `CREATE ROLE ... already exists` al correr el script a mano | Los roles ya están | No se recrean: se corrige la contraseña con `\password` |
| `password authentication failed` en el Paso 4.3 | La URL de `.env.prod` y la contraseña del rol no coinciden | Con la base vacía: corregir la URL (es del `07`) y reintentar. Con datos: `\password` para alinear el rol a la URL |
| `db:migrate` falla con `permission denied for schema public` | Se está conectando como `hs_app`: `MIGRATION_DATABASE_URL` mal armada | Revisá el usuario de la URL. `drizzle.config.ts` solo lee `MIGRATION_DATABASE_URL` |
| `db:jobs:install` dice `installed` pero el chequeo de privilegios devuelve un número distinto de 0 | Corrió antes de la migración 0008 | Ver abajo: es el caso feo |
| La API arranca, no da ningún error, y el período del mes no se abre | Lo mismo de la fila anterior, descubierto tarde | Correr el chequeo de privilegios del Paso 6. H12: un `open-period` que no corre no produce ningún error |
| ``El esquema `pgboss` no está instalado`` al arrancar `api` | Falta el Paso 6 | Correrlo. El mensaje es de `JobsService` y es a propósito: prefiere no arrancar a arrancar callado |
| `db:seed` falla con `new row violates row-level security policy` en `person` | Se tocó el `set_config('app.site_ids', …)` de las líneas 35-38 | Restaurarlo. Es lo que declara el alcance antes de los `INSERT`, y `person` hace `FORCE` |
| `db:seed` falla con `HS002` | El alcance de la cuenta incluye una planta que no está declarada en el `set_config` | Lo mismo: las dos plantas van en la línea 37 |
| El seed corrió con los valores de relleno | Se saltó el Paso 7, o la imagen era la vieja | **Irreversible.** Sección 8, R1 |

### Corregir las contraseñas de los roles con la base viva

Es el procedimiento para cuando `initdb.d` ya corrió, quedó mal, y **hay datos que no se
pueden perder**. No borra nada y no interrumpe el servicio.

```bash
ssh -t <USUARIO>@<HOST_VPS> 'cd /srv/hs-platform && docker compose --env-file .env.prod -f compose.prod.yml exec db psql -U postgres -d hs_platform'
```

Y adentro de `psql`:

```
\password hs_app
\password hs_migrator
```

`\password` pide el valor dos veces, **no lo muestra**, y manda un `ALTER ROLE` con la
contraseña ya hasheada: no queda ni en el historial de `psql` ni en el log del servidor. Es
por eso que se usa esto y no un `ALTER ROLE ... PASSWORD '...'` escrito a mano.

Los valores que se tipean son los de `HS_APP_PASSWORD` y `HS_MIGRATOR_PASSWORD` de
`.env.prod`. Si preferís el camino inverso —dejar los roles como están y alinear el
archivo—, entonces lo que cambia es `.env.prod`, que es del `07`, y hay que reiniciar `api`
para que tome la nueva `DATABASE_URL`.

Después, las dos comprobaciones del Paso 4.2 y 4.3, en ese orden.

### Si `jobs:install` corrió antes de la migración 0008

El esquema quedó creado sin que los default privileges existieran, y **no hay `ALTER DEFAULT
PRIVILEGES` que lo arregle**: no son retroactivos. Dos caminos, y el primero es el bueno:

1. **Si no hay datos reales todavía** —que es lo normal, porque este documento corre antes
   del `09`—: `DROP SCHEMA pgboss CASCADE;` como `hs_migrator`, confirmar que los default
   privileges de `pgboss` siguen declarados (la consulta del Paso 6), y volver a correr
   `pnpm db:jobs:install`. `pgboss` es infraestructura: no guarda evidencia regulatoria, y
   con el sistema aún sin uso no hay trabajos en vuelo que perder.
2. **Si ya hay datos reales**: conceder a mano, como `hs_migrator`, y después correr el
   chequeo binario del Paso 6 hasta que dé `0`.

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO hs_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO hs_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO hs_app;
```

Los `ALTER DEFAULT PRIVILEGES` de 0008 tienen que quedar igual, para lo que se cree después.

### Punto de retroceso

**Hasta el final del Paso 6** todavía existe: no hay ningún dato que no se pueda volver a
generar, y `docker volume rm hs-platform_db-data` seguido de los Pasos 3 a 6 deja todo como
estaba. Cuesta minutos.

**El Paso 8 lo cierra.** Desde que `db:seed` termina hay una persona, una cuenta y una
cadena de auditoría que este sistema no sabe borrar. A partir de ahí el retroceso no es un
comando: es el `08`.

---

## 7. Lo que este documento le pide a otro

| Documento | Qué necesita |
| --- | --- |
| `03-infraestructura.md` | **Ya aplicado:** el `environment:` del servicio `db` declara `HS_APP_PASSWORD` y `HS_MIGRATOR_PASSWORD`, las dos con `:?`. Sin ellas `db/init/01-roles.sh` sale con error y el contenedor no arranca |
| `03-infraestructura.md` | **El montaje ya sirve y no cambia**: `./db/init:/docker-entrypoint-initdb.d:ro`. Adentro ahora hay `01-roles.sh` y un subdirectorio `sql/`. El `scp -r db/init` del Paso 6 del `03` los lleva a los dos |
| `03-infraestructura.md` | **Ya corregido:** el Paso 6 levanta solo `caddy`; `04` inicia `db` después de copiar `db/init/`, cuando el volumen todavía está vacío |
| `03-infraestructura.md` | Actualizar el comentario del montaje del servicio `db`, que hoy dice *"El archivo está parametrizado por el documento 04"* en singular: ahora son dos, y el que ejecuta el entrypoint es el `.sh` |
| `02-imagen-api.md` | **Convención ya fijada:** la edición del seed se commitea antes de construir y `API_TAG` es el hash corto de ese commit; no se usa un sufijo inventado |
| `02-imagen-api.md` | Confirmar en su verificación que `seeds/004_bootstrap_coordinator.sql` está adentro de la imagen. Hoy verifica que existan `seeds` y `scripts`, que es casi lo mismo pero no lo dice por nombre |
| `07-entorno-y-release.md` | Nada nuevo en la matriz: los cinco nombres que este documento consume (`POSTGRES_PASSWORD`, `HS_APP_PASSWORD`, `HS_MIGRATOR_PASSWORD`, `DATABASE_URL`, `MIGRATION_DATABASE_URL`) ya están. Sí conviene anotar que `HS_APP_PASSWORD` y `HS_MIGRATOR_PASSWORD` **se consumen dos veces**: una por el servicio `db` al crear los roles, y otra adentro de las dos URLs. Si una cambia y la otra no, la API deja de conectar |
| `07-entorno-y-release.md` | Que `API_TAG` se actualice después de la reconstrucción del Paso 7, **antes** de `db:seed` |
| `08-backups.md` | El volumen a respaldar es `db-data`. Los roles **no viven ahí**: `pg_dumpall --roles-only` los trae, pero un `pg_dump` de la base sola no. Una restauración sobre un Postgres nuevo necesita que los dos roles existan antes, o fallan todos los `GRANT` y los `OWNER TO` |
| `09-puesta-en-marcha.md` | El roster real se importa con `roster:import`, que es un **upsert por `employee_number`**: con el legajo real ya sembrado (Paso 7), la primera importación **corrige** la fila del coordinador en vez de crear una segunda |
| `09-puesta-en-marcha.md` | `pnpm auth:bootstrap` sin argumentos usa `acc00000-0000-4000-8000-000000000001`, que este documento conservó intacto |
| `10-operacion.md` | La consulta de conexiones ociosas del Paso 10, y el número: 12 por réplica sobre `max_connections = 100` |
| `README.md` de este directorio | La fila de propiedad dice `db/init/01-roles.sql`. Ahora el artefacto son **dos** archivos: `db/init/01-roles.sh` y `db/init/sql/01-roles.sql` |

---

## 8. Riesgos con datos reales

### R1 — El seed sembrado sin editar. Irreversible

**Qué es.** `db:seed` con el seed de relleno inserta `BOOTSTRAP-0001`, `Health and Safety
Coordinator` y `coordinator@example.com` en la base de producción.

**Por qué no tiene deshacer.** Por ADR-002 este sistema no borra: no hay `DELETE` para
`hs_app` sobre `person` ni sobre `app_user`, solo `deactivated_at`. Y hay una segunda capa,
más profunda que los privilegios: el `INSERT` de la persona y el alta de la cuenta disparan
los triggers de auditoría, que escriben en la cadena de `audit_log` — una tabla inmutable
por el trigger `hs_forbid_mutation`, que alcanza a **todos** los roles, incluido el dueño.

**Lo que sí se puede hacer, y lo que igual queda.** Los cinco campos son corregibles desde
la administración: las migraciones conceden `UPDATE (first_name, last_name, site_id,
deactivated_at)` y `UPDATE (employee_number)` sobre `person`, y `UPDATE (email, role,
deactivated_at, …)` sobre `app_user`. Así que la fila se puede arreglar. Lo que **no** se
puede es que nunca haya existido: la cadena de auditoría conserva para siempre el alta con
los datos de relleno, y encima suma las entradas de cada corrección. Un registro que se
defiende ante un regulador arranca diciendo que la primera persona del sistema se llamó
"Health and Safety Coordinator".

**Cómo se evita.** El Paso 7 es precondición bloqueante del Paso 8, y su comprobación no se
hace sobre el archivo del repositorio sino **adentro de la imagen**.

### R2 — `jobs:install` antes de la migración 0008. Irreversible en la práctica

Los `ALTER DEFAULT PRIVILEGES` no son retroactivos. Invertido el orden, el esquema `pgboss`
queda fuera del alcance de `hs_app` y **el sistema no da ningún error**: la API arranca,
`isInstalled()` dice `true`, el worker se registra y no consume nunca. Los crons de las
03:00 y las 04:00 de Ontario no abren el período de inspección, y eso se descubre cuando
falta una inspección mensual — es decir, con el daño regulatorio ya hecho.

Es "irreversible en la práctica" y no en sentido estricto: se arregla con los `GRANT` de la
sección 6. Lo que no se recupera es el mes que no se abrió.

**Cómo se evita.** El orden del Paso 5 antes del Paso 6, la comprobación previa de los
default privileges de `pgboss`, y sobre todo que la verificación del Paso 6 **no sea el
código de salida del comando** sino el catálogo de privilegios.

### R3 — `docker compose down -v` o `docker volume rm` con datos adentro

`down -v` borra `db-data` **y** `storage-data`: la base y las fotos, que son la evidencia de
cada hallazgo. En esta topología las dos viven en la misma máquina.

Este documento usa `docker volume rm hs-platform_db-data` en el Paso 3, **una sola vez y
con la precondición 1.2 verificada**. Ese comando no se vuelve a escribir después del Paso
8. Si hace falta rehacer la base con datos adentro, el camino es el `08` —restaurar— y no
borrar y repetir: repetir el Paso 8 sobre una base vacía no recupera nada, solo vuelve a
sembrar un sistema sin historia.

Con datos reales, `down -v` no es un reinicio. Es destrucción.

### R4 — Los roles mal creados sobre un volumen ya inicializado

`docker-entrypoint-initdb.d` corre **una sola vez, con el volumen vacío** (H15). Es lo que
hace que este documento tenga que ir antes que cualquier dato, y lo que hace que el Paso 4
exista: es la única ventana en la que un error de roles se arregla borrando.

Después, el reflejo equivocado es `down -v` "para que corra el init de nuevo". No se hace.
Se usa `\password` sobre la base viva (sección 6), que no interrumpe nada y no deja el valor
ni en el historial ni en el log.

El caso peor de esta familia no es la contraseña: es que el volumen se haya inicializado
**sin los roles**, porque `db` arrancó antes de que existiera `db/init/`. Ahí la base queda
con el superusuario y nada más, `db:migrate` falla, y si alguien resuelve el problema
corriendo las migraciones como `postgres`, el esquema entero queda con el dueño equivocado y
ADR-002 deja de existir en silencio — que es exactamente el error caro que el encabezado del
script de roles advierte desde el principio del proyecto.

---

## Referencias

- `docs/deployment/README.md` — contrato de nombres, grupos de variables, propiedad, H8, H12, H15, H17
- `docs/deployment/01-preflight.md`, Paso 6 — la especificación de la edición del seed
- `docs/deployment/03-infraestructura.md` — el compose, el servicio `migrator` y el montaje de `db/init`
- `docs/deployment/07-entorno-y-release.md` — los valores de las cinco variables y el arranque
- `docs/adr/002-engine-enforced-immutability.md` — los dos roles y por qué `hs_app` no recibe `UPDATE`
- `docs/adr/004-postgres-drizzle-rls.md` — `FORCE ROW LEVEL SECURITY` y el aislamiento por sitio
- `docs/adr/005-pg-boss-not-bullmq.md` — pg-boss sobre la misma Postgres, sin Redis
- `apps/api/drizzle/0001_immutability_mechanism.sql` — `hs_forbid_mutation` (HS001) y `hs_apply_site_isolation`
- `apps/api/drizzle/0008_inspection_scheduling.sql` §9 — los default privileges de `pgboss`
- `apps/api/scripts/jobs-install.mjs` — el encabezado que explica el orden
- `apps/api/scripts/seed.mjs` — una transacción por archivo, orden por nombre
- `apps/api/src/db/db.service.ts` — el pool de la API y por qué `MIGRATION_DATABASE_URL` no entra
- `apps/api/src/jobs/jobs.service.ts` — `max: 2` y la verificación de esquema al arrancar
- `Requisitos_V1.2.md` §7 — el spike 2
