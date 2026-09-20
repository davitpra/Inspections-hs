# 09 — Puesta en marcha

**Qué resuelve.** Entra el roster real, se crean las cuentas, se entregan las invitaciones y
se verifica el sistema de punta a punta con un teléfono de verdad. Al salir de este
documento el sistema está en producción y en uso.

**Qué NO resuelve.** La infraestructura es del `03`, la base del `04`, el bucket del `05`, el
cliente del `06`, las variables del `07` y el backup del `08`. La rutina de mantenimiento es
del `10`.

**Artefactos que este documento crea o modifica.** Ninguno en el repositorio. Este documento
solo ejecuta comandos contra el sistema desplegado.

> ### Acá entra la primera evidencia operativa real
>
> `04` ya sembró la identidad real del coordinador. Acá entran el roster completo, las
> cuentas de uso y la primera inspección con evidencia. **A partir del primer comando de este
> documento eso deja de ser un reinicio y pasa a ser destrucción.**
>
> Por ADR-002 este sistema no borra nada: no hay `DELETE`, solo `deactivated_at`. Lo que se
> escriba acá queda en la cadena de auditoría para siempre.

---

## 1. Precondiciones

### El backup existe y está verificado

**Es bloqueante y no es negociable.** El `08` va antes que este documento justamente por
esto: en cuanto entre el roster, hay evidencia regulatoria en la máquina.

Ejecutá completa la sección `4. Verificación` de `08-backups.md` y guardá su salida. Tiene que
existir un snapshot lógico de hoy en B2, un snapshot del proveedor identificado y una
restauración aislada ya comprobada.

Si el `08` no se ejecutó, o si su ensayo de restauración no se hizo, **este documento no
empieza**. ADR-008 lo dice con todas las letras: un backup no verificado no es un backup.

### El sistema responde

```bash
curl -fsS https://api.<DOMINIO>/health
curl -fsS -o /dev/null -w '%{http_code}\n' https://app.<DOMINIO>/
```

El primero devuelve `{"status":"ok","service":"api"}`. El segundo, `200`.

### La base tiene esquema, trabajos y seeds

```bash
docker compose --env-file .env.prod -f compose.prod.yml --profile tools run --rm migrator \
  node -e "const pg=require('pg');const p=new pg.Pool({connectionString:process.env.MIGRATION_DATABASE_URL});p.query('select count(*)::int as n from site').then(r=>{console.log('sitios:',r.rows[0].n);return p.end()})"
```

Tiene que decir `sitios: 2`.

### El seed de arranque se sembró con los datos reales

```bash
docker compose --env-file .env.prod -f compose.prod.yml exec -T db \
  psql -U postgres -d hs_platform -Atc \
  "select p.employee_number, p.first_name, p.last_name, u.email from person p join app_user u on u.person_id = p.id where u.id = 'acc00000-0000-4000-8000-000000000001'"
```

Tiene que devolver el legajo, nombre, apellido y email reales definidos en el `01`. Si devuelve
el placeholder o ninguna fila, el `04` no se completó y **no se sigue**.

### El CSV del roster está listo

El formato es el de ADP, el mismo que acepta el botón de importar de `/roster`. Revisalo
antes: `roster:import` es un upsert por número de empleado, así que un legajo mal escrito
crea una persona de más en vez de corregir una.

---

## 2. Decisiones ya tomadas

| # | Decisión | Por qué |
| --- | --- | --- |
| D1 | **Dos cuentas administrativas desde el día uno: una `coordinator` y una `management`** | `reset-password` se niega en producción a propósito. Con una sola cuenta, si se bloquea o pierde la contraseña, **el sistema no tiene salida** |
| D2 | El roster entra **antes** que las cuentas | `auth:create-account` no crea personas. Si alguien no está en el roster, el comando falla |
| D3 | Las invitaciones se entregan a mano | No hay correo transaccional en el sistema, y no se va a agregar uno |
| D4 | La verificación incluye **una foto real desde un teléfono real** | Es el único camino que ejerce CORS, el `Host` de SigV4 y el límite de cuerpo a la vez |

---

## 3. Pasos

Todos los comandos se corren desde `/srv/hs-platform` en el VPS, con el prefijo:

