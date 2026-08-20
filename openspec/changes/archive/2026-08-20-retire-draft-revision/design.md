## Context

Ver `proposal.md` — Why. Acá solo el estado actual que condiciona el cómo.

`template_draft` es la única tabla del esquema con `GRANT UPDATE`. La razón está en 0016 §3:
no se llama a `hs_make_immutable()` porque esa función revoca también el UPDATE, y esta
tabla lo necesita; se toma solo la mitad del DELETE y la otra queda en la lista explícita de
0016 §4. Retirar `revision` no toca ese arreglo, pero sí toca la lista, que es el lugar donde
el esquema declara qué puede escribir la aplicación.

El lock vive en una sola sentencia (`templates.repository.ts`): `revision = revision + 1` en
el `SET` y `revision = $4` en el `WHERE`, juntos a propósito para que no haya lectura previa
que pueda quedar vieja entre el chequeo y la escritura. Cero filas afectadas significa hoy
dos cosas —revisión vieja o borrador descartado— y el servicio las separa con una lectura de
seguimiento para poder devolver 409 o 404 según corresponda.

`revision` no está en `packages/forms` ni en el documento: nunca viajó al service worker, así
que ADR-007 no entra en este change.

## Goals / Non-Goals

**Goals:**

- Que la ausencia del lock quede argumentada en la migración, no solo en este documento. Quien
  audite los `GRANT` de `template_draft` dentro de un año tiene que poder ver que la
  concurrencia se retiró a propósito.
- Que el `UPDATE` quede con un solo motivo para devolver cero filas, para que el servicio no
  necesite adivinar cuál de dos cosas pasó.
- Que el vocabulario de la interfaz deje de prometer algo que el servidor ya no hace.

**Non-Goals:**

- **No se sustituye el lock por otra cosa.** Ni `updated_at` como testigo, ni un aviso de
  «alguien más está editando», ni un merge. La decisión es retirar la garantía, no
  reimplementarla más barata.
- **No se toca el guardado explícito.** Sigue sin haber autosave. El motivo cambia —antes lo
  pedía el lock, ahora lo pide que el autor sepa cuándo escribió— pero el comportamiento no.
- **No se toca publicar**, que sigue sin existir.

## Decisions

**El `GRANT UPDATE` se reescribe entero, no se hace `REVOKE UPDATE (revision)`.** El `DROP
COLUMN` ya se lleva el privilegio de esa columna, así que un `REVOKE` sería además redundante.
Pero incluso siendo redundante, la alternativa —dejar el `GRANT` de 0020 como última palabra—
rompe la convención que 0016 §4 y 0020 §4 sostienen explícitamente: leer una sola sentencia
tiene que alcanzar para saber qué es mutable. Se paga una sentencia de más para que la lista
completa siga estando en el último archivo que la tocó.

**La lectura de seguimiento del servicio desaparece, no se conserva "por las dudas".** Con
`AND revision = $4` fuera del `WHERE`, cero filas solo puede significar que la fila no está o
que está descartada, y las dos son `templateDraftNotFound()`. La alternativa era dejar la
lectura y devolver siempre 404: mismo resultado, un viaje más a la base y un lector futuro
preguntándose qué caso está cubriendo. Se borra.

**`site_ids` se queda dentro del mismo `UPDATE`.** El argumento escrito hoy en los contratos
—«tiene que quedar bajo el mismo lock»— se cae con el lock, y la tentación es leer eso como
que ahora da igual partirlo en dos endpoints. No da igual: cambiar el alcance sigue siendo una
edición del borrador, y el guardado sigue siendo uno solo porque el autor aprieta un botón una
vez. Se reescribe el comentario y se deja el diseño donde está.

**El encabezado dice `Saved`, no `Saved`+algo.** La alternativa era mostrar la hora del último
guardado (`updated_at`), que sí existe. Se descarta: una hora invita exactamente a la lectura
que este change elimina —«¿esto es lo mío o lo de la otra ventana?»— y la respuesta honesta es
que el autor no puede saberlo. Mejor no sugerir la pregunta.

**El test de privilegios se reescribe, no se borra.** `template-drafts.int-spec.ts:110-121`
usa `revision = revision + 1` como sonda para comprobar que `hs_app` puede escribir la tabla.
Esa comprobación —que el `GRANT UPDATE` de la migración funciona y que la tabla no quedó
inmutable por accidente— es justamente la que más importa después de tocar los privilegios.
Se reapunta a `name` y `document`, que siguen en la lista.

## Risks / Trade-offs

**Dos ventanas del mismo autor: la segunda pisa a la primera en silencio** → **Sin
mitigación, y es el punto del change.** Está declarado en el proposal, en el requisito
`REMOVED` de la spec y —tarea 1.4— en la migración. No se agrega un aviso en la UI: un cartel
que diga «puede que alguien más esté editando» sin poder decir si lo hay es ruido, no una
garantía parcial.

**Un cliente viejo sigue mandando `revision`** → Los esquemas son `strictObject`, así que el
guardado se rechaza con un error de validación en vez de aplicarse a medias. Es ruidoso y es
lo correcto: no hay clientes fuera de este repo, y la PWA se sirve desde el mismo despliegue.

**El `DROP COLUMN` es irreversible** → No hay datos que perder: un contador de escrituras no
reconstruye ningún documento. El rollback es `git revert` de la migración más un `ADD COLUMN
revision integer NOT NULL DEFAULT 1`, que deja todo borrador vivo en revisión 1 sin
consecuencia observable, porque el lock se compara contra lo que el cliente acaba de leer.

**La delta `MODIFIED` no aplica si se archiva en el orden equivocado** → El requisito «A draft
declares the plants it is written for» todavía vive en el change
`template-scope-and-builder-console`, no en el spec principal. Archivar ese change primero es
la tarea 0.1 y existe por esto.

## Migration Plan

1. Archivar `template-scope-and-builder-console` (`/opsx:archive`), para que el requisito que
   este change modifica esté en `openspec/specs/templates/spec.md`.
2. `0021_retire_template_draft_revision.sql` — `DROP COLUMN` (se lleva el `CHECK`) y la lista
   completa del `GRANT UPDATE` reescrita.
3. Código y contratos en el mismo commit que la migración. No hay ventana de compatibilidad
   que sostener: un despliegue, un cliente.
4. Verificación en `pnpm --filter api test:int`, que corre la migración contra Postgres real.

**Rollback**: `git revert` del commit. La columna vuelve con `DEFAULT 1` y los borradores
vivos arrancan en revisión 1; ningún documento se pierde en ninguna de las dos direcciones.
