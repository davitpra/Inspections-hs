# 08 — Backups y restauración

**Qué resuelve.** Instala un backup lógico diario de Postgres en Backblaze B2 mediante
`restic`, conserva los roles globales y `.env.prod`, protege las versiones de MinIO y deja
una restauración aislada repetible.

**Qué NO resuelve.** No elige el proveedor de snapshots del VPS, no modifica
`compose.prod.yml`, no restaura sobre producción y no sustituye una restauración ensayada
por una lista de archivos.

**Estado al entrar.** `03`–`07` están ejecutados, la base y MinIO están operativos y todavía
no hay roster completo ni evidencia de inspecciones reales.

**Estado al salir.** El repositorio cifrado de `restic` está fuera del VPS, el timer diario
está activo, existe un snapshot del proveedor documentado y una restauración aislada fue
verificada. Solo entonces puede comenzar `09`.

**Artefactos que este documento crea o modifica.**

- `/usr/local/sbin/hs-platform-backup` — script del VPS, dueño de este documento
- `/etc/hs-platform/restic.env` — credenciales de B2 y configuración de `restic`, permisos `600`
- `/etc/systemd/system/hs-platform-backup.service` — unidad one-shot
- `/etc/systemd/system/hs-platform-backup.timer` — ejecución diaria
- El repositorio de Backblaze B2 elegido para esta instalación
- El registro de restauraciones y manifiestos fuera del VPS

---

## 1. Precondiciones

### 1.1 Backblaze B2 está elegido y separado del VPS

La cuenta, el bucket y la aplicación de B2 tienen que estar creados antes de continuar. La
clave debe limitarse al bucket y al prefijo de este repositorio; no se usa la cuenta raíz.

```bash
restic version
test -x /usr/local/sbin/hs-platform-backup && echo "backup instalado" || echo "backup pendiente"
```

La primera salida identifica una versión de `restic`; la segunda debe decir `backup pendiente`
antes del Paso 3.

### 1.2 La clave de cifrado tiene custodia fuera del VPS

La contraseña del repositorio no puede vivir solo en `/etc/hs-platform/restic.env`. Debe
existir una copia en el gestor de secretos elegido por el responsable de operación. Sin ella,
B2 contiene datos cifrados que no se pueden restaurar.

### 1.3 El proveedor de snapshots está decidido

Este documento no puede inventar el CLI de un proveedor que todavía no fue elegido. Antes de
`09` tiene que existir un procedimiento del proveedor para capturar `db-data`, `storage-data`,
`caddy-data`, `caddy-config` y `/srv/hs-platform/.env.prod`, con un identificador verificable.

```bash
test -f /srv/hs-platform/.env.prod && stat -c '%a %n' /srv/hs-platform/.env.prod
docker compose --env-file .env.prod -f compose.prod.yml ps db storage
```

La primera salida debe ser `600 /srv/hs-platform/.env.prod`; `db` y `storage` deben estar

### 1.4 Hay espacio para el temporal

```bash
df -h /srv/hs-platform
df -i /srv/hs-platform
```

Debe haber espacio suficiente para un dump, su manifiesto y el margen de crecimiento del
volumen de objetos. Si no se conoce el tamaño actual, no se empieza: `df` no puede ser una
estimación hecha después del fallo.

---

## 2. Decisiones ya tomadas

| # | Decisión | Por qué |
| --- | --- | --- |
| D1 | El destino lógico es Backblaze B2 mediante `restic` | Es externo al VPS y cifra antes de enviar |
| D2 | El dump corre una vez al día | El RPO operativo es el intervalo entre dos dumps exitosos |
| D3 | La retención es 14 diarios, 8 semanales y 12 mensuales | Conserva capacidad de investigar cambios recientes y cierres mensuales |
| D4 | El repositorio incluye `pg_dump`, roles globales, `.env.prod` y el volumen de MinIO | Restaurar solo tablas no devuelve credenciales ni evidencia fotográfica |
| D5 | El volumen de MinIO se respalda con `storage` detenido | Evita copiar una mutación parcial del backend mientras se preservan todas las versiones |
| D6 | El backup se cifra con `restic` y la contraseña se custodia fuera del VPS | El VPS no debe ser el único lugar donde exista la clave de recuperación |
| D7 | La restauración se ejecuta trimestralmente y después de cambiar este procedimiento | Un archivo existente no demuestra que se pueda recuperar el sistema |
| D8 | Los snapshots del proveedor son una segunda capa, no sustituyen a B2 | Un snapshot del mismo proveedor no cubre todos los modos de pérdida |

---

## 3. Pasos