```bash
DC="docker compose --env-file .env.prod -f compose.prod.yml"
TOOLS="$DC --profile tools run --rm"
```

### Paso 1 — Importar el roster

```bash
# Desde la máquina operadora:
scp <RUTA_LOCAL_DEL_CSV> <USUARIO>@<HOST_VPS>:/tmp/roster.csv

# En el VPS:
CSV=/srv/hs-platform/import/roster.csv
install -d -m 700 /srv/hs-platform/import
install -m 600 /tmp/roster.csv "$CSV"
rm /tmp/roster.csv
sha256sum "$CSV"
$TOOLS -v "$CSV:/tmp/roster.csv:ro" migrator \
  pnpm roster:import /tmp/roster.csv --as <EMAIL_DEL_COORDINADOR_SEMBRADO>
```

El primer comando se ejecuta en el VPS después de copiar el archivo desde la máquina que lo
recibió. `--as` es la cuenta en cuyo nombre se hace
el alta: va a la cadena de auditoría de cada planta, y por eso no tiene default. Usá la
cuenta que sembró el `04`.

**Cómo sé que salió bien.** Guardá el hash anotado junto con la salida del importador, que tiene
que terminar con:

```text
Rechazadas: 0
```

El número de `Aplicadas` coincide con las filas válidas del CSV, no con `wc -l`: el encabezado,
filas inactivas y rechazos no representan personas activas nuevas. El importador conserva las
filas aplicadas aunque haya rechazos, así que se corrige el CSV y se repite hasta obtener cero
rechazos.

```bash
docker compose --env-file .env.prod -f compose.prod.yml exec -T db \
  psql -U postgres -d hs_platform -c \
  "select employee_number, first_name, last_name, site_id, deactivated_at from person order by employee_number"
```

Compará la salida con el CSV y verificá que el coordinador sembrado fue actualizado por su
`employee_number`, no duplicado. Repetir el importador deja auditoría adicional, por eso se
repite solo después de corregir rechazos.

### Paso 2 — La primera credencial

La cuenta del coordinador ya existe —la sembró el `04`— pero **nace sin credencial**: no
puede iniciar sesión hasta que acepte una invitación. Eso es ADR-011 y no es un olvido.

```bash
$TOOLS migrator pnpm auth:bootstrap
```

> El token se imprime **una sola vez**. Del otro lado queda su hash y no hay ninguna ruta
> que lo vuelva a mostrar. Si se pierde antes de aceptar, se cancela o se deja vencer la
> invitación y el coordinador emite otra desde la aplicación; no hay una credencial que
> revocar todavía.

Copialo antes de cerrar la terminal. Vence a las 72 horas y se usa una sola vez.

**Cómo sé que salió bien.** El link abre la pantalla de aceptación:

```
https://app.<DOMINIO>/accept-invitation?token=<TOKEN>
```

Ahí el titular elige su contraseña, mínimo 12 caracteres.

### Paso 3 — La segunda cuenta administrativa

**Este paso no se saltea.** Es D1.

La persona ya tiene que estar en el roster (entró en el Paso 1):

```bash
$TOOLS migrator pnpm auth:create-account \
  --employee <LEGAJO> \
  --email <EMAIL> \
  --role management \
  --site st-thomas \
  --site glencoe \
  --actor <EMAIL_DEL_COORDINADOR>

$TOOLS migrator pnpm auth:bootstrap <USER_ID_NUEVO>
```

`auth:create-account` no siembra ni reemplaza ninguna credencial, así que lo peor que puede
hacer quien lo corre es crear una cuenta de más, visible y auditada. La salida imprime el
`userId` que se pasa al segundo comando. El alcance de emergencia queda fijado a las dos
plantas; no se improvisa con `--help` durante la puesta en marcha.

**Cómo sé que salió bien.** Las dos cuentas administrativas existen y están activas:

```bash
$DC exec -T db psql -U postgres -d hs_platform -c \
  "select email, role from app_user where role in ('coordinator','management') and deactivated_at is null order by email"
```

Dos filas, como mínimo. **Verificá que la segunda persona pueda entrar de verdad**, no solo
que la fila exista: una segunda cuenta que nadie probó no es una salida de emergencia.

