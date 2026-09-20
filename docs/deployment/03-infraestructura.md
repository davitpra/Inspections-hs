# 03 — Infraestructura: el VPS, la red y el compose

**Qué resuelve.** Deja el VPS preparado, los tres subdominios resolviendo con TLS, y el
`compose.prod.yml` y el `Caddyfile` escritos. Al salir de este documento la infraestructura
está levantada y vacía: sin esquema, sin bucket, sin cliente y sin datos.

**Qué NO resuelve.** Los roles y las migraciones son del `04`. El bucket y su credencial son
del `05`. El bundle del cliente es del `06`. Los valores de las variables son del `07`.

**Artefactos que este documento crea o modifica.**

- `compose.prod.yml` (raíz del repo) — nuevo. **Este documento es su único dueño**
- `Caddyfile` (raíz del repo) — nuevo. **Este documento es su único dueño**

Si un paso te lleva a tocar algo que no está en esta lista, pará: es de otro documento.

> **Sobre la propiedad.** Los documentos `04`, `05` y `06` describen qué tiene que contener
> el bloque que les corresponde, y este documento lo implementa. Si necesitás cambiar el
> compose por algo de ellos, el cambio se hace **acá**, no allá.

---

## 1. Precondiciones

### El `02` está ejecutado y la imagen existe en el VPS

```bash
ssh <USUARIO>@<HOST_VPS> "docker images hs-platform-api --format '{{.Tag}}'"
```

Tiene que listar el tag del commit. Si está vacío, volvé al `02`, Paso 6.

### El `07` está ejecutado y `.env.prod` está en el VPS

```bash
ssh <USUARIO>@<HOST_VPS> "stat -c '%a' /srv/hs-platform/.env.prod"
```

Tiene que decir `600`. Este documento **no inventa ni un valor**: los lee de ahí.

### El VPS

Mínimo: 2 vCPU, 2 GB de RAM, 40 GB de disco. Debian 12 o Ubuntu 24.04.

Los 2 GB son por el build, no por el runtime: la API en reposo usa bastante menos. Si vas a
construir la imagen local y transferirla con `docker save` (recomendado en el `02`), 1 GB
alcanza para correr — pero el disco sí importa, y crece: ver el `10`.

### Docker y NTP

```bash
ssh <USUARIO>@<HOST_VPS> "docker compose version && timedatectl show -p NTPSynchronized --value"
```

La segunda tiene que decir `yes`. **No es cosmético:** los dos crons de pg-boss son horarios
civiles de `America/Toronto`, y un reloj corrido abre el período el día equivocado.

---

## 2. Decisiones ya tomadas

| # | Decisión | Por qué |
| --- | --- | --- |
| D1 | **Ningún puerto publicado salvo 80 y 443** | El compose de desarrollo publica 5432, 9000 y 9001. Copiado a un VPS, eso pone Postgres y la consola de MinIO en internet |
| D2 | **Ninguna credencial literal en el compose** | El de desarrollo trae `postgres`, `minioadmin` y `hs_app_dev` escritos. Todo sale de `.env.prod` por interpolación |
| D3 | `--env-file .env.prod` con `environment:` **explícito**, y no `env_file:` | `env_file:` volcaría el archivo entero en el proceso, incluida `MIGRATION_DATABASE_URL`. Con lista explícita, la exclusión queda garantizada por construcción |
| D4 | Los comandos one-off viven en un servicio `migrator` bajo `profiles: ["tools"]` | No arranca con `up`, y es el único lugar donde `MIGRATION_DATABASE_URL` existe |
| D5 | `stop_grace_period: 30s` en `api` | El default son 10 s y `SHUTDOWN_GRACE_MS` vale 8000: quedaban 2 s, que no alcanzan para que pg-boss termine |
| D6 | Caddy termina TLS para los tres subdominios | Certificados automáticos. `s3.` tiene que estar en internet igual: el teléfono sube las fotos directo al bucket |
| D7 | Límite de logs en todos los servicios | Un disco lleno corrompe la base, y los logs de Docker crecen sin techo por default |
| D8 | Los cuatro pedidos del `06` sobre el bloque `app.` **ya están aplicados** | Bloques `handle` excluyentes, `/assets/*` fuera del fallback, `manifest.webmanifest` con su tipo, y `web/` creado antes de levantar `caddy`. No se reabren |

