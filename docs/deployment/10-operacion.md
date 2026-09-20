# 10 — Operación

**Qué resuelve.** Define las comprobaciones que mantienen vivo un despliegue de una sola
máquina: servicios, backups, disco, crons regulatorios, MinIO, Postgres, TLS y releases.

**Qué NO resuelve.** No agrega observabilidad nueva, no cambia umbrales del código, no rota
secretos automáticamente y no reemplaza la restauración de `08`.

**Estado al entrar.** `09` terminó con roster, cuentas administrativas, un inspector probado,
una inspección enviada y el primer backup con datos reales.

**Estado al salir.** Existe un responsable, un calendario y una evidencia reciente para cada
comprobación. Un fallo tiene dueño, síntoma y punto de retroceso.

**Artefactos que este documento crea o modifica.**

- La checklist operativa de esta instalación — dueña de este documento
- El registro externo de comprobaciones, incidentes y restore drills
- Ningún archivo de aplicación, compose o configuración de Caddy

---

## 1. Precondiciones

### Accesos

Debe existir acceso al VPS, al panel de snapshots, al repositorio B2 y a una segunda cuenta
administrativa de la aplicación. No se usan credenciales de producción en capturas de pantalla.

```bash
docker compose --env-file .env.prod -f compose.prod.yml ps
sudo systemctl list-timers hs-platform-backup.timer
```

La salida identifica los servicios y el timer; no debe mostrar contraseñas.

### Registro inicial

Conservar la evidencia de `09`: tag de API, hash del cliente, fecha del primer backup, IDs de
cuentas administrativas, plantas, y resultado de la prueba móvil. Sin esa línea base no se
puede distinguir crecimiento normal de regresión.

### Herramientas

```bash
docker compose version
curl --version | sed -n '1p'
restic version
```

Las tres herramientas deben responder en el VPS. Las sondas externas se ejecutan desde una
máquina que no sea el VPS cuando se quiere comprobar internet y TLS.

---

## 2. Decisiones ya tomadas

| # | Decisión | Por qué |
| --- | --- | --- |
| D1 | Las comprobaciones diarias son manuales o las ejecuta un monitor externo | La instalación no tiene Prometheus, Sentry ni un sistema de alertas propio |
| D2 | `/health` no es readiness completa | El endpoint no consulta Postgres, MinIO ni pg-boss |
| D3 | El RPO se mide por la edad del último snapshot lógico exitoso | La topología no tiene PITR |
| D4 | MinIO crece sin lifecycle de expiración | Las versiones son evidencia y no se pueden borrar por conveniencia |
| D5 | Se verifica el cron diario de apertura aunque el período sea mensual | El job es idempotente y recupera una caída silenciosa del contenedor |
| D6 | Cada release necesita backup previo y rollback decidido antes de migrar | Las migraciones no tienen archivos `down` |
| D7 | La restauración completa se ensaya trimestralmente | Un backup no verificado no cumple el objetivo de recuperación |

---

## 3. Pasos

### Paso 1 — Comprobación diaria

Desde una máquina externa:

```bash
curl -fsS https://api.<DOMINIO>/health
curl -fsS -o /dev/null -w 'app=%{http_code} tls=%{ssl_verify_result}\n' https://app.<DOMINIO>/
curl -fsS -o /dev/null -w 's3=%{http_code} tls=%{ssl_verify_result}\n' https://s3.<DOMINIO>/minio/health/live
```

Esperado: health JSON con estado `ok`, `app=200 tls=0` y `s3=200 tls=0`.

En el VPS:

```bash
cd /srv/hs-platform
docker compose --env-file .env.prod -f compose.prod.yml ps
sudo systemctl status --no-pager hs-platform-backup.timer
sudo systemctl status --no-pager hs-platform-backup.service
sudo journalctl -u hs-platform-backup.service --since '26 hours ago' --no-pager
df -h /srv/hs-platform
df -i /srv/hs-platform
```

Registrar como `OK` solo si todos los contenedores esperados están `running` o `healthy`, el
último backup terminó con `0`, el timer está activo y existe margen de disco e inodos. Un
`health` verde no compensa un backup vencido.

### Paso 2 — Comprobación semanal de recursos y seguridad

```bash
cd /srv/hs-platform
docker compose --env-file .env.prod -f compose.prod.yml logs --since 168h api db storage caddy
docker system df
du -sh /var/lib/docker/volumes/*db-data* /var/lib/docker/volumes/*storage-data* 2>/dev/null
docker compose --env-file .env.prod -f compose.prod.yml exec -T db \
  psql -U postgres -d hs_platform -c "select usename, state, count(*) from pg_stat_activity group by usename, state order by usename, state;"
docker compose --env-file .env.prod -f compose.prod.yml ps storage-init
```

Buscar `FATAL`, `out of space`, `pg-boss`, reinicios y cierres forzados. `storage-init` debe
haber terminado con código `0` después del último `up`; si aparece corriendo indefinidamente o
con error, revisar `05` antes de tocar políticas del bucket.