### Paso 1 — Preparar las credenciales de B2 y `restic`

En un VPS Debian 12 o Ubuntu 24.04, instalar `restic` desde los paquetes del sistema y
confirmar que el binario quedó disponible:

```bash
sudo apt-get update
sudo apt-get install -y restic
restic version
```

Si el paquete no incluye el backend B2, no se sustituye silenciosamente por otro binario:
instalar la versión oficial de `restic`, verificar su checksum y registrar la versión en el
manifiesto.

En el VPS, crear el archivo de entorno sin imprimir sus valores:

```bash
sudo install -d -m 700 /etc/hs-platform
sudo install -m 600 /dev/null /etc/hs-platform/restic-password
sudo install -m 600 /dev/null /etc/hs-platform/restic.env
sudo sh -c 'cut -d= -f1 /etc/hs-platform/restic.env | sort'
```

El archivo debe contener exactamente estos nombres:

```text
B2_ACCOUNT_ID
B2_ACCOUNT_KEY
RESTIC_REPOSITORY
RESTIC_PASSWORD_FILE
```

`RESTIC_PASSWORD_FILE` apunta a `/etc/hs-platform/restic-password`, cuya copia de recuperación
está fuera del VPS. No se usa `RESTIC_PASSWORD` en la línea de comandos ni en los logs.

### Paso 2 — Inicializar y verificar el repositorio remoto

```bash
sudo sh -c 'set -a; . /etc/hs-platform/restic.env; set +a; restic init'
sudo sh -c 'set -a; . /etc/hs-platform/restic.env; set +a; restic snapshots'
```

El primer comando solo se ejecuta una vez y crea el repositorio en B2. El segundo debe poder
leerlo sin mostrar la contraseña. Si el repositorio ya tiene snapshots, se detiene el
procedimiento y se identifica su dueño; nunca se inicializa otro encima.

### Paso 3 — Crear el script de backup

El script debe:

1. usar un `flock` para impedir dos ejecuciones simultáneas;
2. comprobar que `db` y `storage` existen;
3. generar `pg_dump` en formato custom y `pg_dumpall --roles-only`;
4. detener `api` y `storage` antes de leer `storage-data`;
5. crear un manifiesto sin secretos;
6. subir todo al repositorio cifrado;
7. aplicar la retención;
8. arrancar de nuevo `storage` y `api` incluso si el backup falla.

Crear el archivo como root:

```bash
sudo install -o root -g root -m 700 /dev/null /usr/local/sbin/hs-platform-backup
```

El contenido obligatorio del script es este flujo. El archivo final no debe contener valores
de B2 ni contraseñas:

```sh
#!/bin/sh
set -eu

exec 9>/run/lock/hs-platform-backup.lock
flock -n 9 || { printf '%s\n' 'backup ya en ejecución' >&2; exit 1; }

cd /srv/hs-platform
DC='docker compose --env-file .env.prod -f compose.prod.yml'
RUN_ID=$(date -u +%Y%m%dT%H%M%SZ)
WORK="/srv/hs-platform/backup/work/$RUN_ID"
ENV_FILE=/srv/hs-platform/.env.prod
mkdir -p "$WORK"
chmod 700 "$WORK"

cleanup() {
  $DC start storage api >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

$DC exec -T db pg_dump -U hs_migrator -d hs_platform -Fc > "$WORK/hs_platform.dump"
$DC exec -T db pg_dumpall -U postgres --roles-only > "$WORK/global-roles.sql"

$DC stop api storage >/dev/null
STORAGE_VOLUME=$($DC config --volumes | awk '$1 == "storage-data" { print $1 }')
STORAGE_MOUNT=$(docker volume inspect -f '{{.Mountpoint}}' "$STORAGE_VOLUME")

{
  printf 'run_id=%s\n' "$RUN_ID"
  printf 'created_at=%s\n' "$RUN_ID"
  printf 'api_tag='; awk -F= '$1 == "API_TAG" { print $2 }' "$ENV_FILE"
  printf 'database_dump_sha256='; sha256sum "$WORK/hs_platform.dump" | cut -d' ' -f1
  printf 'roles_dump_sha256='; sha256sum "$WORK/global-roles.sql" | cut -d' ' -f1
  printf 'storage_volume=%s\n' "$STORAGE_VOLUME"
  printf 'storage_mount=%s\n' "$STORAGE_MOUNT"
} > "$WORK/manifest.txt"

set -a
. /etc/hs-platform/restic.env
set +a
restic backup --tag hs-platform --tag "$RUN_ID" \
  "$WORK" "$ENV_FILE" "$STORAGE_MOUNT"
restic forget --tag hs-platform --keep-daily 14 --keep-weekly 8 \
  --keep-monthly 12 --prune
restic check
```