---

## 3. Pasos

### Paso 1 — El DNS, antes de cualquier otra cosa

Tres registros `A` al IP del VPS:

```
app.<DOMINIO>    A    <IP_VPS>
api.<DOMINIO>    A    <IP_VPS>
s3.<DOMINIO>     A    <IP_VPS>
```

**Verificá que los tres propaguen antes de levantar Caddy.** Si Caddy pide certificados con
el DNS a medio propagar, falla y reintenta, y Let's Encrypt tiene un límite de fallos por
dominio y por hora. Quedarse afuera de ese límite cuesta horas de espera.

```bash
for s in app api s3; do echo -n "$s: "; dig +short "$s.<DOMINIO>"; done
```

Los tres tienen que imprimir el IP del VPS. Si alguno sale vacío, **esperá**. No sigas.

### Paso 2 — El firewall

Solo tres puertos entrantes. Ninguno más.

```bash
ssh <USUARIO>@<HOST_VPS> '
  sudo ufw default deny incoming
  sudo ufw default allow outgoing
  sudo ufw allow 22/tcp
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw --force enable
  sudo ufw status numbered
'
```

El 80 hace falta aunque todo sea https: es por donde Let's Encrypt valida el desafío
HTTP-01, y por donde Caddy redirige a https.

**Cómo sé que salió bien.** Desde tu máquina, Postgres y MinIO tienen que estar cerrados:

```bash
nc -z -w3 <IP_VPS> 5432 && echo "FALLÓ: Postgres expuesto" || echo "5432 cerrado"
nc -z -w3 <IP_VPS> 9000 && echo "FALLÓ: MinIO expuesto" || echo "9000 cerrado"
nc -z -w3 <IP_VPS> 9001 && echo "FALLÓ: consola expuesta" || echo "9001 cerrado"
```

Los tres tienen que dar cerrado. Esta comprobación se repite al final, con los contenedores
ya corriendo: el firewall es una defensa, pero la de verdad es no publicar el puerto.

### Paso 3 — El directorio de trabajo en el VPS

```bash
ssh <USUARIO>@<HOST_VPS> '
  sudo mkdir -p /srv/hs-platform/web /srv/hs-platform/db
  sudo chown -R $USER /srv/hs-platform
'
```

Ahí van `compose.prod.yml`, `Caddyfile`, `.env.prod` y `db/init/`.

**`web/` se crea acá, vacío y a propósito.** Es el bind mount del servicio `caddy`. Si no
existe cuando el contenedor arranca, **Docker lo crea como `root`**, y después el `rsync`
del documento `06` falla con `Permission denied` sin decir por qué.

### Paso 4 — Crear `compose.prod.yml`

En la raíz del repo, para después copiarlo al VPS.

