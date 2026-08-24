# Design — Revisar una plantilla publicada

## Context

ADR-002 y ADR-004: la inmutabilidad la fuerza el motor. `template_version` y
`template_version_item` pasaron por `hs_make_immutable` en 0003 §8; 0003 §9 revocó
`UPDATE`/`DELETE` sobre `template` y `template_item`; 0025 §1 devolvió solo `INSERT` sobre las
cuatro tablas publicadas. Este change no pide ni un permiso más. Corregir una plantilla es
escribir una fila nueva, no tocar una vieja, y esa frase es literalmente el conjunto de
privilegios que tiene `hs_app`.

ADR-007: `draftFromDocument` va en `packages/forms` porque es la inversa exacta de
`normalizeDraft`, que ya vive ahí. Es pura y no toca reloj, azar ni red.

El estado de partida está en `openspec/specs/templates/spec.md`. Los requisitos de identidad
dual (`### Requirement: An item carries two separate identifiers`), de supervivencia del
`item_key` (`### Requirement: item_key survives every kind of edit`) y de recurrencia
contigua (`### Requirement: Recurrence across three versions returns one series`) están todos
escritos en términos de v1 → v2 → v3 y hoy no los puede satisfacer ningún camino de
aplicación: la segunda versión solo la puede escribir un seed corriendo como `hs_migrator`.

## Goals / Non-Goals

**Goals**

- Que el coordinador corrija una plantilla publicada sin perder la serie de recurrencia.
- Que la versión nueva sea `max + 1` de la misma plantilla, decidido por el motor.
- Que un `item_key` sembrado llegue intacto a la versión nueva, sin que el autor pueda
  moverlo por accidente.

**Non-Goals**

- Dar de baja plantillas o preguntas (`deactivated_at`); renombrar una plantilla publicada;
  historial de versiones; duplicar una plantilla como plantilla nueva; aprobación.

## Decisions

### El borrador de revisión es un `template_draft` con `template_id`

Una columna nullable con FK a `template`. Nula significa «este borrador va a crear una
plantilla», no nula significa «este borrador va a agregarle una versión a esta».

La alternativa era una tabla aparte para las revisiones. Se descarta: un borrador de revisión
se escribe con el mismo editor, se guarda con el mismo `PUT`, se descarta con el mismo
`POST .../discard` y se publica con el mismo `POST .../publish`. Dos tablas serían dos
juegos de las mismas cinco operaciones para distinguir una cosa que ya distingue una columna.

La columna es **write-once**: no entra en el `GRANT UPDATE` de `template_draft`, igual que
`key` y `created_by`. Un borrador no cambia de plantilla a mitad de camino, y que eso sea
imposible en el motor y no en un `if` es la línea de ADR-002.

### La clave y el nombre los HEREDA de la plantilla; no se derivan del nombre

Un borrador de revisión nace con `key` y `name` copiados de la fila `template`. No pasa por
`templateKeyFromName`: la clave ya existe y derivarla de nuevo del nombre podría dar otra —el
nombre pudo haber cambiado de estilo, o la clave pudo venir de un seed que la escribió a mano.

Consecuencia: el borrador lleva a propósito la misma clave y el mismo nombre que una plantilla
publicada, que es exactamente lo que `template_draft_key_live_idx`,
`template_draft_name_live_idx` e `isNameTaken` existen para prohibir. Los tres se reescriben
para contar solo los borradores con `template_id IS NULL`. La unicidad que protegían no se
pierde: sigue habiendo una sola fila `template` con esa clave, y sigue siendo `template.key
UNIQUE` quien lo garantiza.

### Un borrador de revisión vivo por plantilla, y `revise` es idempotente

`template_draft_revision_live_idx` — unicidad parcial sobre `template_id` donde
`template_id IS NOT NULL AND discarded_at IS NULL AND published_at IS NULL`.

Dos revisiones vivas de la misma plantilla serían dos correcciones que no se ven entre sí y
que al publicarse se pisan: la segunda saldría como versión 3 sin contener nada de la 2. Y no
hay forma honesta de fusionarlas.

Por eso `POST /templates/:templateId/revisions` **no falla** si ya hay una viva: devuelve esa.
El botón «Revise» de una plantilla que ya se está revisando lleva al trabajo en curso, que es
lo que el coordinador quiere que pase. Un `409` obligaría a la pantalla a buscar en el listado
de borradores cuál era.

### El número de versión lo decide el motor, no el servicio

`insertVersion` deja de escribir `1` y pasa a escribir
`coalesce(max(version), 0) + 1` leído en el mismo `INSERT ... SELECT`. Eso vale para las dos
ramas: en una plantilla recién insertada el máximo es cero y sale 1, sin ninguna rama especial.

