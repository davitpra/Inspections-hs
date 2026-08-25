## Context

Ver `proposal.md` — Why. `template` es una cabecera casi inmutable: `0003` §9 revocó todo el UPDATE de `hs_app` y `0033` volvió a conceder una sola columna, `deactivated_at`, junto con `hs_template_guard` y el trigger `template_guard` que congelan `id`, `key` y `created_at`. La tabla **no lleva `site_id`**: una plantilla es contenido de referencia de la organización, no un dato de planta, y por eso no tiene política RLS ni cadena de auditoría propia.

`GET /templates` (lo programable) y `GET /templates/published` (el catálogo para administrarlo) ya son dos consultas distintas a propósito: la primera filtra por `deactivated_at`, la segunda no filtra nada porque una retirada tiene que poder reactivarse. Aplican ADR-002 para las barreras del motor y ADR-008 para dejar la decisión dentro del módulo `templates`.

## Goals / Non-Goals

**Goals:**

- Separar el retiro del catálogo (qué se puede programar) del retiro de la vista (qué se administra todos los días).
- Hacer el archivo persistente, reversible y protegido por el motor, no por una preferencia del navegador.
- Reusar el vocabulario y los gestos que la consola de programación ya estableció para los requisitos.

**Non-Goals:**

- Borrar plantillas, versiones o el `key` que ocupan.
- Permitir archivar una plantilla activa, o reactivar una archivada en un solo acto.
- Auditar el archivo: `audit_log` es una cadena por planta y una plantilla no pertenece a ninguna (el argumento de `0033`).
- Tocar el borrador, la publicación, la revisión o la lectura de una versión por su identificador.

## Decisions

### `archived_at` es una marca de presentación, con el `CHECK` que lo dice

Se agrega `template.archived_at timestamptz` con `CHECK (archived_at IS NULL OR deactivated_at IS NOT NULL)`, exactamente como `0032` lo hizo para `inspection_schedule`. La invariante «archivado ⇒ retirado» queda en el motor y no en el servicio, así que ningún seed ni comando de servidor puede dejar una fila archivada y ofrecible.

Se descarta guardar la lista de archivadas en `localStorage`: no sobreviviría a otro dispositivo y dejaría a dos coordinadores viendo catálogos distintos. Se descarta reutilizar `deactivated_at` porque eso ya significa otra cosa —qué se ofrece al programar— y `GET /templates` la lee.

### Dos rutas nuevas y no un PATCH

`POST /templates/:id/archive` y `POST /templates/:id/restore`, siguiendo el par `deactivate`/`reactivate` que la consola ya tiene y que el controlador declara con `@Post` y cuerpo vacío. No se copia el `PATCH` con `archived?: boolean` de `inspection-schedules`: ahí el PATCH ya existía para el inspector por defecto, y acá introducirlo obligaría a inventar un contrato de actualización parcial para una tabla cuyo único UPDATE permitido son dos columnas de baja.

El privilegio se concede reafirmando la lista completa, para no heredar un UPDATE amplio por accidente:

```sql
REVOKE UPDATE ON template FROM hs_app;
GRANT UPDATE (deactivated_at, archived_at) ON template TO hs_app;
```

### Restaurar no reactiva, y reactivar no restaura

`restore` limpia `archived_at` y deja `deactivated_at` como está; la plantilla vuelve a la tabla como `Deactivated`. `reactivate` gana un predicado `AND archived_at IS NULL` y un error propio cuando la fila está archivada, en vez de dejar que el `CHECK` conteste con una violación de restricción: el coordinador tiene que leer «restaurala primero», no un error del motor.

Cada UPDATE lleva su estado esperado en el `WHERE` (`archived_at IS NULL` para archivar, `IS NOT NULL` para restaurar, `deactivated_at IS NOT NULL` para archivar) y decide por `rowCount`, con `templateExists` para distinguir «no existe» de «llegó tarde». Sin `SELECT ... FOR UPDATE`, por lo mismo que `deactivate`: bloquear la fila exige el privilegio de tabla entero, que es justo lo que el modelo no concede.

### El filtrado ocurre en el servidor y la tabla lo compone

`listPublished` sigue devolviendo el catálogo entero —incluidas las archivadas— con `archived_at` proyectado. Es el mismo argumento que ya está escrito en su comentario: si el endpoint filtrara, `Show archived` no tendría qué mostrar. `PublishedTemplates` deriva dos conjuntos, como `RequirementsSection`: las no archivadas y, tras el toggle, también las archivadas.

`GET /templates` no cambia una línea: ya filtra por `deactivated_at`, y toda archivada está retirada por el `CHECK`.

### El menú de la fila dice qué acto queda disponible

Activa → `Edit template`, `Deactivate template`. Retirada → `Reactivate template`, `Archive template`. Archivada → `Restore`, y nada más. Es el mismo reparto que `RequirementRow`, y evita ofrecer un acto que el servidor va a rechazar.

Archivar se confirma con un modal —cambia lo que el coordinador ve mañana en su tabla— y restaurar no pregunta, porque devuelve una fila en vez de quitarla. La confirmación es la misma pieza que ya existe para retirar (`DeactivateTemplateDialog`), que se generaliza o se acompaña de una hermana según cuánto texto compartan.

## Risks / Trade-offs

- [Archivar podría leerse como una segunda desactivación] → El `CHECK` obliga a retirar antes, el estado se muestra como `Archived` y la fila solo ofrece `Restore`; nunca hay dos caminos para dejar de ofrecer una plantilla.
- [Una plantilla archivada sigue ocupando su `key`] → Es deliberado: el `key` es global y write-once (`0003` §7); archivar no lo libera, y publicar una plantilla nueva con ese nombre seguiría rechazándose con el mismo error de siempre.
- [Sin auditoría, el archivo no deja rastro regulatorio] → Aceptado y explícito: escribirlo en la cadena de una planta elegida al azar registraría un hecho que no ocurrió ahí. El archivo no cambia ninguna obligación, que es lo que la cadena tiene que poder demostrar.
- [Dos pestañas archivando a la vez] → La segunda no encuentra fila (`archived_at IS NULL` en el `WHERE`) y recibe «ya está archivada», igual que hoy con retirar.

## Migration Plan

1. `0034_archive_deactivated_templates.sql`: agregar `archived_at` y el `CHECK` con todas las filas existentes en null; reafirmar `REVOKE UPDATE` y conceder `UPDATE (deactivated_at, archived_at)`. `template_guard` no cambia: sigue congelando `id`, `key` y `created_at`.
2. Actualizar el espejo Drizzle de `template` a mano (`drizzle-kit generate` está prohibido, ADR-004).
3. Desplegar contratos, API y web juntos; `archived_at` es obligatorio en la respuesta y todas las filas migradas devuelven null.

Rollback: retirar primero el uso desde la aplicación —la tabla vuelve a listar todo— y después eliminar restricción y columna en una migración explícita, devolviendo el GRANT a `(deactivated_at)`.