```bash
cat > compose.prod.yml <<'EOF'
# Producción, en una sola máquina. Ver docs/deployment/03-infraestructura.md.
#
# NO es el docker-compose.yml de desarrollo con otros valores. Dos diferencias que
# son la razón de que este archivo exista aparte:
#
#   1. NINGÚN puerto publicado salvo el 80 y el 443 de Caddy. El de desarrollo
#      publica 5432, 9000 y 9001; en un VPS eso es Postgres y la consola de MinIO
#      en internet.
#   2. NINGUNA credencial literal. Todo sale de .env.prod por interpolación, que
#      se pasa con `--env-file .env.prod`.
#
# Se levanta SIEMPRE así:
#   docker compose --env-file .env.prod -f compose.prod.yml up -d

name: hs-platform

services:
  # ---------------------------------------------------------------------------
  # La base. Sin puertos: solo la alcanza la red interna.
  # ---------------------------------------------------------------------------
  db:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      # El superusuario existe solo para el bootstrap del contenedor. Ninguna
      # aplicación lo usa: la API se conecta como hs_app y las migraciones como
      # hs_migrator (ADR-002).
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?falta POSTGRES_PASSWORD en .env.prod}
      POSTGRES_DB: hs_platform
      # El script parametrizado de `04` los consume durante el initdb. No son
      # credenciales de la API y no se declaran en el servicio `api`.
      HS_APP_PASSWORD: ${HS_APP_PASSWORD:?falta HS_APP_PASSWORD en .env.prod}
      HS_MIGRATOR_PASSWORD: ${HS_MIGRATOR_PASSWORD:?falta HS_MIGRATOR_PASSWORD en .env.prod}
    volumes:
      - db-data:/var/lib/postgresql/data
      # Los scripts de acá corren UNA SOLA VEZ, con el volumen vacío. El archivo
      # está parametrizado por el documento 04: no lleva contraseñas literales.
      - ./db/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d hs_platform"]
      interval: 10s
      timeout: 5s
      retries: 10
    logging: &logging
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    networks: [hs-platform]

  # ---------------------------------------------------------------------------
  # El almacenamiento de objetos. Lo expone Caddy en s3.<DOMINIO>, porque el
  # teléfono sube las fotos DIRECTO acá con una URL firmada (ADR-006).
  # La consola (9001) NO se expone: no hay bloque de Caddy para ella.
  # ---------------------------------------------------------------------------
  storage:
    image: minio/minio:RELEASE.2025-04-22T22-12-26Z
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:?falta MINIO_ROOT_USER en .env.prod}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:?falta MINIO_ROOT_PASSWORD en .env.prod}
      # El host público con el que MinIO se anuncia. NO es lo que hace validar la
      # firma de la API: esas URLs las arma el SDK con S3_ENDPOINT, y
      # object-storage.ts no conoce esta variable. Lo que hace validar la firma es
      # `header_up Host {host}` en el bloque s3. del Caddyfile (comprobado: Host
      # original -> 200, Host reescrito -> 403 SignatureDoesNotMatch).
      # Se declara igual, porque es lo que usan las URLs que firma el propio MinIO
      # (por ejemplo `mc share download`, que usa el documento 05 para verificar).
      MINIO_SERVER_URL: https://s3.${DOMINIO:?falta DOMINIO en .env.prod}
      #
      # NO AGREGAR MINIO_API_CORS_ALLOW_ORIGIN acá. El CORS lo configura
      # `db/minio/bucket.sh` (documento 05) con `mc admin config set`. Si esta
      # variable existe, GANA EN RUNTIME aunque `mc admin config get` muestre el
      # valor configurado y el `set` haya contestado "Successfully applied".
      # Es un fallo silencioso: el preflight responde al origen del env var.
    volumes:
      - storage-data:/data
    healthcheck:
      test: ["CMD-SHELL", "mc ready local"]
      interval: 10s
      timeout: 5s
      retries: 10
    logging: *logging
    networks: [hs-platform]

  # ---------------------------------------------------------------------------
  # El bucket, su versioning y la credencial limitada. Corre una vez y sale.
  # SU CONTENIDO ES DEL DOCUMENTO 05: acá solo se declara el servicio.
  # ---------------------------------------------------------------------------
  storage-init:
    image: minio/mc:RELEASE.2025-04-16T18-13-26Z
    depends_on:
      storage:
        condition: service_healthy
    restart: "no"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID:?falta S3_ACCESS_KEY_ID en .env.prod}
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY:?falta S3_SECRET_ACCESS_KEY en .env.prod}
      S3_BUCKET: ${S3_BUCKET:?falta S3_BUCKET en .env.prod}
      WEB_ORIGIN: https://app.${DOMINIO}
    entrypoint: ["/bin/sh", "/init/bucket.sh"]
    volumes:
      - ./db/minio:/init:ro
    logging: *logging
    networks: [hs-platform]

  # ---------------------------------------------------------------------------
  # La API. Sin puertos publicados: la alcanza Caddy por la red interna.
  # ---------------------------------------------------------------------------
  api:
    image: hs-platform-api:${API_TAG:?falta API_TAG (el hash corto del commit)}
    restart: unless-stopped
    working_dir: /app/apps/api
    depends_on:
      db:
        condition: service_healthy
      storage:
        condition: service_healthy
    # environment EXPLÍCITO y no `env_file:`, a propósito. `env_file` volcaría
    # .env.prod entero, incluida MIGRATION_DATABASE_URL, que es la credencial del
    # rol DUEÑO y evade FORCE ROW LEVEL SECURITY. env.ts no la conoce, así que si
    # se colara nadie avisaría. Acá la exclusión está garantizada por construcción.
    environment:
      NODE_ENV: production
      PORT: 3000
      DATABASE_URL: ${DATABASE_URL:?falta DATABASE_URL en .env.prod}
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:?falta BETTER_AUTH_SECRET en .env.prod}
      BETTER_AUTH_URL: ${BETTER_AUTH_URL:?falta BETTER_AUTH_URL en .env.prod}
      WEB_ORIGINS: ${WEB_ORIGINS:?falta WEB_ORIGINS en .env.prod}
      TRUST_PROXY: ${TRUST_PROXY:?falta TRUST_PROXY en .env.prod}
      SHUTDOWN_GRACE_MS: ${SHUTDOWN_GRACE_MS:-8000}
      JOBS_ENABLED: ${JOBS_ENABLED:-true}
      S3_ENDPOINT: ${S3_ENDPOINT:?falta S3_ENDPOINT en .env.prod}
      S3_BUCKET: ${S3_BUCKET}
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID}
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY}
      S3_REGION: ${S3_REGION:-us-east-1}
      S3_FORCE_PATH_STYLE: ${S3_FORCE_PATH_STYLE:-true}
      S3_UPLOAD_TTL_SECONDS: ${S3_UPLOAD_TTL_SECONDS:-300}
    healthcheck:
      # GET /health es público desde el documento 01. Antes de ese arreglo esta
      # sonda devolvía 401 y el contenedor quedaba enfermo para siempre.
      test: ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    # 30s, no el default de 10. shutdown.ts espera SHUTDOWN_GRACE_MS (8000) a los
    # requests en vuelo y DESPUÉS cierra pg-boss y el pool. Con 10s quedaban 2s.
    stop_grace_period: 30s
    logging: *logging
    networks: [hs-platform]

  # ---------------------------------------------------------------------------
  # Los comandos one-off. NO arranca con `up`: vive detrás de un perfil.
  # Es el ÚNICO lugar donde MIGRATION_DATABASE_URL existe.
  #
  #   docker compose --env-file .env.prod -f compose.prod.yml \
  #     --profile tools run --rm migrator pnpm db:migrate
  # ---------------------------------------------------------------------------
  migrator:
    image: hs-platform-api:${API_TAG}
    profiles: ["tools"]
    working_dir: /app/apps/api
    depends_on:
      db:
        condition: service_healthy
    entrypoint: [""]
    environment:
      NODE_ENV: production
      # El rol dueño. Solo acá, nunca en el servicio `api`.
      MIGRATION_DATABASE_URL: ${MIGRATION_DATABASE_URL:?falta MIGRATION_DATABASE_URL en .env.prod}
      # Los comandos auth:* y roster:import corren como hs_app.
      DATABASE_URL: ${DATABASE_URL}
    logging: *logging
    networks: [hs-platform]

  # ---------------------------------------------------------------------------
  # El único servicio con puertos publicados. Termina TLS y sirve el cliente.
  # ---------------------------------------------------------------------------
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    environment:
      DOMINIO: ${DOMINIO}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      # El bundle del cliente. Lo produce y lo publica el documento 06.
      - ./web:/srv/web:ro
      - caddy-data:/data
      - caddy-config:/config
    logging: *logging
    networks: [hs-platform]

volumes:
  db-data:
  storage-data:
  caddy-data:
  caddy-config:

networks:
  hs-platform:
    driver: bridge
EOF
```

