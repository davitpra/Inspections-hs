## Why

**No cierra ninguna etapa de §7, y por eso hay que justificar que exista.** Es un retiro
dentro de la etapa 8 —el builder visual— que le saca al borrador una pieza que hoy tiene:
el lock optimista de `revision`.

El lock se escribió contra un caso concreto, y está argumentado en el propio código
(`0016_template_drafts.sql:59-62`): «dos ventanas del mismo autor sobre el mismo borrador
es el caso normal, no el raro, y sin esto la segunda pisa a la primera en silencio». El
argumento describe bien lo que pasa. Lo que no hace es cuadrar con ADR-001, que ya decidió
lo contrario para el resto del sistema: un dueño, un dispositivo, un firmante, y **se
acepta perder borradores**. La sincronización multi-dispositivo de un mismo documento está
fuera de alcance en v1 por decisión, no por falta de tiempo.

Sostener el lock significa sostener en el borrador de plantilla una garantía que ninguna
otra escritura del producto ofrece: el editor de inspecciones no la tiene, el outbox no la
tiene, y ADR-001 dice explícitamente que la corrección la garantiza el servidor con
`client_submission_id`, no un chequeo en el cliente. Un solo lugar con reglas de
concurrencia propias es más caro de mantener y de explicar que la regla uniforme.

**Se retira sabiendo lo que se pierde**, que es exactamente lo que 0016 §1 anticipó: dos
ventanas abiertas sobre el mismo borrador, la segunda que guarda descarta lo que escribió
la primera y nadie se entera. No hay mitigación en este change. Es el precio, está
declarado, y quien lea esto dentro de un año tiene que poder ver que fue una decisión y no
un olvido.

**Precondición** — `template-scope-and-builder-console` todavía no está archivado y su
delta menciona `revision` en cinco lugares, incluido un escenario completo de guardado
stale. Archivarlo antes de implementar este change, para que el requisito a retirar viva
en un solo archivo y la delta de acá no tenga que perseguirlo en dos.

## What Changes

- **Se va la columna.** `template_draft.revision` y su `CONSTRAINT
  template_draft_revision_check`, en una migración nueva que además **reescribe entera** la
  lista del `GRANT UPDATE` —no un `REVOKE` suelto— por la convención de 0016 §4 y 0020 §4:
  leer una sola sentencia tiene que alcanzar para saber qué puede escribir la aplicación.
- **Se va el lock del `UPDATE`.** El `WHERE` pierde `AND revision = $4` y el `SET` pierde
  `revision = revision + 1`. Queda `WHERE id = $1 AND discarded_at IS NULL`: un guardado
  sobre un borrador vivo siempre se aplica, y el último gana.
- **Se va el 409.** `templateDraftStale` desaparece de `templates.errors.ts`. Cero filas
  afectadas pasa a significar una sola cosa —el borrador no existe o fue descartado— así
  que la lectura de seguimiento que hoy distingue los dos casos deja de tener sentido.
- **BREAKING (contrato interno)** — `templateDraftSummarySchema` y
  `saveTemplateDraftSchema` son `strictObject`: al salir `revision`, un cliente viejo que
  lo mande recibe un rechazo de validación. No hay clientes fuera de este repo.
- **La UI deja de numerar.** El encabezado dice `Saved` / `Unsaved changes` en vez de
  `Saved revision N`. Con el lock retirado, el número dejó de ser información que el autor
  pueda usar para algo.
- **Lo que NO cambia, y es deliberado**: `site_ids` sigue viajando dentro del mismo
  guardado que el documento. El motivo escrito hoy —«tiene que quedar bajo el mismo lock»—
  deja de valer, pero la decisión no depende de él: cambiar el alcance es una edición como
  cualquier otra. Se reescribe el argumento, no el diseño. Tampoco cambia nada del guardado
  explícito: sigue sin haber autosave, ahora porque el autor merece saber cuándo escribió,
  no porque un lock lo exija.

## Capabilities

### New Capabilities

Ninguna. El change solo retira requisitos de `templates`.

### Modified Capabilities

- `templates`: el borrador deja de llevar `revision`; un guardado sobre un borrador vivo
  siempre se aplica y el último gana, sin detección de escritura concurrente.

## Impact

**Esquema** — `apps/api/drizzle/0021_retire_template_draft_revision.sql`: `DROP COLUMN
revision` sobre `template_draft` y la lista completa del `GRANT UPDATE` reescrita. No toca
ninguna tabla inmutable, y no toca los triggers de 0016 §3: borrar sigue prohibido para
todos los roles. Sigue sin RLS por sitio, por lo que ya explican 0016 §5 y 0020 §5.

**Contratos** — `packages/contracts/src/templates.ts`. `packages/forms` **no se toca**:
`revision` nunca fue parte del documento y no viaja al service worker.

**API** — `apps/api/src/templates/{templates.repository.ts,templates.service.ts,templates.errors.ts}`
y el espejo Drizzle `apps/api/src/db/schema/templates.ts`. Sin cambio de firma en el
controller: `PUT /templates/drafts/:id` sigue siendo el mismo endpoint con un campo menos
en el cuerpo.

**Web** — `apps/web/src/routes/TemplateDraftRoute/` (`index.tsx`, `DraftHeader.tsx`,
`presentation.ts`) y el docblock de `apps/web/src/api/templates.ts`, que hoy documenta un
error que dejará de existir.

**Tests** — el grueso del trabajo está acá, no en el código. `template-drafts.int-spec.ts`
menciona `revision` en unas treinta líneas. Dos casos de guardado stale se borran; el test
de privilegios de `:110-121` **no**, porque usa `revision = revision + 1` para comprobar
que el `GRANT UPDATE` funciona y hay que reescribirlo contra `name`/`document`.

**Fuera de alcance** — publicar sigue sin existir (segunda mitad de etapa 8). Este change
no lo acerca ni lo aleja.