El script termina con error si `pg_dump`, la transferencia, la retención o `restic check`
fallan. El `trap` intenta volver a levantar los servicios, pero una recuperación de error no
se considera exitosa hasta comprobar `docker compose ps`.

### Paso 4 — Instalar el timer diario

Crear la unidad y el timer:

```bash
sudo tee /etc/systemd/system/hs-platform-backup.service >/dev/null <<'EOF'
[Unit]
Description=Backup cifrado de hs-platform
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/hs-platform-backup
TimeoutStartSec=2h
EOF

sudo tee /etc/systemd/system/hs-platform-backup.timer >/dev/null <<'EOF'
[Unit]
Description=Backup diario de hs-platform

[Timer]
OnCalendar=*-*-* 01:30:00 America/Toronto
Persistent=true
RandomizedDelaySec=15m
Unit=hs-platform-backup.service

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now hs-platform-backup.timer
sudo systemctl list-timers hs-platform-backup.timer
```

La unidad debe ejecutar `/usr/local/sbin/hs-platform-backup` como root, con
`OnCalendar` diario y `Persistent=true`. La ventana se elige fuera de las 03:00 y 04:00 de
Ontario para no competir con pg-boss. El timer debe tener `RandomizedDelaySec` documentado si
se usa; la hora efectiva se registra en el manifiesto.

### Paso 5 — Ejecutar el primer backup y registrar el snapshot

```bash
sudo systemctl start hs-platform-backup.service
sudo systemctl status --no-pager hs-platform-backup.service
sudo journalctl -u hs-platform-backup.service --since '15 minutes ago' --no-pager
sudo sh -c 'set -a; . /etc/hs-platform/restic.env; set +a; restic snapshots --tag hs-platform'
docker compose --env-file .env.prod -f compose.prod.yml ps api db storage
```

Debe existir un snapshot nuevo, el servicio debe terminar con código `0` y `api`, `db` y
`storage` deben estar sanos. Registrar el ID del snapshot y el tamaño, nunca la contraseña.

Después ejecutar el snapshot del proveedor elegido. El comando depende del proveedor y queda
como precondición de `09`: registrar aquí el identificador, la hora UTC y los volúmenes
incluidos. Si el proveedor solo ofrece snapshot de máquina, debe quedar escrito que cubre los
cuatro volúmenes y `.env.prod`.

### Paso 6 — Restaurar Postgres en una copia aislada

Esta operación no usa `compose.prod.yml`, no publica puertos y no detiene los contenedores de
producción. Primero restaurar el último snapshot de `restic` a un directorio temporal:

```bash
RESTORE_ID=<ID_DEL_SNAPSHOT>
RESTORE_ROOT=/srv/hs-platform/backup/restore/<RESTORE_ID>
sudo install -d -m 700 "$RESTORE_ROOT"
sudo env RESTIC_RESTORE_ID="$RESTORE_ID" RESTORE_ROOT="$RESTORE_ROOT" sh -c \
  'set -a; . /etc/hs-platform/restic.env; set +a; restic restore "$RESTIC_RESTORE_ID" --target "$RESTORE_ROOT"'
sudo chown -R "$(id -u):$(id -g)" "$RESTORE_ROOT"
```

Crear un Postgres temporal sin publicar puertos y cargar primero los roles:

```bash
docker volume create hs-platform-restore-db
docker run -d --name hs-platform-restore-db \
  --env-file "$RESTORE_ROOT/srv/hs-platform/.env.prod" \
  -e POSTGRES_DB=hs_platform \
  -v hs-platform-restore-db:/var/lib/postgresql/data \
  postgres:17

until docker exec hs-platform-restore-db pg_isready -U postgres -d hs_platform; do sleep 1; done
docker exec -i hs-platform-restore-db psql -U postgres -d postgres \
  < "$RESTORE_ROOT/srv/hs-platform/backup/work/<RUN_ID>/global-roles.sql"
docker exec hs-platform-restore-db pg_restore -U postgres -d hs_platform --exit-on-error \
  < "$RESTORE_ROOT/srv/hs-platform/backup/work/<RUN_ID>/hs_platform.dump"
```

El path real del `RUN_ID` se obtiene del `manifest.txt` restaurado; no se adivina. Verificar
antes de destruir la copia:

