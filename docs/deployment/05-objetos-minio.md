# 05 — Objetos: el bucket, la credencial sin borrado y CORS

**Qué resuelve.** Al entrar, `03` dejó `storage` sin configurar: no hay bucket,
no hay credencial de aplicación y CORS acepta cualquier origen. Al salir hay un bucket con
**versioning activado**, una credencial limitada con `PutObject` y `GetObject` y **sin
`DeleteObject`**, y CORS restringido al origen de la PWA. Desde ese momento
`POST /uploads/presign` firma una URL y el PUT que hace el teléfono contra el bucket entra.

**Qué NO resuelve.** `compose.prod.yml` y el `Caddyfile` son del `03`. Los valores de las
variables son del `07`. La sesión y el roster con los que se prueba el presign de punta a
punta son del `09`. El respaldo del volumen `storage-data` es del `08`.

**Artefactos que este documento crea o modifica.**

- `db/minio/bucket.sh` (raíz del repo) — nuevo. **Este documento es su único dueño**

Si un paso te lleva a tocar algo que no está en esta lista, pará: es de otro documento. El
servicio `storage-init` que ejecuta este script ya está declarado en `compose.prod.yml`, y
ese archivo es del `03`.

> **Dónde se ejecuta cada comando.** El Paso 1 es local, en el repo. Del Paso 3 en adelante
> los comandos corren **en el VPS**, dentro de `/srv/hs-platform`. Los que comprueban qué
> se ve desde internet dicen explícitamente «desde tu máquina»: correrlos en el VPS los
> volvería inútiles, porque desde adentro todo es alcanzable.

---

## 1. Precondiciones

### El `03` está ejecutado y `storage` todavía no está configurado

```bash
cd /srv/hs-platform
docker compose --env-file .env.prod -f compose.prod.yml ps -a storage
```

Puede no existir todavía o estar detenido. El Paso 3 levanta `storage` como dependencia de
`storage-init` y lo configura por dentro; no se publica ningún puerto adicional.

### El `07` está ejecutado y `.env.prod` tiene las variables que el servicio pasa