Desde una máquina externa, verificar que 5432, 9000 y 9001 siguen cerrados:

```bash
for port in 5432 9000 9001; do
  nc -z -w3 <IP_VPS> "$port" && echo "FALLÓ: puerto $port expuesto" || echo "$port cerrado"
done
```

### Paso 3 — Comprobación mensual de los jobs regulatorios

Después del día 1 de cada mes:

```bash
cd /srv/hs-platform
docker compose --env-file .env.prod -f compose.prod.yml exec -T db \
  psql -U postgres -d hs_platform -c "select name, cron, timezone from pgboss.schedule order by name;"
docker compose --env-file .env.prod -f compose.prod.yml logs --since 36h api | \
  grep -E 'open-period|escalat|overdue' || true
```

Debe haber exactamente las dos programaciones esperadas, `0 3 * * *` y `0 4 * * *`, ambas en
`America/Toronto`. La revisión de logs busca evidencia de ejecución; si no existe, revisar la
fecha civil del período en ambas plantas y no asumir que el cron corrió.

Comprobar además desde la UI:

- existe una inspección del período corriente para St. Thomas;
- existe una inspección del período corriente para Glencoe;
- las asignaciones corresponden al inspector esperado;
- las acciones vencidas muestran la escalada correspondiente;
- la cadena de auditoría sigue verificando sin eslabones rotos.

### Paso 4 — Comprobación por release

Antes de cada release:

```bash
cd /srv/hs-platform
sudo systemctl start hs-platform-backup.service
sudo systemctl status --no-pager hs-platform-backup.service
docker image inspect hs-platform-api:<API_TAG> --format '{{.Id}}'
printf '%s\n' '<HUELLA_ESPERADA_DE_BETTER_AUTH_SECRET>'
df -h /srv/hs-platform
```

La huella esperada se compara sin imprimir el secreto. Si hay migraciones nuevas, se ejecutan
`db:migrate` y `db:jobs:install` según `04` antes de reemplazar la API.

Después del release:

```bash
docker compose --env-file .env.prod -f compose.prod.yml up -d --no-deps api
docker compose --env-file .env.prod -f compose.prod.yml ps api
curl -fsS https://api.<DOMINIO>/health
docker compose --env-file .env.prod -f compose.prod.yml logs --since 10m api
docker compose --env-file .env.prod -f compose.prod.yml exec -T api \
  sh -c 'test -z "$MIGRATION_DATABASE_URL" && echo "sin credencial de migración"'
curl -fsS https://app.<DOMINIO>/ | grep -Eo 'assets/[^" ]+\.(js|css)' | sort -u
```

Registrar el tag de API, el commit del cliente, el tamaño de precache, el asset servido, el
resultado de `storage-init`, las dos programaciones y la huella del secreto. No se declara un
release sano si el bundle referencia `localhost` o si el precache supera el presupuesto de
`06`.

### Paso 5 — Restore drill trimestral

Ejecutar la restauración completa de `08`, sección 3, Pasos 6–8. Registrar:

- snapshot lógico y snapshot del proveedor elegidos;
- hora de inicio y fin;
- roles restaurados antes del dump;
- conteos de sitios, tablas `pgboss` y auditoría;
- objeto y versión de MinIO comprobados;
- producción sin cambios durante el ensayo;
- RTO observado y cualquier corrección aplicada.

Si se cambia el script, el destino, la retención o la topología, no se espera al trimestre:
se repite el ensayo antes del siguiente dato real.

### Paso 6 — Gestionar incidentes sin destruir evidencia

Ante un fallo:

1. registrar hora UTC, síntoma y último estado conocido;
2. preservar logs y manifiestos del backup;
3. evitar `down -v`, `docker volume rm` y regeneración de `BETTER_AUTH_SECRET`;
4. determinar si hay datos reales afectados;
5. elegir entre reparación reversible y restauración aislada;
6. documentar el resultado antes de cerrar el incidente.

El rollback de una API sin migración nueva puede usar el tag anterior. Con una migración ya
aplicada, el camino es `08`, no una imagen vieja contra un esquema desconocido.

---

## 4. Verificación

Una vez al mes, guardar una salida compacta de:

```bash
cd /srv/hs-platform
docker compose --env-file .env.prod -f compose.prod.yml ps
sudo systemctl is-active hs-platform-backup.timer
sudo systemctl is-active hs-platform-backup.service || true
sudo journalctl -u hs-platform-backup.service --since '32 days ago' --no-pager
df -h /srv/hs-platform
df -i /srv/hs-platform
docker compose --env-file .env.prod -f compose.prod.yml exec -T db \
  psql -U postgres -d hs_platform -c "select name, cron, timezone from pgboss.schedule order by name;"
curl -fsS https://api.<DOMINIO>/health
```

La ficha mensual debe tener `OK` o `FALLÓ` por cada punto, responsable, fecha UTC y enlace al
manifiesto o incidencia. `OK` no significa “el comando no imprimió error”: significa que la
salida esperada fue comprobada.

---

## 5. Criterios de hecho