**Cómo sé que salió bien.** No hay credenciales literales ni puertos de más:

```bash
grep -nE "minioadmin|hs_app_dev|hs_migrator_dev|POSTGRES_PASSWORD: postgres" compose.prod.yml \
  && echo "FALLÓ: credencial literal" || echo "sin credenciales literales"
grep -nE '^\s+- "(5432|9000|9001)' compose.prod.yml \
  && echo "FALLÓ: puerto expuesto" || echo "solo 80 y 443"
```

### Paso 5 — Crear el `Caddyfile`

Los tres bloques implementan requisitos que declararon el `05` y el `06`. Cada uno dice de
quién viene.

```bash
cat > Caddyfile <<'EOF'
# Ver docs/deployment/03-infraestructura.md. Único dueño de este archivo.
#
# Los requisitos de los bloques app. y s3. los declaran los documentos 06 y 05.
# Si hace falta cambiarlos, el cambio se hace ACÁ.

{
	email <EMAIL_ADMIN>
	# Para ensayar sin gastar el límite de Let's Encrypt, descomentar:
	# acme_ca https://acme-staging-v02.api.letsencrypt.org/directory
}

# ---------------------------------------------------------------------------
# El cliente. Requisitos del documento 06.
# ---------------------------------------------------------------------------
app.{$DOMINIO} {
	root * /srv/web
	encode gzip zstd

	# Bloques `handle`: excluyentes y en orden, primero que matchea gana. No es
	# estilo. Con matchers sueltos + un try_files global, el fallback alcanzaba
	# también a los assets, y la cabecera de caché del fallback no llegaba a las
	# navegaciones profundas. Los cuatro requisitos son del documento 06.

	# Los assets llevan hash en el nombre: inmutables.
	#
	# Van en `handle` y NO por try_files a propósito: un /assets/index-<hash>.js
	# que ya no existe tiene que dar 404. Con el fallback, devolvería index.html
	# con 200 y el navegador fallaría con un error de MIME type que no menciona
	# el despliegue por ningún lado. Pasa en cada redeploy, con las pestañas
	# viejas todavía abiertas.
	handle /assets/* {
		header Cache-Control "public, max-age=31536000, immutable"
		file_server
	}

	# sw.js NO está hasheado, y el service worker hace skipWaiting + clientsClaim.
	# Con caché larga los teléfonos quedan clavados en una versión vieja y no hay
	# forma de alcanzarlos.
	handle /sw.js {
		header Cache-Control "no-cache, must-revalidate"
		file_server
	}

	# El manifest tampoco lleva hash, y de su Content-Type depende que la PWA sea
	# instalable.
	handle /manifest.webmanifest {
		header Cache-Control "no-cache, must-revalidate"
		header Content-Type "application/manifest+json"
		file_server
	}

	# Todo lo demás: el fallback SPA, con la cabecera aplicada A LA RESPUESTA y no
	# a la ruta pedida. El service worker solo cubre /, /inspections/* y /outbox,
	# y solo DESPUÉS de instalarse: en la primera visita, y en las otras 12 rutas
	# del router —incluida /accept-invitation, por donde entra toda invitación—,
	# el fallback lo tiene que hacer el servidor o un refresh da 404.
	handle {
		header Cache-Control "no-cache, must-revalidate"
		try_files {path} /index.html
		file_server
	}
}

# ---------------------------------------------------------------------------
# La API.
# ---------------------------------------------------------------------------
api.{$DOMINIO} {
	encode gzip zstd
	# Una foto de evidencia puede pesar 25 MB. El envío no las lleva adentro
	# —van directo al bucket— pero el margen evita una sorpresa.
	request_body {
		max_size 30MB
	}
	reverse_proxy api:3000
}

# ---------------------------------------------------------------------------
# El bucket. Requisitos del documento 05.
# ---------------------------------------------------------------------------
s3.{$DOMINIO} {
	encode gzip zstd

	# 25 MB por foto, con margen. Un límite por debajo corta el PUT del teléfono.
	request_body {
		max_size 30MB
	}

	reverse_proxy storage:9000 {
		# PRESERVAR EL HOST. La firma SigV4 de la URL incluye el header Host: si
		# Caddy lo reescribe al host interno, MinIO calcula otra firma y devuelve
		# 403. El síntoma es "las fotos no suben" sin nada que lo explique.
		header_up Host {host}
		header_up X-Forwarded-Host {host}
	}
}
EOF
```

