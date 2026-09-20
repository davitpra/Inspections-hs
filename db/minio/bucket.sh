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