### Paso 4 — Los inspectores

Por pantalla, no por comando. En `/roster`, cada persona sin cuenta muestra un botón
"Invite as inspector": pide el email y crea la cuenta e emite la invitación en un solo acto.
El sitio es el que la pantalla está mirando.

El link de un solo uso se muestra ahí mismo para copiar, y **no se vuelve a mostrar**.

### Paso 5 — Abrir y asignar el primer período

El período se abre mediante el job diario `inspections.open-period` a las 03:00 de
`America/Toronto`. `/scheduling` no lo abre: es una pantalla de consulta y asignación. Esperá
la corrida del job y verificá que la API estaba viva; no uses `demo:data` ni escribas el INSERT
del período a mano en producción.

Verificá que quedó abierto en las dos plantas. Después, desde `/scheduling`, asigná una
inspección de St. Thomas y otra de Glencoe a inspectores reales y comprobá que aparecen en “My
inspections”. Así las verificaciones con red y sin red no consumen la misma asignación. No se
prueba offline hasta que el paquete de campo esté descargado.

---

## 4. Verificación

Es la única verificación del conjunto que necesita un teléfono real. No la reemplaces por
`curl`: el camino de la foto solo se ejerce entero desde un navegador móvil.

### A. El camino del inspector, con red

1. Confirmá en el `06`, Paso 10, que pasó la barrera de instalación: sin `localhost`, cabeceras correctas, service worker, manifest, instalabilidad y precache dentro del presupuesto.
2. Abrí `https://app.<DOMINIO>` en el teléfono e instalá la PWA.
3. Iniciá sesión como inspector.
4. Abrí la inspección asignada y pulsá “Download for the field”. Esperá el estado listo antes de cortar la red.
5. Con red, completá una inspección de control, sacá una foto y firmá.
6. Enviá una sola vez y anotá el identificador de envío.

**Qué prueba cada cosa.** El login ejerce CORS y `TRUST_PROXY`. La foto ejerce el presign,
el CORS del bucket, el `Host` de SigV4 y el límite de cuerpo de Caddy. El envío ejerce la
ingesta idempotente.

### B. El camino sin red

1. Con otra inspección asignada o una segunda corrida preparada, poné el teléfono en modo avión.
2. Capturá el borrador, completalo, sacá una foto y firmá.
3. Comprobá que `/outbox` muestra el envío pendiente y que ningún request de red es necesario para firmar.
4. Volvé a tener red y mirá `/outbox`.

El envío tiene que salir solo. Es ADR-001 funcionando.

### C. La evidencia llegó al bucket

```bash
$DC run --rm -T --entrypoint sh storage-init -c \
  'mc alias set root http://storage:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
   mc stat "root/$S3_BUCKET/<CLAVE_EXACTA_DEL_OBJETO>"'
```

Tiene que aparecer la clave exacta devuelta por el presign, bajo el prefijo del sitio. Usá el
procedimiento de presign que `05` deja pendiente y guardá request, preflight, PUT `200`, clave,
tamaño y versión. No se comprueba mirando las últimas cinco líneas de un listado.

### D. La cadena de auditoría

```bash
docker compose --env-file .env.prod -f compose.prod.yml exec -T db \
  psql -U postgres -d hs_platform -c \
  "select event_type, actor_user_id, occurred_at from audit_log order by occurred_at desc limit 20"
```

Tiene que contener eventos posteriores al inicio de este documento: importación del roster,
cuentas/invitaciones, asignación y envío de la inspección. El seed ya dejó auditoría, por eso
`count(*) > 0` no es una prueba suficiente.

### E. El backup incluye lo nuevo

Corré el servicio `hs-platform-backup.service` de `08` **ahora**, con datos reales adentro, y
repetí la verificación de `08`: snapshot en B2, checksum, `restic check`, manifiesto y
`pg_restore --list`. El tamaño por sí solo no demuestra que el backup sea restaurable.

---

## 5. Criterios de hecho