**Cómo sé que salió bien.**

```bash
docker run --rm -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -e DOMINIO=ejemplo.test caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile
```

### Paso 6 — Copiar al VPS y levantar SOLO Caddy

> ### No levantes `db` en este paso.
>
> `db/init/` lo parametriza el `04` y `db/minio/bucket.sh` lo escribe el `05`. Todavía no
> existen.
>
> `docker-entrypoint-initdb.d` corre **una sola vez, con el volumen vacío**. Si levantás
> `db` ahora, el volumen se inicializa **sin los dos roles de ADR-002**, y el entrypoint no
> vuelve a ejecutarse nunca. La única salida sería borrar el volumen — barato hoy, y
> destrucción total a partir del `09`.
>
> Por eso este paso levanta únicamente `caddy`, que no depende de nadie y es lo que hace
> falta para verificar el TLS. `db` lo levanta el `04`, con su script ya en su lugar, y
> `storage` lo levanta el `05`.

```bash
scp compose.prod.yml Caddyfile <USUARIO>@<HOST_VPS>:/srv/hs-platform/

ssh <USUARIO>@<HOST_VPS> '
  cd /srv/hs-platform
  docker compose --env-file .env.prod -f compose.prod.yml up -d caddy
'
```

`API_TAG` y `DOMINIO` viven en `.env.prod` (documento `07`), no en el entorno del shell: así
el comando es el mismo lo corra quien lo corra.