`storage-init` recibe seis variables. Cinco salen de `.env.prod` tal cual
(`MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
`S3_BUCKET`) y la sexta, `WEB_ORIGIN`, la arma el compose como `https://app.${DOMINIO}`.

```bash
grep -cE '^(MINIO_ROOT_USER|MINIO_ROOT_PASSWORD|S3_ACCESS_KEY_ID|S3_SECRET_ACCESS_KEY|S3_BUCKET|DOMINIO)=' \
  /srv/hs-platform/.env.prod
```

Tiene que imprimir `6`. Cuenta líneas y no muestra ningún valor, que es el punto.

### El bloque `s3.` del Caddyfile preserva el `Host`

```bash
grep -n "header_up Host" /srv/hs-platform/Caddyfile
```

Tiene que aparecer dentro del bloque `s3.`. Sin eso, todo lo que este documento configura
funciona y las fotos igual no suben: ver el Paso 8 y la sección 6.

### Leíste ADR-006 y el servicio `storage-init` del compose de desarrollo

```bash
grep -n "storage-init" -A 30 docker-compose.yml
```

El comentario largo de ese servicio es el origen de este documento: dice por qué la
credencial no tiene `DeleteObject` y por qué eso es *la mitad de ADR-006 que el código no
puede aplicar*. `db/minio/bucket.sh` es la versión de producción de ese entrypoint.

---

## 2. Decisiones ya tomadas

| # | Decisión | Por qué |
| --- | --- | --- |
| D1 | La credencial de la aplicación **no tiene `DeleteObject`** | ADR-006. En `apps/api` no hay método para borrar; acá se hace que tampoco haya permiso. Lo uno sin lo otro es una convención, no una garantía |
| D2 | Versioning activado en el bucket | Una sobreescritura con la misma clave no pierde la foto anterior. Es la segunda mitad de D1: sin versioning, un PUT repetido borra sin `DeleteObject` |
| D3 | Tampoco lleva `s3:ListBucket` | `apps/api/src/uploads/object-storage.ts` deriva la clave y la firma; nunca enumera. Un permiso que nadie usa es superficie de ataque, no comodidad |
| D4 | CORS por la clave de servidor `api cors_allow_origin`, no por bucket | **Verificado contra `RELEASE.2025-04-22T22-12-26Z`**: MinIO community no implementa `PutBucketCors` — `mc cors set` devuelve `A header you provided implies functionality that is not implemented`. La clave de servidor es lo único que existe |
| D5 | Un solo origen en CORS, el de la PWA | El default de MinIO es `*`, y con `*` **devuelve el `Access-Control-Allow-Origin` de cualquier página que pregunte**. La subida igual necesita una URL firmada, pero no hay razón para ofrecerle el bucket a otro origen |
| D6 | El script vive en `db/minio/bucket.sh` y no inline en el compose | El de desarrollo es inline porque sus credenciales son literales. Acá todo sale del entorno, y un script en un archivo se puede leer, versionar y probar |
| D7 | `storage-init` corre en **cada** `up` y es idempotente | Un paso de bootstrap que hay que acordarse de correr es un paso que un día no se corre. Se probó corriéndolo dos veces seguidas contra el mismo servidor |
| D8 | La consola de MinIO (9001) no se publica | Decisión del `03` (D1 y sección 8 de aquel documento). Da acceso con `MINIO_ROOT_PASSWORD` a todos los objetos, incluidos los que la aplicación no puede borrar por diseño |

---

## 3. Pasos

### Paso 1 — Escribir `db/minio/bucket.sh`

En el repo, local. Es el entrypoint que `compose.prod.yml` ya monta en `/init`.

```bash
mkdir -p db/minio
cat > db/minio/bucket.sh <<'EOF'
#!/bin/sh
# Entrypoint del servicio `storage-init` de compose.prod.yml.
# Ver docs/deployment/05-objetos-minio.md, que es el dueño de este archivo.
#
# Es la versión de producción del entrypoint inline que el docker-compose.yml de
# desarrollo tiene escrito. Tres diferencias, y las tres son la razón de que este
# archivo exista aparte:
#
#   1. NINGUNA credencial literal: todo llega por entorno desde .env.prod.
#   2. Falla ruidoso si falta una variable, antes de tocar el servidor.
#   3. Configura CORS, que en desarrollo no hace falta porque el navegador y el
#      bucket comparten localhost.
#
# LO QUE ESTE SCRIPT HACE Y NO ES DECORATIVO: la credencial que recibe la API
# tiene `PutObject` y `GetObject` sobre el prefijo del bucket, y NO tiene
# `DeleteObject`. Es la mitad de ADR-006 que el código no puede aplicar: en
# apps/api no hay método para borrar, y acá se hace que tampoco haya permiso.
# Con versioning activado, ni siquiera una sobreescritura pierde la foto que
# respalda un hallazgo.
#
# Es idempotente: corre en cada `up` y no rompe nada si ya estaba todo hecho.

set -eu

# El nombre de la política. No es un secreto y no cambia entre instalaciones.
POLICY_NAME=hs-uploads

# El endpoint interno. `storage` es el nombre del servicio en compose.prod.yml y
# resuelve por la red de Docker. Se puede sobreescribir para probar el script
# contra otro servidor; en producción no se pasa y no hace falta declararlo.
MINIO_ENDPOINT=${MINIO_ENDPOINT:-http://storage:9000}

# --- 0. El entorno, entero, antes de tocar el servidor -----------------------
# Una variable vacía acá deja el bucket a medio configurar, y el síntoma aparece
# recién cuando un teléfono intenta subir una foto.
faltan=
for nombre in MINIO_ROOT_USER MINIO_ROOT_PASSWORD S3_ACCESS_KEY_ID \
              S3_SECRET_ACCESS_KEY S3_BUCKET WEB_ORIGIN; do
  eval "valor=\${$nombre:-}"
  [ -n "$valor" ] || faltan="$faltan $nombre"
done

if [ -n "$faltan" ]; then
  echo "storage-init: faltan variables de entorno:$faltan" >&2
  echo "storage-init: las declara el servicio storage-init de compose.prod.yml" >&2
  exit 1
fi

# --- 1. El alias de administración -------------------------------------------
# `depends_on: service_healthy` ya espera al servidor, pero el healthcheck y el
# primer request no son el mismo instante. Diez intentos de un segundo.
intento=1
until mc alias set root "$MINIO_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
  if [ "$intento" -ge 10 ]; then
    echo "storage-init: no se pudo conectar a $MINIO_ENDPOINT" >&2
    exit 1
  fi
  intento=$((intento + 1))
  sleep 1
done

# --- 2. El bucket -------------------------------------------------------------
mc mb --ignore-existing "root/$S3_BUCKET"

# --- 3. Versioning ------------------------------------------------------------
# ADR-006. Sin esto, una sobreescritura con la misma clave pierde la foto
# anterior de forma definitiva.
mc version enable "root/$S3_BUCKET"

# --- 4. La política: PutObject y GetObject, y NADA MÁS ------------------------
# No lleva `s3:DeleteObject` ni `s3:DeleteObjectVersion`, y esa ausencia es
# deliberada: ver el encabezado y la sección 8 del documento 05.
# Tampoco lleva `s3:ListBucket`: la API firma claves que ella misma derivó
# (apps/api/src/uploads/object-storage.ts) y nunca necesita enumerar el bucket.
cat > /tmp/uploads-policy.json <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": ["arn:aws:s3:::$S3_BUCKET/*"]
    }
  ]
}
POLICY

mc admin policy create root "$POLICY_NAME" /tmp/uploads-policy.json
rm -f /tmp/uploads-policy.json

# --- 5. La credencial limitada ------------------------------------------------
# `mc admin user add` sobre un usuario que ya existe reescribe su secreto con el
# valor de .env.prod, que es lo que se quiere: ese archivo es la fuente de verdad.
mc admin user add root "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"
mc admin user enable root "$S3_ACCESS_KEY_ID"
mc admin policy attach root "$POLICY_NAME" --user "$S3_ACCESS_KEY_ID" 2>/dev/null \
  || echo "storage-init: la política $POLICY_NAME ya estaba adjunta"

# --- 6. CORS ------------------------------------------------------------------
# El teléfono hace el PUT DIRECTO al bucket (apps/web/src/offline/photos.ts), así
# que el navegador manda un preflight OPTIONS antes. MinIO community NO implementa
# PutBucketCors —`mc cors set` devuelve NotImplemented— y lo único que existe es
# esta clave de servidor, que filtra POR ORIGEN. Su default es `*`.
# Un solo origen: el de la PWA. El cambio es dinámico, sin reiniciar el servidor.
mc admin config set root api cors_allow_origin="$WEB_ORIGIN"

# --- 7. Qué quedó -------------------------------------------------------------
echo "storage-init: bucket $S3_BUCKET listo"
mc version info "root/$S3_BUCKET"
mc admin policy entities root --user "$S3_ACCESS_KEY_ID"
echo "storage-init: CORS restringido a $WEB_ORIGIN"
echo "storage-init: la credencial NO tiene DeleteObject (ADR-006)"
EOF

chmod +x db/minio/bucket.sh
```

**Cómo sé que salió bien.** Tres comprobaciones distintas del propio `cat`: sintaxis, que
no haya ningún permiso de borrado en la política, y que no haya credenciales literales.

```bash
sh -n db/minio/bucket.sh && echo "sintaxis ok"

grep -n '"s3:Delete' db/minio/bucket.sh \
  && echo "FALLÓ: la política permite borrar" || echo "sin permisos de borrado"

grep -nE "minioadmin|hs_uploads_dev|hs-platform-dev" db/minio/bucket.sh \
  && echo "FALLÓ: credencial o bucket de desarrollo" || echo "sin literales de desarrollo"
```

### Paso 2 — Copiarlo al VPS

El `03`, Paso 6, ya copia `db/minio` si el directorio existe. Si en ese momento todavía no
estaba —que es el orden normal de estos documentos—, este es el momento.

```bash
scp -r db/minio <USUARIO>@<HOST_VPS>:/srv/hs-platform/db/
```

**Cómo sé que salió bien.** El archivo está donde el compose lo monta:

```bash
ssh <USUARIO>@<HOST_VPS> 'ls -l /srv/hs-platform/db/minio/bucket.sh'
```

### Paso 3 — Correr `storage-init`

En el VPS. Sin `-d`, para ver la salida: este servicio corre una vez y sale.

```bash
cd /srv/hs-platform
docker compose --env-file .env.prod -f compose.prod.yml up storage-init
```

La salida esperada, en este orden:

```
Bucket created successfully `root/<S3_BUCKET>`.
root/<S3_BUCKET> versioning is enabled
Created policy `hs-uploads` successfully.
Added user `<S3_ACCESS_KEY_ID>` successfully.
Enabled user `<S3_ACCESS_KEY_ID>` successfully.
Attached Policies: [hs-uploads]
To User: <S3_ACCESS_KEY_ID>
Successfully applied new settings.
storage-init: bucket <S3_BUCKET> listo
...
storage-init: CORS restringido a https://app.<DOMINIO>
storage-init: la credencial NO tiene DeleteObject (ADR-006)
```

`Bucket created successfully` aparece también cuando el bucket ya existía: `--ignore-existing`
lo imprime igual. No es señal de que se haya rehecho nada.

**Cómo sé que salió bien.** El contenedor salió con código 0:

```bash
docker compose --env-file .env.prod -f compose.prod.yml ps -a storage-init
```

Tiene que decir `Exited (0)`. Cualquier otro código es un bootstrap a medias: leé la salida
del comando anterior antes de seguir.

### Paso 4 — El versioning, comprobado con dos PUT de la misma clave

Que `mc version info` diga `enabled` es la configuración. Esto es el comportamiento.

Todos los comandos `mc` de acá en adelante corren dentro de un contenedor descartable del
servicio `storage-init`, que es el único que tiene las credenciales en el entorno. Los
`$` van **dentro de comillas simples** a propósito: los expande el contenedor, no el VPS,
y así ningún secreto aparece en la línea de comando ni en el historial.

```bash
docker compose --env-file .env.prod -f compose.prod.yml run --rm -T \
  --entrypoint sh storage-init -c '
    mc alias set app http://storage:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null
    mc alias set root http://storage:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
    echo uno > /tmp/v.txt
    mc put --quiet /tmp/v.txt "app/$S3_BUCKET/verificacion/versioning.txt"
    echo dos > /tmp/v.txt
    mc put --quiet /tmp/v.txt "app/$S3_BUCKET/verificacion/versioning.txt"
    mc ls --versions "root/$S3_BUCKET/verificacion/versioning.txt"
  '
```

**Cómo sé que salió bien.** La última línea lista **dos** versiones, `v1` y `v2`, con dos
`VersionID` distintos:

```
[...] 4B STANDARD c06b70e0-... v2 PUT versioning.txt
[...] 4B STANDARD bb76f48e-... v1 PUT versioning.txt
```

Una sola fila significa que el versioning no quedó activado y que la segunda subida se
llevó puesta la primera. Pará: esa es exactamente la pérdida que ADR-006 no permite.

> **El prefijo `verificacion/` no es casual.** La credencial no puede borrar, así que lo
> que esta verificación escribe se queda en el bucket para siempre. Las claves reales que
> deriva el servidor empiezan con un UUID de sitio (`{site_id}/...`), así que `verificacion/`
> no puede colisionar con ninguna y se distingue de un vistazo. Son unos pocos bytes: ver
> la sección 8.

### Paso 5 — La credencial no puede borrar, y tampoco listar

```bash
docker compose --env-file .env.prod -f compose.prod.yml run --rm -T \
  --entrypoint sh storage-init -c '
    mc alias set app http://storage:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null
    mc rm "app/$S3_BUCKET/verificacion/versioning.txt"
  ' && echo "FALLÓ: la credencial puede borrar" || echo "correcto: sin DeleteObject"
```

El comando de adentro tiene que fallar con `Access Denied`, y el `echo` de la derecha tiene
que ser el segundo. Un borrado exitoso acá es la falla más grave que este documento puede
producir: significa que la evidencia de un hallazgo se puede perder desde la aplicación.

Lo mismo con el listado, que tampoco está en la política:

```bash
docker compose --env-file .env.prod -f compose.prod.yml run --rm -T \
  --entrypoint sh storage-init -c '
    mc alias set app http://storage:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null
    mc ls "app/$S3_BUCKET/"
  ' && echo "FALLÓ: la credencial puede listar" || echo "correcto: sin ListBucket"
```

### Paso 6 — CORS, comprobado con el preflight real

**Desde tu máquina**, no desde el VPS: lo que importa es lo que contesta el bucket a través
de Caddy, con el origen que manda el navegador del inspector.

El teléfono hace `fetch(url, { method: 'PUT', headers: { 'content-type': ... }, body: blob })`
directo contra el bucket (`apps/web/src/offline/photos.ts`, `defaultPut`). `PUT` no es un
método simple y `image/jpeg` no es un `content-type` de los que el navegador deja pasar sin
preguntar, así que **siempre** hay un `OPTIONS` antes. Si ese `OPTIONS` no vuelve con el
origen permitido, el PUT ni se intenta y la aplicación nunca ve un código HTTP.

```bash
curl -s -i -X OPTIONS "https://s3.<DOMINIO>/<S3_BUCKET>/verificacion/preflight" \
  -H "Origin: https://app.<DOMINIO>" \
  -H "Access-Control-Request-Method: PUT" \
  -H "Access-Control-Request-Headers: content-type"
```

Esperado: `204 No Content` con estas tres cabeceras.

```
Access-Control-Allow-Origin: https://app.<DOMINIO>
Access-Control-Allow-Methods: PUT
Access-Control-Allow-Headers: content-type
```

**Cómo sé que salió bien.** La comprobación no es que el permitido pase —el default `*`
también lo dejaba pasar— sino que **cualquier otro origen no**:

```bash
curl -s -i -X OPTIONS "https://s3.<DOMINIO>/<S3_BUCKET>/verificacion/preflight" \
  -H "Origin: https://malicioso.example" \
  -H "Access-Control-Request-Method: PUT" \
  | grep -i "access-control-allow-origin" \
  && echo "FALLÓ: CORS acepta cualquier origen" || echo "correcto: solo el origen de la PWA"
```

El origen ajeno también recibe `204`, pero **sin** `Access-Control-Allow-Origin`, y eso es
lo que el navegador lee como «no». Mirar el código de estado no alcanza.

> **Dos cosas que conviene saber de cómo MinIO contesta esto**, las dos comprobadas contra
> `RELEASE.2025-04-22T22-12-26Z`:
>
> 1. **Filtra por origen y nada más.** El método y los headers del preflight los devuelve
>    tal como se los pidieron: pedir `DELETE` y un header inventado devuelve
>    `Access-Control-Allow-Methods: DELETE` y ese header. No existe una lista de métodos
>    permitidos que configurar. Que `PUT` y `content-type` estén permitidos es cierto, pero
>    no es algo que se configure: es consecuencia de que el origen esté permitido. Lo que
>    sí decide si el PUT escribe algo es la política del Paso 5, no CORS.
> 2. **La respuesta no dice nada del bucket ni de la credencial.** El preflight se contesta
>    antes de autorizar: una ruta hacia un bucket inexistente devuelve lo mismo. Un
>    preflight correcto no prueba que el bucket esté bien; eso lo prueban los pasos 4 y 5.

### Paso 7 — Lo que NO puede pasar: el bucket está en internet

`s3.<DOMINIO>` es público por necesidad —el teléfono sube ahí directo— así que lo que hay
que comprobar es que ser público no sea ser abierto. **Desde tu máquina**, las cuatro:

```bash
# 1. El proxy llega al puerto S3 (y solo a ese): el servidor responde su sonda de vida.
curl -s -o /dev/null -w 'salud: %{http_code}\n' "https://s3.<DOMINIO>/minio/health/live"

# 2. El listado anónimo del bucket: 403.
curl -s -o /dev/null -w 'listado bucket: %{http_code}\n' "https://s3.<DOMINIO>/<S3_BUCKET>/"

# 3. El listado anónimo de buckets: 403.
curl -s -o /dev/null -w 'listado raíz:  %{http_code}\n' "https://s3.<DOMINIO>/"

# 4. Un GET anónimo a un objeto que existe: 403. El acceso es por URL firmada,
#    nunca por bucket público.
curl -s -o /dev/null -w 'objeto:        %{http_code}\n' \
  "https://s3.<DOMINIO>/<S3_BUCKET>/verificacion/versioning.txt"
```

Esperado: `200`, `403`, `403`, `403`. El cuerpo de los tres 403 es un XML con
`<Code>AccessDenied</Code>`; se puede ver con `curl -s ... | head -c 200`.

Y la consola de MinIO, que el `03` dejó sin bloque en el Caddyfile a propósito:

```bash
# El puerto no está publicado.
nc -z -w3 <IP_VPS> 9001 && echo "FALLÓ: consola expuesta" || echo "9001 cerrado"

# Y no hay ningún bloque que la proxee.
ssh <USUARIO>@<HOST_VPS> 'grep -n "9001" /srv/hs-platform/Caddyfile' \
  && echo "FALLÓ: la consola tiene bloque" || echo "sin bloque de consola"
```

### Paso 8 — La firma, el `Host` y el proxy

Esta es la verificación más fuerte que se puede hacer **sin una sesión**: una subida
firmada que sale del VPS, sube por internet a `https://s3.<DOMINIO>`, atraviesa Caddy y
vuelve. Si Caddy no preservara el `Host`, fallaría acá.

```bash
docker compose --env-file .env.prod -f compose.prod.yml run --rm -T \
  --entrypoint sh storage-init -c '
    mc alias set publico "https://s3.<DOMINIO>" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"
    echo prueba > /tmp/p.txt
    mc put --quiet /tmp/p.txt "publico/$S3_BUCKET/verificacion/host.txt"
    mc share download --expire 5m "publico/$S3_BUCKET/verificacion/host.txt"
  '
```

Tanto `mc alias set` como `mc put` firman con SigV4 y mandan `Host: s3.<DOMINIO>`. Si los
dos pasan, el `header_up Host {host}` del `03` está haciendo su trabajo.

**Cómo sé que salió bien.** `mc share download` imprime una URL firmada. Copiala y pedila
**desde tu máquina**, sin credenciales:

```bash
curl -s -o /dev/null -w 'firmada:   %{http_code}\n' "<URL_FIRMADA>"
curl -s -o /dev/null -w 'sin firma: %{http_code}\n' \
  "https://s3.<DOMINIO>/<S3_BUCKET>/verificacion/host.txt"
```

`200` la primera, `403` la segunda. Eso es exactamente el contrato de ADR-006: se entra con
una URL firmada y de ninguna otra forma.

#### Por qué el `Host` decide la firma

La firma SigV4 cubre una lista de cabeceras que viaja en la propia URL, en
`X-Amz-SignedHeaders`. Una URL firmada por `apps/api/src/uploads/object-storage.ts` lleva:

```
X-Amz-SignedHeaders=content-length%3Bhost
```

`host` está ahí. El servidor recalcula la firma con el `Host` **del request que le llega**:
si el proxy lo reescribe al nombre interno (`storage:9000`), lo que calcula no es lo que se
firmó, y contesta `403 SignatureDoesNotMatch`. Por eso el bloque `s3.` del Caddyfile tiene
`header_up Host {host}` y no el comportamiento por default.

Probado de los dos lados contra esta versión de MinIO: mismo objeto, misma URL firmada, con
el `Host` original `200`, con el `Host` reescrito `403 SignatureDoesNotMatch`.

### Paso 9 — La verificación de punta a punta queda para el `09`

`POST /uploads/presign` exige una inspección **activa y dentro del alcance de quien pide**
(`apps/api/src/uploads/uploads.service.ts`), y `POST /uploads/presign/finding` exige una
planta con catálogo de ubicaciones. Las dos exigen una sesión, y la primera cuenta con
sesión es del `09`.

Acá queda escrito el procedimiento; **lo ejecuta el `09`** y este documento se lo pide en
la sección 7. El camino más barato es el de hallazgo manual, que no necesita que haya un
período abierto:

```bash
# 1. Una sesión. El servidor devuelve tokens, no cookies.
TOKEN=$(curl -s -X POST "https://api.<DOMINIO>/auth/sign-in" \
  -H 'content-type: application/json' \
  -d '{"email":"<EMAIL_COORDINADOR>","password":"<CONTRASEÑA>"}' | jq -r '.tokens.accessToken')

# 2. Una foto de 10 bytes, y el presign con SU tamaño exacto.
printf '0123456789' > /tmp/foto.bin
URL=$(curl -s -X POST "https://api.<DOMINIO>/uploads/presign/finding" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"site_id":"<UUID_SITIO>","draft_finding_id":"'"$(uuidgen)"'","content_type":"image/jpeg","content_length":10}' \
  | jq -r '.url')

# 3. El PUT que hace el teléfono, con el mismo tamaño que se firmó.
curl -s -o /dev/null -w 'PUT: %{http_code}\n' -X PUT "$URL" \
  -H 'content-type: image/jpeg' --data-binary @/tmp/foto.bin
```

`200` en el PUT y el sistema está entero: la API firma, el bucket acepta, y el objeto queda
bajo `{site_id}/manual/{draft_finding_id}/{uuid}`.

---

## 4. Verificación

Un solo bloque, repetible dentro de un mes. Los tres primeros corren **en el VPS**, en
`/srv/hs-platform`; los tres últimos **desde tu máquina**.

```bash
# 1. Bucket, versioning y política, en una sola pasada.
docker compose --env-file .env.prod -f compose.prod.yml run --rm -T \
  --entrypoint sh storage-init -c '
    mc alias set root http://storage:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
    mc version info "root/$S3_BUCKET"
    mc admin policy info root hs-uploads
    mc admin policy entities root --user "$S3_ACCESS_KEY_ID"
    mc anonymous get "root/$S3_BUCKET"
    mc admin config get root api
  '
```

Esperado, en ese orden: `versioning is enabled`; un JSON con `"Action":["s3:GetObject","s3:PutObject"]`
y nada más; el usuario mapeado a `hs-uploads`; el permiso anónimo del bucket en `private`;
y en la última línea `cors_allow_origin=https://app.<DOMINIO>`.

```bash
# 2. La política no permite borrar. La comprobación es sobre el texto, no sobre la memoria.
docker compose --env-file .env.prod -f compose.prod.yml run --rm -T \
  --entrypoint sh storage-init -c '
    mc alias set root http://storage:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
    mc admin policy info root hs-uploads
  ' | grep -qi "delete" \
  && echo "FALLÓ: la política nombra un permiso de borrado" || echo "correcto: sin Delete*"
```

```bash
# 3. Y el borrado falla de verdad, que no es lo mismo que no estar escrito.
docker compose --env-file .env.prod -f compose.prod.yml run --rm -T \
  --entrypoint sh storage-init -c '
    mc alias set app http://storage:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null
    mc rm "app/$S3_BUCKET/verificacion/versioning.txt"
  ' && echo "FALLÓ: la credencial puede borrar" || echo "correcto: sin DeleteObject"
```

```bash
# 4. CORS: el origen de la PWA sí, cualquier otro no.
curl -s -i -X OPTIONS "https://s3.<DOMINIO>/<S3_BUCKET>/verificacion/preflight" \
  -H "Origin: https://app.<DOMINIO>" -H "Access-Control-Request-Method: PUT" \
  -H "Access-Control-Request-Headers: content-type" | grep -i "access-control-allow-"

curl -s -i -X OPTIONS "https://s3.<DOMINIO>/<S3_BUCKET>/verificacion/preflight" \
  -H "Origin: https://malicioso.example" -H "Access-Control-Request-Method: PUT" \
  | grep -i "access-control-allow-origin" \
  && echo "FALLÓ: CORS acepta cualquier origen" || echo "correcto: solo el origen de la PWA"
```

```bash
# 5. Nada anónimo, y el proxy llegando solo al puerto S3.
for p in "minio/health/live:200" "<S3_BUCKET>/:403" "/:403" "<S3_BUCKET>/verificacion/versioning.txt:403"; do
  ruta="${p%:*}"; esperado="${p##*:}"
  real=$(curl -s -o /dev/null -w '%{http_code}' "https://s3.<DOMINIO>/${ruta#/}")
  echo "$ruta -> $real (esperado $esperado)"
done
```

```bash
# 6. La consola sigue sin estar en internet.
nc -z -w3 <IP_VPS> 9001 && echo "FALLÓ: consola expuesta" || echo "9001 cerrado"
```

---

## 5. Criterios de hecho

- [ ] `db/minio/bucket.sh` existe, está commiteado y copiado a `/srv/hs-platform/db/minio/`
- [ ] El script no contiene ninguna credencial literal ni el bucket de desarrollo
- [ ] `storage-init` salió con código `0`
- [ ] Correrlo dos veces seguidas no cambia nada ni falla
- [ ] El bucket `<S3_BUCKET>` existe y `mc version info` dice `enabled`
- [ ] Dos PUT con la misma clave dejan **dos** versiones
- [ ] La política `hs-uploads` tiene exactamente `s3:PutObject` y `s3:GetObject` sobre `arn:aws:s3:::<S3_BUCKET>/*`
- [ ] La política **no** nombra ningún `Delete*` ni `ListBucket`
- [ ] Un `mc rm` con la credencial de la aplicación falla con `Access Denied` (probado, no asumido)
- [ ] La credencial está creada, habilitada y con la política adjunta
- [ ] `cors_allow_origin` vale el origen de la PWA y no `*`
- [ ] El preflight del origen de la PWA devuelve `Access-Control-Allow-Origin`; el de otro origen, no
- [ ] El listado anónimo del bucket devuelve `403`
- [ ] El GET anónimo a un objeto devuelve `403`
- [ ] Una URL firmada al mismo objeto devuelve `200`
- [ ] El puerto 9001 está cerrado desde afuera y no tiene bloque en el `Caddyfile`
- [ ] Un `mc put` contra `https://s3.<DOMINIO>` pasa: el `Host` sobrevive al proxy

---

## 6. Si falla

### El árbol de los 403

El bucket contesta `403` por cinco razones distintas y el cuerpo XML las separa. **Leé el
cuerpo**: `curl -s ... | head -c 300`. Sin eso, los cinco casos parecen «un problema de
credenciales» y solo uno lo es.

| `<Code>` en el cuerpo | Qué pasó | Qué hacer |
| --- | --- | --- |
| `SignatureDoesNotMatch` | El servidor recalculó la firma y le dio otra cosa. Cuatro causas: **el `Host` reescrito por el proxy**, **el tamaño del cuerpo distinto del firmado**, el secreto distinto entre el servicio `api` y el que creó la credencial, o el reloj del VPS corrido | Ver el desglose de abajo |
| `AccessDenied` con `<Message>Request has expired` | La URL firmada venció. `S3_UPLOAD_TTL_SECONDS` vale 300 | No es un error de configuración: el dispositivo tiene que pedir otro presign. Si pasa siempre, el reloj está corrido |
| `AccessDenied` sin `expired` | La política. La operación no está permitida —un `DELETE`, un listado— o la clave cae fuera de `arn:aws:s3:::<S3_BUCKET>/*` | Si era un borrado, **es correcto y no se arregla**: ver la sección 8 |
| `InvalidAccessKeyId` | El `S3_ACCESS_KEY_ID` que usa el servicio `api` no existe en MinIO | `.env.prod` cambió después de correr `storage-init`, o se corrió con otro valor. Volvé a correr el Paso 3: el script reescribe usuario y secreto |
| Sin cuerpo y sin código HTTP en la aplicación | **No es un 403: es CORS.** Ver abajo |

### Cómo separar las cuatro causas de `SignatureDoesNotMatch`

Las cuatro dan el mismo código. El orden barato de descarte:

1. **El `Host`.** Corré el Paso 8: un `mc put` contra `https://s3.<DOMINIO>`. Si ese falla,
   es el proxy y no la firma; verificá `header_up Host {host}` en el bloque `s3.` del
   Caddyfile (es del `03`).
2. **El tamaño.** `PutObjectCommand` se firma con `ContentLength`, y `content-length` está
   en `X-Amz-SignedHeaders`. El PUT tiene que llegar con **exactamente** ese tamaño: un byte
   de más o de menos da `403`. Es deliberado —impide que un dispositivo declare 1 MB y suba
   500— y se comprueba comparando el `content_length` que se pidió en el presign con el
   `Content-Length` del PUT. Probado: 10 bytes firmados y 11 enviados dan
   `403 SignatureDoesNotMatch`.
3. **El secreto.** Si el Paso 8 pasa pero la API falla, la pareja del servicio `api` y la de
   `storage-init` no son la misma. Las dos salen de `.env.prod`; el Paso 3 vuelve a alinearlas.
4. **El reloj.** `timedatectl show -p NTPSynchronized --value` tiene que decir `yes` (es
   precondición del `03`).

> **El `content-type` no está firmado, aunque se pase al firmar.** Con
> `@aws-sdk/s3-request-presigner` 3.1106.0 —la versión de `apps/api`— la URL firmada lleva
> `X-Amz-SignedHeaders=content-length;host` y nada más: el `ContentType` del
> `PutObjectCommand` **no** entra en la firma. Se comprobó: un PUT con el tamaño exacto y un
> `content-type` distinto del firmado, o sin ese header, devuelve `200`, y el objeto queda
> con el tipo que mandó el cliente.
>
> Consecuencias prácticas: un `content-type` mal puesto **no** es la causa de un 403 —no
> gastes tiempo ahí— pero el header igual importa, porque es lo que hace que el navegador
> pida preflight y es lo que queda como metadato del objeto.

### CORS no produce un 403; produce un error sin número

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| En el teléfono la foto queda en `Upload failed — will retry` y en las herramientas del navegador se ve el `OPTIONS` pero **ningún `PUT`** | CORS. El navegador cortó antes de enviar. La aplicación nunca recibe un código: `fetch` rechaza y `photos.ts` guarda `Failed to fetch` en `last_error` de esa foto | Paso 6. Compará byte a byte `cors_allow_origin` con el origen de la PWA: sin barra final, con `https://` |
| El preflight vuelve con `Access-Control-Allow-Origin: *` o con cualquier origen | `storage-init` no llegó a la parte de CORS, o alguien agregó `MINIO_API_CORS_ALLOW_ORIGIN` al servicio `storage` | Si es lo segundo: **el env var le gana al `mc admin config set` en tiempo de ejecución, aunque `mc admin config get` muestre el valor nuevo y el `set` diga `Successfully applied`.** Comprobado. Sacalo del compose (es del `03`) y volvé a correr el Paso 3 |
| `mc cors set` devuelve `A header you provided implies functionality that is not implemented` | Se intentó configurar CORS por bucket | MinIO community no implementa `PutBucketCors`. Es `mc admin config set root api cors_allow_origin=...`, que es lo que hace el script |

### El resto

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| `storage-init: faltan variables de entorno: ...` y sale con `1` | Falta una de las seis en `.env.prod`, o no se pasó `--env-file` | El mensaje las nombra todas de una vez. Es la comprobación del script, antes de tocar el servidor |
| `storage-init: no se pudo conectar a http://storage:9000` | `storage` no está sano | `docker compose ps storage`. El script reintenta diez veces con un segundo de espera |
| El bucket queda creado pero sin versioning | El script se interrumpió entre el paso 2 y el 3 | Volvé a correr el Paso 3: es idempotente. **Si ya hubo subidas entre medio, esas versiones no existen y no se recuperan** |
| El PUT de una foto grande muere con `413` o se corta | El límite de cuerpo del bloque `s3.` | `MAX_UPLOAD_BYTES` de `@hs/contracts` son 25 MiB y el `03` puso `max_size 30MB`. Si se cambió, es del `03` |
| El objeto se subió pero pesa `0 B` | El cliente mandó `Content-Length: 0` con cuerpo vacío y se firmó así | No es de este documento: es del dispositivo. La firma acepta cualquier tamaño **declarado**, siempre que el cuerpo coincida |

**Punto de retroceso.** Mientras no haya una sola foto real —es decir, hasta el `09`— el
bucket entero se puede rehacer: `mc rb --force` con las credenciales raíz y volver a correr
el Paso 3. **Ese margen se termina cuando entra la primera inspección con fotos.** A partir
de ahí no hay forma de rehacer el bucket sin destruir evidencia, y la única red es el `08`.

---

## 7. Lo que este documento le pide a otro

| Documento | Qué necesita |
| --- | --- |
| `03-infraestructura.md` | **Ya cumplido, no lo toques:** `header_up Host {host}` en el bloque `s3.`, `max_size 30MB`, el servicio `storage-init` con sus seis variables y el montaje de `./db/minio:/init:ro`, y la consola sin bloque en el Caddyfile |
| `03-infraestructura.md` | **No agregar `MINIO_API_CORS_ALLOW_ORIGIN` al servicio `storage`.** Si esa variable existe en el entorno del servidor, le gana a lo que configura `storage-init` en tiempo de ejecución **sin que nada falle ni avise**: `mc admin config set` responde `Successfully applied` y `mc admin config get` muestra el valor nuevo, pero el preflight contesta con el del entorno. Comprobado contra `RELEASE.2025-04-22T22-12-26Z` |
| `03-infraestructura.md` | **Corrección del comentario de `MINIO_SERVER_URL`.** Dice: *«Sin esto, las URLs firmadas que emite la API se calculan sobre el host interno y no validan contra el que usa el teléfono»*. Eso no es así: la API arma sus URLs con `S3_ENDPOINT` (`apps/api/src/uploads/object-storage.ts` no conoce `MINIO_SERVER_URL`), y lo que hace que la firma valide es que Caddy preserve el `Host`. **La variable está bien puesta y conviene dejarla** —es el host público que MinIO usa para las URLs que genera él, como las de `mc share`— pero el comentario atribuye a esa línea un efecto que produce otra, y el día que alguien depure un 403 va a buscar donde no es |
| `07-entorno-y-release.md` | La credencial limitada es la pareja `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` de `.env.prod`. **El mismo par que consume el servicio `api` lo crea `storage-init`**: no son dos credenciales, es una. Cambiar el valor sin volver a correr `storage-init` da `InvalidAccessKeyId` en cada subida |
| `07-entorno-y-release.md` | `WEB_ORIGINS` (del servicio `api`) y `WEB_ORIGIN` (del servicio `storage-init`, derivado de `DOMINIO`) tienen que ser **el mismo origen**. Son dos nombres para la misma cosa en dos lugares distintos: si divergen, la API acepta al navegador y el bucket no, y el síntoma aparece recién al subir una foto |
| `09-puesta-en-marcha.md` | **Ejecutar la verificación de punta a punta del presign** en la sección 4: necesita una sesión, y la primera cuenta es tuya. Es la única prueba que recorre API, firma, Caddy, CORS y bucket de una sola vez |
| `09-puesta-en-marcha.md` | Antes de la primera inspección real, los objetos bajo `verificacion/` pueden quedar o irse (ver sección 8). Lo que **no** se puede es agregar `DeleteObject` a la política para sacarlos |
| `08-backups.md` | El volumen `storage-data` contiene la evidencia y **crece sin techo por diseño**: versioning activado más una credencial que no borra significa que cada sobreescritura suma una versión y ninguna se va. No hay política de expiración y no debe haberla |
| `10-operacion.md` | Qué mirar: el tamaño de `storage-data`, y que `storage-init` haya salido con `0` después de cada redeploy que lo vuelva a levantar |

---

## 8. Riesgos con datos reales

**Agregar `DeleteObject` "para limpiar".** Es el riesgo principal de este documento y el más
fácil de cometer con buena intención. La evidencia fotográfica es irreemplazable: una foto
**es** lo que respalda un hallazgo ante un regulador, y un hallazgo sin su foto no es un
hallazgo más débil, es un registro que no se sostiene. Esa foto no se puede volver a sacar:
la condición ya se corrigió, o la planta cambió, o pasaron seis meses. Por eso la credencial
no puede borrar **por diseño** (ADR-006), y por eso la ausencia está escrita en tres lugares
—la política, el comentario del script y este párrafo—. Un `s3:DeleteObject` agregado para
sacar un objeto de prueba deja el permiso puesto para siempre.

**Los objetos de verificación no se pueden borrar, y está bien.** Lo que escriben los pasos
4 y 8 bajo `verificacion/` son unos pocos bytes que la aplicación no puede sacar. Si
molestan, se borran **con las credenciales raíz y antes del `09`**, cuando el bucket todavía
no tiene nada real. Después del `09`, `mc rm` con la raíz es un comando que ninguna
verificación justifica: la forma de convivir con ellos es el prefijo, que los hace obvios.

**`mc rb --force` con las credenciales raíz.** Borra el bucket entero, versiones incluidas,
sin confirmación y sin deshacer. `MINIO_ROOT_PASSWORD` es la única llave del sistema que sí
puede destruir evidencia; no se usa para nada operativo y no tiene por qué salir de
`.env.prod`. Si hay que mirar el bucket, se mira con `mc ls`, no con la consola.

**Suspender el versioning.** `mc version suspend` no borra nada en el momento, pero desde ahí
cada sobreescritura con la misma clave pisa la anterior de forma definitiva. Las claves las
deriva el servidor con un UUID por foto, así que una colisión es improbable —no imposible: un
reintento con la misma clave es exactamente el caso que el versioning cubre.

**Cambiar `S3_ACCESS_KEY_ID` o `S3_SECRET_ACCESS_KEY` sin volver a correr `storage-init`.**
Todas las subidas empiezan a fallar con `403`, el inspector ve `Upload failed — will retry`
y los borradores se acumulan en el dispositivo. No se pierde nada —las fotos están guardadas
en el teléfono y se reintentan— pero el envío no se puede completar hasta que la credencial
vuelva a coincidir. Se corrige corriendo el Paso 3.

**La consola de MinIO publicada "un rato".** Da acceso con `MINIO_ROOT_PASSWORD` a todos los
objetos y a las operaciones que la aplicación no tiene, borrado incluido. El `03` ya lo
declara; se repite acá porque desde este documento se ve para qué serviría esa comodidad.

---

## Referencias

- `docs/deployment/README.md` — contrato de nombres, grupos de variables, propiedad
- `docs/deployment/03-infraestructura.md` — dueño del compose y del Caddyfile; declara `storage-init`
- `docs/deployment/07-entorno-y-release.md` — dueño de los valores de las variables
- `docker-compose.yml` — el `storage-init` de desarrollo y su comentario, que este documento lleva a producción
- `apps/api/src/uploads/object-storage.ts` — qué se firma, cómo se deriva la clave y qué comandos usa la API (`PutObject` y `GetObject`, ninguno más)
- `apps/api/src/uploads/uploads.service.ts` — por qué el presign necesita una sesión y una inspección del alcance
- `apps/web/src/offline/photos.ts` — el PUT directo al bucket y dónde queda el error de una foto
- `packages/contracts/src/submissions.ts` — `MAX_UPLOAD_BYTES` (25 MiB) y los dos `content-type` aceptados
- ADR-006 — versioning, presigned URL y por qué no hay ruta de borrado desde la aplicación
- ADR-001 — las fotos suben antes del envío, y el envío referencia claves, no bytes
