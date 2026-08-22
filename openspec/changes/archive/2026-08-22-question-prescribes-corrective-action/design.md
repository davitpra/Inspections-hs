## Context

Ver `proposal.md` §Why. Lo que condiciona el cómo, y que no está ahí:

- El documento de plantilla —borrador y congelado— lo interpreta `packages/forms`, que viaja
  dentro del bundle del service worker (**ADR-007**): sin builtins de Node, sin reloj, sin azar,
  sin red. Todo lo que se agregue al ítem tiene que ser dato puro y esquema puro.
- `contracts` **depende de** `forms`; `forms` no puede importar de `contracts`. Hoy
  `CONTROL_LEVELS` vive en `packages/contracts/src/findings.ts`, del lado equivocado de esa
  flecha para lo que este change necesita.
- `draftIssues` termina con una red de seguridad: si no encontró ningún issue, parsea
  `normalizeDraft(draft)` contra `templateDocumentSchema` y, si falla, emite el issue genérico
  "This template cannot be published yet". Los ítems de ese esquema son `z.strictObject`.
- `template_draft.document` es una columna `jsonb` sin validación en el motor
  (`0016_template_drafts.sql`), y la proyección a filas la hace el trigger
  `hs_template_project_items()` (`0003_template_model.sql`), que copia ocho columnas del documento
  y deja el resto adentro del `jsonb`.
- La fila de la pregunta ya tiene el botón `Add Finding` con su prop opcional `onAddFinding` sin
  cablear y su clase `.item-editor__corrective`.

**Tablas inmutables: este change no toca ninguna.** No hay migración. `template_draft` es la única
tabla involucrada, su columna `document` ya está en el `GRANT UPDATE` de `0021`, y el campo nuevo
viaja adentro del `jsonb` que esa columna ya guarda.

## Goals / Non-Goals

**Goals:**

- Que la prescripción viva en el ítem del documento, y por lo tanto se mueva, se duplique y se
  guarde con él sin código extra.
- Que el umbral quede escrito hoy sin cambiar una sola derivación de hallazgo.
- Que el sheet sea un editor local: abre con lo que hay, escribe una vez al confirmar.

**Non-Goals:**

- La publicación, que todavía no existe (`0016` deja dicho que el `GRANT INSERT` llega con ella).
- Leer el umbral en `negative.ts`.
- Un endpoint propio para la prescripción. Es una edición del documento como cualquier otra y se
  guarda con el mismo `PUT /templates/drafts/:id`.

## Decisions

### 1. Un bloque `finding` opcional, no tres campos sueltos

```ts
finding: {
  corrective_action: string;
  control_level: ControlLevel;
  fails_when?: { operator: 'lt' | 'lte' | 'gt' | 'gte'; value: number };
}
```

Va en `draftItemBase`, así que lo tienen los nueve tipos.

O la pregunta prescribe algo o no prescribe nada: `finding === undefined` dice eso con un solo
valor. **Alternativa descartada:** tres campos opcionales al lado del `prompt`. Habilita estados
que no significan nada —nivel de control sin acción correctiva, umbral sin ninguna de las dos— y
cada uno tendría que ganarse su propio issue para volver a prohibirlos.

`fails_when` va **adentro** del bloque y no al lado: un umbral sin acción correctiva es un
hallazgo que nadie sabe qué hacer con él. Es opcional adentro porque en `yes_no`/`yes_no_na` la
respuesta que falla ya la fija la spec de `findings`, y escribirla otra vez sería un segundo lugar
donde puede estar mal.

**El bloque es plano y no una tabla.** Podría haber sido una relación `template_item_finding`,
pero un dato que solo tiene sentido dentro del documento que lo contiene —y que se congela con él
cuando la publicación exista— no gana nada partiéndose en una fila que habría que unir en cada
lectura, y perdería el duplicado y el reordenamiento gratis que da estar adentro del `jsonb`.

### 2. El mismo campo va también en el esquema publicado, y es obligatorio hacerlo

Agregar `finding` solo a `draft.ts` no rompe ningún test de esquema: rompe la red de seguridad de
`draftIssues`. Como los ítems de `templateDocumentSchema` son `z.strictObject`, el campo extra
haría fallar el `safeParse` y **todo** borrador que use la función quedaría no publicable con el
mensaje genérico. Así que el mismo `finding` opcional se agrega a `itemBase` en `schema.ts`.