**Cómo sé que salió bien.**

```bash
ssh <USUARIO>@<HOST_VPS> 'cd /srv/hs-platform && docker compose --env-file .env.prod -f compose.prod.yml ps'
```

Solo `caddy` corriendo. `db`, `storage` y `api` sin arrancar, y eso es lo correcto en este
punto.

### Paso 7 — Verificar el TLS

```bash
for s in app api s3; do
  echo -n "$s: "
  curl -s -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' "https://$s.<DOMINIO>/"
done
```

El segundo número tiene que ser `0` en los tres: el certificado valida.

Que `app.` devuelva 404 en este punto es correcto: el bundle todavía no está (documento
`06`). Que `api.` devuelva 502 también: el servicio aún no arrancó.

### Paso 8 — Swap, solo si construís en el VPS

Si decidiste construir la imagen en la máquina en vez de transferirla, y tiene menos de
4 GB de RAM:

```bash
ssh <USUARIO>@<HOST_VPS> '
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab
  free -h
'
```

Si construís local y transferís con `docker save`, saltealo.

---

## 4. Verificación

```bash
# 1. Solo 80 y 443 escuchan hacia afuera, CON los contenedores corriendo.
for p in 22 80 443 5432 9000 9001; do
  nc -z -w3 <IP_VPS> $p && echo "$p ABIERTO" || echo "$p cerrado"
done
```

Esperado: 22, 80 y 443 abiertos. 5432, 9000 y 9001 **cerrados**. Si alguno de los tres
últimos está abierto, pará: Postgres o la consola de MinIO están en internet.

```bash
# 2. Docker no publica nada que no deba.
ssh <USUARIO>@<HOST_VPS> 'cd /srv/hs-platform && docker compose --env-file .env.prod -f compose.prod.yml ps --format "{{.Service}}\t{{.Ports}}"'
```

Solo `caddy` puede mostrar puertos con `0.0.0.0`.

