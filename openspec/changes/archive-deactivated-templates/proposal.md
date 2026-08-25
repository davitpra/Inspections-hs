## Why

Una plantilla retirada permanece en la consola de autoría para poder reactivarla, y con razón: si desapareciera no habría forma de volver a ofrecerla. Pero el catálogo crece con plantillas que el coordinador ya no piensa reutilizar, y todas se leen con el mismo peso que las vigentes en la única tabla donde se busca una plantilla por su nombre.

Este change no cierra una etapa nueva de `docs/requisitos-v1.2.md` §7: completa la administración del catálogo publicado ya entregada con la misma distinción entre «retirado» y «archivado» que la consola de programación tiene para los requisitos de inspección, sin tocar la congelación de versiones ni las inspecciones que las nombran.

## What Changes

- Permitir que el coordinador archive una plantilla publicada únicamente después de retirarla.
- Ocultar por defecto las plantillas archivadas de la tabla de publicadas y ofrecer un control `Show archived` para verlas.
- Ofrecer `Restore` como única acción sobre una archivada: reactivar exige restaurarla antes, para que cada decisión quede registrada por separado.
- Mantener las plantillas archivadas en la base, legibles por su propio identificador y como referencia de las inspecciones que se hicieron con ellas; archivar solo cambia su presencia en la tabla de administración.
- Conservar la tabla sin controles de archivo para cualquier cuenta que no sea el coordinador, como ya ocurre con retirar y reactivar.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `templates`: ciclo de archivo, restauración y visibilidad de plantillas publicadas retiradas en la consola de autoría.

## Impact

- Nueva columna `template.archived_at` con `CHECK (archived_at IS NULL OR deactivated_at IS NOT NULL)` y privilegios `UPDATE` por columna para `hs_app`, en la línea de `0033`.
- Extensión del contrato `PublishedTemplateSummary` y dos rutas nuevas, `POST /templates/:id/archive` y `POST /templates/:id/restore`, con sus errores declarados.
- Cambios en `TemplatesService`, en el cliente web de plantillas y en la tarjeta de publicadas de `TemplatesRoute`, sin tocar el borrador, la publicación ni la lectura de una versión.
- Sin cambios en `audit`: `audit_log` es una cadena por planta y una plantilla no pertenece a ninguna, el mismo argumento por el que `0033` no auditó la baja.
- Pruebas de contratos, integración PostgreSQL, presentación y ruta web.