```bash
docker run --rm -i postgres:17 pg_restore --list \
  < "$RESTORE_ROOT/srv/hs-platform/backup/work/<RUN_ID>/hs_platform.dump" \
  | grep -E 'TABLE|TABLE DATA' | wc -l
docker exec hs-platform-restore-db psql -U postgres -d hs_platform -Atc \
  "select count(*) from site; select count(*) from information_schema.tables where table_schema = 'pgboss';"
docker exec hs-platform-restore-db psql -U postgres -d hs_platform -Atc \
  "select s.code, broken.* from site s cross join lateral hs_audit_verify_chain(s.id) broken;"
```

La primera salida tiene que ser mayor que `0`; demuestra que el archivo es un dump custom
legible antes de cargarlo. La segunda devuelve dos sitios y un número positivo de tablas de
`pgboss`; la tercera no devuelve filas.

Esperado: dos sitios, tablas de `pgboss` y cero filas para la verificación de cadena. Si el
dump se restaura pero los roles o la cadena fallan, el backup no está verificado.

### Paso 7 — Restaurar MinIO en una copia aislada

Crear un volumen temporal, copiar en él la ruta respaldada y arrancar MinIO sin puertos:

```bash
docker volume create hs-platform-restore-storage
RESTORE_STORAGE=$(docker volume inspect -f '{{.Mountpoint}}' hs-platform-restore-storage)
STORAGE_MOUNT=$(awk -F= '$1 == "storage_mount" { print $2 }' \
  "$RESTORE_ROOT/srv/hs-platform/backup/work/<RUN_ID>/manifest.txt")
sudo rsync -a "$RESTORE_ROOT$STORAGE_MOUNT/" "$RESTORE_STORAGE/"
docker run -d --name hs-platform-restore-storage \
  --env-file "$RESTORE_ROOT/srv/hs-platform/.env.prod" \
  -v hs-platform-restore-storage:/data \
  minio/minio:<TAG_MINIO_DEL_03> server /data --console-address :9001
```

Desde un contenedor temporal de `mc`, comprobar que existe al menos un objeto de evidencia y
que el volumen conserva más de una versión cuando el manifiesto de producción indica que ya
existen versiones. No se publica ningún puerto ni se usa la credencial limitada para borrar.

```bash
docker run --rm --network container:hs-platform-restore-storage \
  --env-file "$RESTORE_ROOT/srv/hs-platform/.env.prod" \
  minio/mc:<TAG_MC_DEL_05> sh -c \
  'mc alias set restored http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
   mc ls --recursive --versions "restored/$S3_BUCKET"'
```

### Paso 8 — Destruir solo la copia y guardar evidencia

```bash
docker rm -f hs-platform-restore-db hs-platform-restore-storage
docker volume rm hs-platform-restore-db hs-platform-restore-storage
sudo rm -rf "$RESTORE_ROOT"
docker compose --env-file .env.prod -f compose.prod.yml ps api db storage
```

Guardar fuera del VPS el ID del snapshot, el ID de `restic`, los checksums, el resultado de
las consultas y la duración de la restauración. El último comando debe dejar producción sana;
si no, se detiene `09` y se investiga.

---

## 4. Verificación

Repetir dentro de un mes, sin datos destructivos y sin mostrar secretos:

```bash
sudo systemctl is-enabled hs-platform-backup.timer
sudo systemctl is-active hs-platform-backup.timer
sudo systemctl status --no-pager hs-platform-backup.service
sudo sh -c 'set -a; . /etc/hs-platform/restic.env; set +a; restic snapshots --tag hs-platform'
sudo sh -c 'set -a; . /etc/hs-platform/restic.env; set +a; restic check'
sudo journalctl -u hs-platform-backup.service -n 80 --no-pager
df -h /srv/hs-platform
docker compose --env-file .env.prod -f compose.prod.yml ps api db storage
```

Registrar:

- ID y fecha UTC del snapshot lógico más reciente.
- Que el snapshot vive en B2, no solo en `/srv/hs-platform`.
- Resultado `0` del servicio y de `restic check`.
- ID del snapshot del proveedor y volúmenes incluidos.
- Fecha de la última restauración real, duración y resultado.
- Conteos de sitios, tablas `pgboss`, cadena de auditoría y objetos comprobados.

---

## 5. Criterios de hecho