```bash
# 3. Las credenciales llegan desde `.env.prod`, no desde un literal del compose.
#    Se corre DESPUÉS del 04, cuando `db` ya está levantado.
ssh <USUARIO>@<HOST_VPS> 'cd /srv/hs-platform && docker compose --env-file .env.prod -f compose.prod.yml exec db sh -c '\''test -n "$POSTGRES_PASSWORD"'\'' && echo "credencial presente"'
```

```bash
# 4. El http redirige a https en los tres.
for s in app api s3; do
  echo -n "$s: "; curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' "http://$s.<DOMINIO>/"
done
```

```bash
# 5. MIGRATION_DATABASE_URL no está en el proceso de la API.
ssh <USUARIO>@<HOST_VPS> 'cd /srv/hs-platform && docker compose --env-file .env.prod -f compose.prod.yml exec api printenv | grep -c MIGRATION_DATABASE_URL'
```

Tiene que imprimir `0`.

```bash
# 6. El perfil tools no arranca solo.
ssh <USUARIO>@<HOST_VPS> 'cd /srv/hs-platform && docker compose --env-file .env.prod -f compose.prod.yml ps --services --filter status=running'
```

`migrator` **no** puede aparecer.

```bash
# 7. Los logs tienen techo.
ssh <USUARIO>@<HOST_VPS> 'docker inspect $(docker ps -q) --format "{{.Name}} {{.HostConfig.LogConfig.Config}}"'
```

---

## 5. Criterios de hecho

- [ ] Los tres subdominios resuelven al IP del VPS
- [ ] `ufw` permite solo 22, 80 y 443
- [ ] 5432, 9000 y 9001 están cerrados desde afuera, con los contenedores corriendo
- [ ] `compose.prod.yml` y `Caddyfile` existen, están commiteados y copiados al VPS
- [ ] No hay ninguna credencial literal en `compose.prod.yml`
- [ ] El único servicio con `ports:` es `caddy`
- [ ] `caddy validate` pasa
- [ ] Los tres subdominios sirven https con certificado válido
- [ ] `caddy` está corriendo y `db`, `storage` y `api` **no** se levantaron todavía
- [ ] El servicio `api` declara `stop_grace_period: 30s`
- [ ] El healthcheck de `api` apunta a `GET /health`
- [ ] `MIGRATION_DATABASE_URL` no está en el entorno de `api` (verificado)
- [ ] `migrator` no arranca con `up`
- [ ] Todos los servicios tienen límite de logs
- [ ] NTP sincronizado

---

## 6. Si falla

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| Caddy no emite certificado | DNS sin propagar, o 80 cerrado | Verificá con el Paso 1. **Antes de reintentar en bucle**, activá `acme_ca` de staging: Let's Encrypt limita los fallos por dominio y por hora |
| `too many failed authorizations` | Ya se agotó el límite | Esperá una hora. Usá staging hasta que el DNS esté bien. No hay atajo |
| `variable is not set` al hacer `up` | Falta una variable en `.env.prod`, o no se pasó `--env-file` | El mensaje nombra cuál. Los `:?` del compose existen para que falle acá y no a mitad de camino |
| `db` nunca llega a `healthy` | El volumen se inicializó antes con otra contraseña | `docker-entrypoint-initdb.d` corre **una sola vez**. Si no hay datos: `docker compose down -v`. **Si hay datos reales, NO**: ver la sección 8 |
| `api` reinicia en bucle | Falta el esquema `pgboss` | Es lo esperado hasta que corra el `04`. El mensaje lo dice |
| `api` sano pero el healthcheck falla | El `01` no se ejecutó y `/health` sigue pidiendo token | Volvé al `01` |
| Las fotos no suben, 403 del bucket | Caddy no preserva el `Host` y SigV4 no valida | Verificá `header_up Host {host}` en el bloque `s3.` |
| Un refresh en una ruta del cliente da 404 | Falta el fallback SPA | Verificá `try_files {path} /index.html` en el bloque `app.` |
| El build muere con `Killed` | OOM | Paso 8, o construí local y transferí |