Que el esquema congelado ya lo acepte no adelanta la publicación: no hay quien inserte una
versión. Solo deja de mentir sobre la forma del documento.

### 3. `CONTROL_LEVELS` se muda a `@hs/forms` y `contracts` lo re-exporta

`packages/forms/src/document/controls.ts` (nuevo) pasa a ser el dueño de `CONTROL_LEVELS`,
`controlLevelSchema`, `ControlLevel` y del `FAILURE_OPERATORS` nuevo.
`packages/contracts/src/findings.ts` los re-exporta — el mismo patrón que ya usa
`packages/contracts/src/template-document.ts` con el documento entero, y por la misma razón: que
ningún import existente tenga que cambiar (`apps/api/src/db/schema/findings.ts` sigue leyendo de
`@hs/contracts`).

Son cinco strings sin dependencias: no discute ADR-007.

**Alternativa descartada:** duplicar la lista en `forms`. Dos definiciones de la jerarquía de
controles que pueden separarse, en un dato que un regulador lee.

### 4. Cambiar el tipo de respuesta conserva la prescripción y descarta el umbral

`changeResponseType` hoy reconstruye el ítem desde `item_key`, `prompt`, `required` y
`visible_when` más `defaultItemConfig`. Suma `finding`, pero recortando `fails_when` cuando el
tipo nuevo no puede llevarlo. Es la misma lógica que ya rige la configuración del tipo (spec de
`templates`, "Changing an item's response type replaces its configuration"): lo que dejó de
aplicar se va, y lo que sigue significando lo mismo —qué hacer cuando esto falla— se queda.

Guardarlo igual y taparlo en la interfaz dejaría un borrador no publicable por un campo que el
autor no ve.

### 5. El sheet edita una copia y escribe una vez

`FindingSheet.tsx` es un editor local sobre el `Sheet` compartido de `apps/web/src/app/Sheet.tsx`
(`showModal()` de verdad: foco atrapado, Escape, fondo inerte), montado condicionalmente como
`ManageSitesSheet` en `LocationsRoute`. Guarda su propio estado y llama `onSave(finding | null)`
una sola vez al confirmar.

**Alternativa descartada:** escribir cada tecla en el documento. Cerrar con Escape dejaría el
borrador sucio con media frase, y el sheet es exactamente el gesto en que "cancelar" tiene que
significar algo.

El estado de qué ítem tiene el sheet abierto vive en `SectionCard`, que es quien conoce el índice
del ítem; el documento lo escribe `SectionList` por el mismo camino que las demás ediciones
(`edits.ts` puro → `write`).

### 6. La regla de negación no se toca

`negative.ts` queda intacto y el delta de la spec de `findings` lo dice por escrito. El umbral es
dato del autor; interpretarlo cambia qué se le pide al inspector en campo, y eso es una decisión
que se toma con la otra mitad del builder, no de costado.

## Risks / Trade-offs

- **El campo se agrega solo al esquema del borrador** → falla en silencio como "This template
  cannot be published yet" en cada borrador que lo use. `draft.test.ts` tiene que cubrir
  explícitamente que un borrador completo **con** `finding` es publicable.
- **El umbral escrito y no leído genera expectativa**: un autor puede creer que ya deriva un
  hallazgo. Mitigación: el sheet lo dice en el texto de ayuda del campo, y la spec de `findings`
  lo fija con un escenario.
- **`CONTROL_LEVELS` cambia de dueño** → si algún import quedara apuntando al archivo viejo, no
  compila. Es el modo de fallar correcto, y `pnpm -r build` antes de `typecheck` lo encuentra.
- **El bundle del service worker crece** con el sheet nuevo. `scripts/check-service-worker.mjs`
  compara contra un presupuesto escrito; si lo pasa, la conversación es sobre el presupuesto.
- **La prescripción no llega a la acción correctiva.** Hasta que un change la conecte, el
  coordinador sigue escribiendo la descripción a mano y el dato queda solo escrito. Es el precio
  de partir el trabajo por la mitad donde no hay migración.