- [ ] Hay una persona responsable de la revisión diaria y otra de respaldo.
- [ ] Se revisa la edad del último backup y el resultado del timer cada día.
- [ ] Se revisan disco, inodos, logs y conexiones cada semana.
- [ ] Se verifican `storage-init`, versioning, CORS y ausencia de `DeleteObject` cada semana o después de un redeploy.
- [ ] Se verifican los dos crons y las inspecciones de ambas plantas cada mes.
- [ ] Cada release tiene backup previo, tag, precache y asset servido registrados.
- [ ] Ningún release deja `MIGRATION_DATABASE_URL` en el proceso `api`.
- [ ] Se ejecutó un restore drill dentro del último trimestre.
- [ ] Existe RTO observado y una acción para cada fallo abierto.
- [ ] Nunca se usó `down -v` sobre producción.

---

## 6. Si falla

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| El backup tiene más edad que el RPO | Timer fallido, B2 inaccesible o disco lleno | Preservar el último snapshot bueno, leer el journal y ejecutar una corrida manual después de resolver |
| El disco crece rápidamente | Versiones de MinIO, logs o temporales de restore | Medir primero. No borrar objetos ni volúmenes; aplicar la retención de `08` y ampliar capacidad si corresponde |
| `open-period` no aparece en logs | API reiniciada, `JOBS_ENABLED` incorrecto o reloj/NTP incorrecto | Verificar entorno, NTP, schedule y correr el job de recuperación definido por la aplicación; no cambiar fechas a mano |
| Falta una inspección del mes | El cron no corrió o la asignación no existe | No cerrar el período como resuelto: comprobar planta, asignación y auditoría, y registrar la recuperación |
| Hay demasiadas conexiones `idle` | Reinicio incompleto o cliente que no cerró | Comparar con el límite de 100, revisar logs y reiniciar solo la API si la base sigue sana |
| `storage-init` termina con error | Credencial, bucket, CORS o versioning mal configurado | Detener el release, revisar `05` y verificar que no se otorgó `DeleteObject` |
| TLS está próximo a vencer | DNS o Caddy no puede renovar | Revisar 80/443, DNS y logs de Caddy. No borrar `caddy-data` ni `caddy-config` |
| El bundle servido no coincide con el build | Publicación parcial o `rsync` incompleto | No instalar la PWA ni continuar con inspectores; publicar el bundle correcto y repetir `06` |
| Se perdió `BETTER_AUTH_SECRET` | `.env.prod` no fue restaurado | Detener cambios, recuperar el archivo desde `08`; regenerarlo invalida sesiones y no es una reparación normal |

**Punto de retroceso.** Las comprobaciones y un reinicio controlado de `api` son reversibles.
Un cambio de esquema, la rotación del secreto y la eliminación de volúmenes no lo son; exigen
backup y restauración aislada antes de ejecutarse.

---

## 7. Lo que este documento le pide a otro

| Documento | Qué necesita |
| --- | --- |
| `03-infraestructura.md` | Logs acotados, `stop_grace_period`, TLS y puertos internos sin exposición |
| `04-postgres.md` | El orden de migración, `pgboss`, seeds y los dos roles |
| `05-objetos-minio.md` | Versioning, CORS y credencial sin `DeleteObject` |
| `06-cliente-web.md` | El presupuesto de precache y la verificación de assets/cabeceras |
| `07-entorno-y-release.md` | El procedimiento de release, rollback y la huella del secreto |
| `08-backups.md` | El comando de backup, manifiesto, retención y restore drill |
| `09-puesta-en-marcha.md` | La línea base de datos reales y la fecha en que empieza la operación |

---

## 8. Riesgos con datos reales

**Borrar para recuperar espacio.** `storage-data` contiene evidencia y versiones. El tamaño
debe resolverse con capacidad, retención de backups o una decisión explícita, nunca con
`rm`, lifecycle o `docker volume rm` improvisados.

**Tomar `/health` como prueba suficiente.** Puede estar verde mientras Postgres, MinIO o
pg-boss están degradados. Las sondas se mantienen separadas por diseño.

**Regenerar el secreto de sesión.** Cierra todas las sesiones y deja inspectores con outbox
sin acceso. Se restaura el valor anterior; no se genera uno nuevo como operación rutinaria.

**Rollback después de una migración.** Una imagen anterior puede no entender el esquema nuevo.
El único camino seguro es el restore drill de `08` y un corte planificado.

**Cerrar o recrear contenedores sin preservar volúmenes.** `down -v` destruye la base y las
fotos; no es una herramienta de mantenimiento.

---

## Referencias

- `docs/deployment/03-infraestructura.md` — red, logs, Caddy y volúmenes
- `docs/deployment/04-postgres.md` — roles, conexiones, migraciones y pg-boss
- `docs/deployment/05-objetos-minio.md` — bucket, versioning y CORS
- `docs/deployment/06-cliente-web.md` — service worker, precache y publicación
- `docs/deployment/07-entorno-y-release.md` — variables, redeploy y rollback
- `docs/deployment/08-backups.md` — backup y restauración