**Punto de retroceso.** Mientras la base esté vacía, `docker compose down -v` borra todo y
se empieza de nuevo sin costo. **Ese margen se termina en el `09`**, cuando entra el primer
dato real. A partir de ahí `down -v` es destrucción, no reinicio.

---

## 7. Lo que este documento le pide a otro

| Documento | Qué necesita |
| --- | --- |
| `04-postgres.md` | `db/init/01-roles.sh` y `db/init/sql/01-roles.sql` **parametrizados**, sin contraseñas literales, leyendo `HS_APP_PASSWORD` y `HS_MIGRATOR_PASSWORD`. El montaje ya está declarado |
| `04-postgres.md` | **Levantar `db` es del `04`, no de acá**, y solo con `db/init/` ya copiado. El volumen se inicializa una sola vez |
| `04-postgres.md` | Los comandos van por `--profile tools run --rm migrator`. Ese es el único lugar con `MIGRATION_DATABASE_URL` |
| `05-objetos-minio.md` | Escribir `db/minio/bucket.sh`, que es el entrypoint de `storage-init`. Recibe `MINIO_ROOT_*`, `S3_*` y `WEB_ORIGIN` por entorno. Tiene que crear el bucket, activar versioning, crear la credencial **sin `DeleteObject`** y configurar CORS |
| `06-cliente-web.md` | Publicar el bundle en `/srv/hs-platform/web/` del VPS. Caddy ya lo monta en `/srv/web` |
| `07-entorno-y-release.md` | **Corrección:** el compose usa `--env-file` con `environment:` explícito, no `env_file:`. `env_file:` habría volcado `MIGRATION_DATABASE_URL` al proceso |
| `07-entorno-y-release.md` | Dos variables que el compose necesita y que no estaban en la matriz: `DOMINIO` y `API_TAG` |
| `08-backups.md` | Los volúmenes a respaldar son `db-data` y `storage-data`. Más `/srv/hs-platform/.env.prod`, que no está en ningún volumen |
| `10-operacion.md` | Los logs tienen techo de 10 MB por 3 archivos por servicio. El crecimiento de `storage-data` no tiene techo: versioning sin borrado |

---

## 8. Riesgos con datos reales

**`docker compose down -v`.** Borra `db-data` y `storage-data`: la base **y** las fotos, que
son la evidencia de cada hallazgo. En esta topología las dos viven en la misma máquina, así
que un solo comando mal tipeado se lleva todo. No existe deshacer; existe el `08`.

**El volumen ya inicializado.** `docker-entrypoint-initdb.d` corre una sola vez. Si los
roles quedaron mal creados y ya hay datos, **no se corrige borrando el volumen**: se corrige
con `ALTER ROLE` sobre la base viva. El `04` lo cubre.

**Un puerto publicado por comodidad.** Abrir 5432 "un rato para depurar" expone la base con
una contraseña que ya está en `.env.prod`. Si hace falta entrar, `docker compose exec` o un
túnel SSH; nunca un `ports:`.

**La consola de MinIO.** No tiene bloque en el Caddyfile a propósito. Publicarla da acceso
con `MINIO_ROOT_PASSWORD` a todos los objetos, incluidos los que la aplicación no puede
borrar por diseño.

---

## Referencias

- `docs/deployment/README.md` — contrato de nombres, grupos de variables, propiedad
- `docker-compose.yml` — el de desarrollo, que este archivo **no** reemplaza ni reusa
- `apps/api/src/shutdown.ts` — qué pasa durante `stop_grace_period`
- `apps/api/src/uploads/object-storage.ts` — qué firma el presign, y por qué el `Host` importa
- `apps/web/src/sw.ts` — qué rutas cubre el service worker, y por qué hace falta el fallback SPA
- ADR-002 — los dos roles; ADR-006 — el bucket sin borrado; ADR-008 — la topología, superada por ADR-026