El cálculo no es la garantía. La garantía es `hs_template_version_next()`, que toma
`pg_advisory_xact_lock` sobre la plantilla, recalcula y levanta `HS002` si no coincide. Dos
publicaciones concurrentes se serializan en ese lock y la segunda muere; con la unicidad de
arriba, en la práctica no puede haber dos.

### `registerItems` registra solo lo nuevo, y verifica lo viejo

Antes de escribir, el servicio lee `template_item` para los `item_key` del documento y los
parte en tres:

- **De esta plantilla y activo** → no se registra nada. Es el caso normal de una revisión.
- **De otra plantilla** → `template_item_key_taken`, igual que hoy. `item_key` es global y
  write-once: dos plantillas no comparten un concepto.
- **Desactivado** → `template_item_deactivated`. La spec ya lo exige
  (`### Requirement: Items are deactivated, never deleted`) y hasta hoy no había forma de
  llegar al caso, porque no había una versión N+1.

Lo que queda —los no registrados— es lo que `registerItems` inserta. Un `ON CONFLICT DO
NOTHING` habría sido más corto y habría aceptado en silencio un `item_key` de otra plantilla,
que es el error que más caro sale: la serie de recurrencia de dos plantillas quedaría fundida.

### Una pregunta que se saca queda ausente, no desactivada

Sacar la pregunta 4 en la v2 la deja fuera del documento de la v2 y nada más. Su fila
`template_item` sigue activa, las `template_version_item` de la v1 la siguen resolviendo, y
agrupar hallazgos por `item_key` sigue devolviendo su serie, ahora terminada.

Desactivarla sería una decisión distinta —«esta pregunta no se vuelve a hacer nunca»— que el
autor no está tomando cuando borra una fila del editor, y que además necesitaría `UPDATE` sobre
`template_item`, que es justo lo que 0003 §9 revocó.

### El nombre no se puede cambiar en una revisión

`saveDraft` rechaza con `template_draft_name_locked` un nombre distinto del que el borrador
tiene, cuando el borrador es una revisión. No es una restricción inventada: `template.name` no
se puede actualizar —`hs_app` no tiene `UPDATE` sobre `template`—, así que un nombre editable
en el editor sería un campo que se guarda en el borrador, se muestra en el builder y después
la publicación ignora, dejando dos respuestas a la misma pregunta.

El editor lo muestra de solo lectura junto a la clave, que ya se muestra así por la misma
razón.

### El borrador se liga a la PLANTILLA, no a la versión que se sembró

No se guarda de qué versión salió el documento. La pregunta que la pantalla hace es «¿qué
número va a tener lo que publique?», y eso es `max + 1` leído cuando se pregunta —`next_version`
en el DTO del borrador—. Guardar la versión de origen crearía un estado a detectar («el
borrador quedó viejo») cuyo único desenlace posible sería igual publicar sobre `max + 1`.

Con una sola revisión viva por plantilla, la única forma de que aparezca una versión nueva en
el medio es un seed corriendo como `hs_migrator`, y ahí el número que la pantalla muestra se
actualiza solo en la siguiente lectura.

## Risks / Trade-offs

- **Un `item_key` sembrado se conserva aunque la pregunta cambie de sentido.** Reformular
  «¿Hay guardas?» hasta convertirla en otra pregunta une dos series que no son una. Es el
  riesgo A de `docs/Requisitos_V1.2.md` §5 y la spec ya lo resuelve con
  `replaces_item_key`; escribirlo desde el editor es otro change. Mientras tanto el editor no
  deja tocar la clave, que es el lado seguro: unir de más se ve en los datos, partir de más
  no se puede deshacer.
- **La clave de un borrador de revisión ya no es única entre borradores vivos.** Dos
  revisiones de dos plantillas distintas no chocan porque sus plantillas no chocan; dos de la
  misma no pueden existir por el índice nuevo. La combinación de los dos índices cubre lo que
  cubría el viejo.
- **`next_version` es una lectura, no una promesa.** Entre que la pantalla lo muestra y la
  publicación corre, un seed podría meter una versión. El número que queda escrito es el que
  el motor decide, y la respuesta de la publicación lo informa.

## Migration Plan

`0028_revise_published_template.sql`, escrita a mano (`drizzle-kit generate` está prohibido):

1. `ALTER TABLE template_draft ADD COLUMN template_id uuid REFERENCES template (id)`.
2. `CREATE UNIQUE INDEX template_draft_revision_live_idx ON template_draft (template_id)
   WHERE template_id IS NOT NULL AND discarded_at IS NULL AND published_at IS NULL`.
3. `template_draft_key_live_idx` y `template_draft_name_live_idx` recreados con
   `AND template_id IS NULL`.
4. Sin cambios en el `GRANT UPDATE`: `template_id` es write-once por omisión.

Sin backfill: toda fila existente tiene `template_id` nulo, que es lo correcto —son borradores
de plantillas nuevas—. Ningún `GRANT` nuevo sobre el modelo publicado; ninguna fila publicada
se modifica.
