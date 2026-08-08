# Inspecciones programadas

## Why

Hoy el sistema sabe qué preguntar —plantilla, versión publicada, motor de formularios— y sabe
quién puede preguntarlo —persona, cuenta, rol, alcance por sitio— pero no sabe **que hay que
preguntarlo**. No existe una fila que diga "St. Thomas debe una inspección de agosto". Sin ella
el recorrido R1 no arranca: la PWA no tiene qué descargar, el inspector no tiene qué abrir, y el
reporte de cumplimiento de la etapa 7 no tiene contra qué comparar lo hecho. La obligación de la
OHSA es mensual y por sitio; mientras la obligación viva en el calendario de alguien y no en la
base, el sistema no puede probar que se cumplió ni avisar que no.

Este change abre la **segunda mitad de la etapa 3** de `docs/Requisitos_V1.2.md` §7. No la cierra:
la PWA, el outbox y la ingesta idempotente son changes siguientes, y todos consumen la fila que
este change crea. Va ahora porque la captura offline necesita un `scheduled_inspection` que
descargar antes de poder llenarlo — construir la captura primero significaría inventar un destino
provisional y migrarlo después.

Es además el **primer uso real de pg-boss** (ADR-005). La apertura mensual es el trabajo más
simple de los tres que la ADR enumera, y sirve de banco de pruebas del planificador antes de que
la etapa 5 le cuelgue el escalamiento de acciones vencidas, donde equivocarse tiene consecuencias
regulatorias.

## What Changes

- **`scheduled_inspection`** — la obligación. Sitio, período mensual, `template_version_id`
  **congelada al programar**, inspector asignado, y una cola de columnas mutables muy corta
  (reasignación y cancelación). Nunca se borra: se cancela con motivo.
- **La versión queda congelada, y lo fuerza el motor, no el código.** `template_version_id` está
  en el conjunto de columnas que el trigger `scheduled_inspection_guard` rechaza modificar y que
  el `GRANT UPDATE` por columna ni siquiera le concede a `hs_app`. Publicar la v3 de una plantilla
  no toca una inspección ya abierta contra la v2 — no porque nadie escriba ese UPDATE, sino porque
  el UPDATE falla.
- **`inspection_schedule`** — la regla de recurrencia: qué plantilla debe inspeccionarse
  mensualmente en qué sitio, y quién es el inspector por defecto. Es la tabla que el trabajo lee.
  **No estaba nombrada en el alcance pedido y se agrega igual**: sin ella "apertura mensual
  automática por sitio" no tiene entrada, y la alternativa —abrir una inspección por cada plantilla
  activa— convierte cualquier plantilla en una obligación mensual por accidente.
- **Apertura mensual automática con pg-boss.** Un cron diario en zona `America/Toronto` abre, para
  cada regla activa, la inspección del período corriente si todavía no existe. **La idempotencia
  la da un único parcial en la base**, no la bookkeeping del trabajo: correr el trabajo cinco veces
  el mismo día deja una fila.
- **Bootstrap de pg-boss.** Dependencia nueva, esquema `pgboss` propio del planificador, split de
  roles (`hs_migrator` instala, `hs_app` encola y consume), módulo de Nest con arranque y parada
  ordenada, y registro de trabajos. Las tablas de pg-boss son infraestructura mutable: **no** las
  alcanza `hs_make_immutable` ni la política de aislamiento por sitio, y eso queda escrito.
- **El trabajo no tiene sesión.** Corre con un `SiteScope` explícito construido a partir de los
  sitios activos, por la vía `withSiteScope` que ya existe para seeds y comandos. No puede usar
  `withSessionScope` porque no hay nadie detrás, y ese es exactamente el motivo por el que el
  helper distingue las dos entradas.
- **`notification`** — la bandeja del coordinador de HS. Destinatario, sitio, `kind`, payload y
  `read_at`. **No hay correo**: el change de autenticación ya decidió (D9) que no se agrega un
  servidor de correo, así que la notificación es in-app o no es nada. Marcar como leída es el único
  UPDATE que la tabla admite.
- **Listado de lo pendiente por usuario** — `GET /me/pending-inspections`: las inspecciones
  programadas abiertas y asignadas a quien pregunta, ordenadas por vencimiento, con la vencida
  primero. Es la pantalla de inicio del miembro del JHSC.
- **Endpoints del coordinador**: crear y desactivar reglas, programar una inspección fuera de
  calendario, reasignar inspector, cancelar con motivo, y listar lo programado del sitio.

Fuera de alcance, explícito: la tabla `inspection` y sus estados (`borrador` → `enviada`), la
captura de respuestas, el outbox, la ingesta, el PDF y la firma. Este change crea la obligación;
llenarla es el change siguiente. Tampoco: rotación automática del inspector entre los 7 miembros
del JHSC (la regla lleva un inspector por defecto y la reasignación es manual), cadencias que no
sean mensuales, ni recordatorios de vencimiento — el escalamiento por tiempo es la etapa 5 y usa el
mismo planificador que este change deja instalado.

## Capabilities

### New Capabilities

- `inspections`: qué es una inspección programada, cómo se determina su período, por qué su
  `template_version_id` no puede cambiar después de creada, cómo se abre el período de un sitio de
  forma automática e idempotente, quién puede programar, reasignar y cancelar, qué ve un inspector
  como pendiente, y qué notificación recibe el coordinador cuando se abre un período.

### Modified Capabilities

Ninguna. `templates` no cambia: este change **lee** una versión publicada y no altera qué es una
versión ni cómo se publica. `identity` no cambia: usa los roles y el alcance por sitio tal como
están. `immutability` no cambia: `scheduled_inspection` aplica el patrón de mutabilidad parcial que
`location` y `person` ya establecieron, sin agregar mecanismo nuevo.

## Impact

| Área | Efecto |
| --- | --- |
| `apps/api/drizzle` | Migración `0008_inspection_scheduling.sql`: `inspection_schedule`, `scheduled_inspection` y `notification`, con sus triggers de guarda, de prohibición de DELETE/TRUNCATE y de auditoría, `hs_apply_site_isolation` en las tres, y los GRANT por columna. Más el bootstrap del esquema `pgboss` y sus grants. |
| `apps/api/src/db/schema` | Archivo nuevo `inspections.ts` (espejo a mano, como los demás) y `notifications.ts`. |
| `apps/api/src/jobs` | Módulo nuevo: cliente pg-boss, ciclo de vida ligado al de Nest, registro del cron `inspections.open-period` y su handler. |
| `apps/api/src/inspections` | Servicio y controlador de reglas, programación, reasignación, cancelación y pendientes. |
| `apps/api/src/notifications` | Listado y marcado de leído. |
| `packages/contracts` | Esquemas y tipos de los endpoints nuevos. Sin dependencias de Node: nada de esto entra en `packages/forms`. |
| `apps/web` | Ninguno todavía. Consume `GET /me/pending-inspections` en el change de captura offline. |
| Dependencias | `pg-boss` en `apps/api`. Primera pieza de infraestructura nueva desde el bootstrap; ADR-005 ya la justificó y este change no reabre esa decisión. |
| Tablas inmutables | Las tres nacen parcialmente mutables (patrón `location`/`person`), no totalmente inmutables. El conjunto mutable es minúsculo y está enumerado en el diseño. Las tablas de `pgboss` quedan **fuera** del régimen, declarado. |
| Operación | El proceso de API pasa a tener un worker adentro. Un despliegue con dos instancias no puede abrir el período dos veces: lo impide el único parcial, no la cantidad de réplicas. |