- [ ] El repositorio de `restic` está en Backblaze B2 y no en el VPS.
- [ ] La contraseña del repositorio tiene una copia de recuperación fuera del VPS.
- [ ] `hs-platform-backup.timer` está habilitado y activo.
- [ ] El último servicio de backup terminó con código `0`.
- [ ] La retención aplicada es 14 diarios, 8 semanales y 12 mensuales.
- [ ] El backup contiene dump custom, roles globales, `.env.prod` y `storage-data`.
- [ ] `.env.prod` nunca aparece en logs ni en Git.
- [ ] `restic check` pasó.
- [ ] El snapshot del proveedor está habilitado, identificado y cubre los volúmenes requeridos.
- [ ] Postgres fue restaurado en una copia aislada con roles antes del dump.
- [ ] La cadena de auditoría restaurada devuelve cero eslabones rotos.
- [ ] MinIO fue restaurado en una copia aislada y se comprobó una evidencia.
- [ ] La copia de restauración fue destruida sin tocar los volúmenes de producción.

---

## 6. Si falla

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| `restic` no encuentra el repositorio | `RESTIC_REPOSITORY` o las credenciales B2 no corresponden | No inicialices otro repositorio. Corrige `/etc/hs-platform/restic.env` y repite `snapshots` |
| El timer está activo pero no hay snapshot nuevo | Servicio fallido, falta de espacio o B2 inaccesible | Lee `journalctl`, conserva el último snapshot válido y no empieces `09` |
| `pg_dump` falla | Base no sana, rol incorrecto o conexiones en cierre | No borres nada. Comprueba `db`, `pg_isready` y vuelve a ejecutar después de resolver la causa |
| `restic check` falla | Repositorio incompleto o corrupción remota | No apliques `prune`; conserva el último snapshot bueno y abre una incidencia con B2 |
| La restauración no crea propietarios | Se restauró el dump antes de los roles | Destruye solo la copia, restaura roles primero y repite el ensayo |
| Faltan fotos restauradas | Se respaldó solo Postgres o no se copió `storage-data` | El backup no está verificado; corrige el script y repite desde un snapshot completo |
| El proveedor no ofrece snapshot verificable | Decisión de infraestructura incompleta | Detén `09`; el backup lógico de B2 no sustituye la capa de snapshots declarada por ADR-026 |
| Producción queda detenida tras un fallo | El `trap` no pudo arrancar servicios | Ejecuta `docker compose start storage api`, verifica salud y registra el incidente antes de continuar |

**Punto de retroceso.** Antes de la primera restauración aislada, corregir configuración es
reversible. Nunca se usa `docker compose down -v` en producción. Una restauración real sobre
volúmenes vivos no es un retroceso: es destrucción.

---

## 7. Lo que este documento le pide a otro

| Documento | Qué necesita |
| --- | --- |
| `03-infraestructura.md` | Los volúmenes con los nombres congelados y ningún puerto de Postgres o MinIO publicado |
| `04-postgres.md` | Que `hs_migrator` y `hs_app` existan y que `pgboss` se instale después de la migración |
| `05-objetos-minio.md` | Versioning activado y ninguna política de expiración que elimine versiones |
| `07-entorno-y-release.md` | `.env.prod` con permisos `600` y `BETTER_AUTH_SECRET` estable |
| `09-puesta-en-marcha.md` | Ejecutar este documento y repetir el backup después del primer dato operativo real |
| `10-operacion.md` | Vigilar edad, resultado, espacio, retención y fecha del último restore drill |

---

## 8. Riesgos con datos reales

**Un backup que nunca se restaura no es evidencia de recuperación.** La existencia de un
snapshot en B2 no demuestra que roles, RLS, auditoría y fotos vuelvan juntos.

**La contraseña de `restic` es irrecuperable si se pierde.** Guardarla solo en el VPS deja la
organización sin backup justo cuando pierde el VPS.

**`BETTER_AUTH_SECRET` es parte del estado.** Restaurar la base sin `.env.prod` devuelve tablas,
pero no una instalación capaz de validar las sesiones existentes.

**MinIO contiene evidencia inmutable.** Un backup que conserva solo el objeto corriente pierde
versiones históricas; no se agrega lifecycle para controlar el tamaño.

**El snapshot del proveedor puede compartir el mismo modo de falla.** B2 es la copia externa;
el snapshot aporta velocidad de recuperación, no independencia total.

**Una migración aplicada no tiene `down`.** Si el rollback necesita una versión anterior del
esquema, el camino es restaurar una copia aislada y planificar el corte, no ejecutar SQL
improvisado sobre la base viva.

---

## Referencias

- `docs/adr/026-despliegue-vps-unico.md` — sustituto de PITR y restauración obligatoria
- `docs/adr/008-system-architecture.md` — recuperación como parte de la inmutabilidad
- `docs/deployment/04-postgres.md` — roles, migraciones y `pgboss`
- `docs/deployment/05-objetos-minio.md` — versioning y ausencia de `DeleteObject`
- `docs/deployment/07-entorno-y-release.md` — `.env.prod`, secreto y rollback