- [ ] El backup del `08` está instalado y su ensayo de restauración se ejecutó
- [ ] El reporte del importador tiene cero rechazos y coincide con el CSV validado
- [ ] No queda ningún valor de relleno en `004_bootstrap_coordinator.sql`
- [ ] **Dos** cuentas administrativas existen, y las dos iniciaron sesión al menos una vez
- [ ] El período del mes está abierto y asignado en las dos plantas
- [ ] Una inspección completa se envió desde un teléfono real, con foto
- [ ] La foto está en el bucket
- [ ] Una inspección capturada sin red salió sola al recuperar señal
- [ ] La auditoría tiene eventos posteriores al inicio de este documento
- [ ] Se corrió y verificó un backup con datos reales mediante el procedimiento del `08`
- [ ] El `10` está leído y su checklist agendada

---

## 6. Si falla

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| `roster:import` falla con «Falta DATABASE_URL» | El comando corre como `hs_app`, no como `hs_migrator` | Verificá que el servicio `migrator` declare las dos. Está en el `03` |
| `auth:create-account` dice que la persona no está en el roster | El legajo no coincide con el CSV | No crees la persona por un atajo: corregí el CSV y reimportá. Es lo que mantiene al roster como fuente de verdad |
| El token de invitación se perdió | Se muestra una sola vez, por diseño | Si todavía está pendiente, dejalo vencer o cancelalo y emití otra; si ya había credencial, revocala desde `/roster` y reemití |
| La invitación dice que venció | Pasaron 72 horas | Emití otra |
| Login correcto pero la PWA no carga datos | `WEB_ORIGINS` no coincide byte a byte | Ver `07`, verificación 5 |
| La inspección se guarda pero las fotos fallan | CORS, `Host` o tamaño | Ver `05`, que separa los cuatro códigos de 403. **No mires el `Content-Type`: no se firma** |
| El período no aparece | El cron todavía no corrió, la API estaba detenida o el reloj/NTP está mal | No lo abras desde `/scheduling` ni con SQL. Verificá API, NTP, `JOBS_ENABLED`, `pgboss.schedule` y esperá la siguiente corrida; documentá la incidencia para `10` |
| Un inspector quedó bloqueado | Demasiados intentos | El coordinador revoca la credencial desde `/roster` y reemite. `reset-password` no corre en producción |

**Punto de retroceso.** Ya no hay. Desde el Paso 1 la salida es la restauración del `08`,
sobre una copia primero.

---

## 7. Lo que este documento le pide a otro

| Documento | Qué necesita |
| --- | --- |
| `08-backups.md` | Estar ejecutado y **verificado** antes del Paso 1, y volver a ejecutarse después de la primera evidencia real |
| `10-operacion.md` | La checklist agendada el mismo día que termina este documento. La verificación del cron mensual empieza a importar ahora |
| `05-objetos-minio.md` | La verificación end-to-end del presign que el `05` dejó pendiente por falta de sesión se ejecuta acá, con clave exacta y evidencia del PUT |

---

## 8. Riesgos con datos reales

**Este documento es el riesgo.** Todo lo anterior se podía deshacer borrando volúmenes.

**El roster mal importado.** Un legajo equivocado crea una persona de más, y por ADR-002 esa
fila no se borra: se desactiva. Revisá el CSV antes, no después.

**Una sola cuenta administrativa.** Si esa persona se bloquea, nadie puede reemitir
credenciales y `reset-password` se niega en producción. El sistema queda inaccesible con
todos sus datos adentro. Por eso D1 no se saltea.

**El token de invitación en un canal inseguro.** Da acceso a elegir la contraseña de esa
cuenta durante 72 horas. Entregalo en persona o por un canal que no quede archivado.

**`docker compose down -v`.** Desde hoy se lleva la base y las fotos de todas las
inspecciones. No existe deshacer; existe el `08`.

---

## Referencias

- `README.md` de la raíz — "Dar de alta a alguien", con las precondiciones de cada comando
- ADR-001 — el outbox y por qué el envío es el punto de no retorno
- ADR-002 — por qué nada se borra
- ADR-011 — por qué no hay auto-registro y por qué la primera cuenta nace sin credencial
- `docs/deployment/08-backups.md` — la precondición bloqueante
- `docs/deployment/10-operacion.md` — lo que empieza al día siguiente
