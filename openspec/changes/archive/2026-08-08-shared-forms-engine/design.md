## Context

Ver `proposal.md` — Why. Restricciones que dan forma al diseño y que no se re-discuten acá:

- **ADR-007** — `packages/forms` viaja dentro del bundle del service worker: sin builtins de
  Node, sin globals de Node. La regla ya está escrita en `eslint.config.js` (bloque
  `forbidNodeBuiltins`, derivado de `builtinModules`).
- **ADR-001** — las fotos y la firma no viajan dentro del payload del envío. Se suben antes con
  presigned URLs y el envío referencia object keys.
- **ADR-002** — `template_version` y `template_version_item` son tablas inmutables: `REVOKE
  UPDATE, DELETE` al rol de aplicación más trigger. Esto importa para la migración de este change.

Estado de partida: `packages/contracts/src/template-document.ts` define hoy el documento (cuatro
tipos de respuesta, ítem plano, sin lógica condicional). `apps/api/drizzle/0003_template_model.sql`
duplica esa lista en un `CHECK` sobre `template_version_item.response_type` y proyecta el documento
a filas con un trigger `BEFORE INSERT` sobre `template_version`. `packages/forms/src/index.ts` es
un esqueleto con `isAnswered`.

**Tablas inmutables tocadas: sí.** `template_version_item` cambia su `CHECK` de `response_type` y
gana columnas derivadas; `template_version` cambia la función del trigger de proyección. Las dos
son operaciones DDL con el rol `hs_migrator`. Ninguna fila existente se actualiza ni se borra —
ver la sección de migración.

## Goals / Non-Goals

**Goals:**

- Una sola definición del documento, importable por cliente y servidor, con los nueve tipos de
  ítem y la lógica condicional.
- Validación de un conjunto de respuestas como función pura, con la lista completa de violaciones.
- Una tabla de casos ejecutada en los dos entornos, de modo que la divergencia sea un fallo de CI
  y no una inspección perdida.

**Non-Goals:**

- Render. El motor devuelve visibilidad y violaciones; quién dibuja un `single_choice` como radio
  o como select es del change de captura offline.
- i18n de los mensajes de violación. La violación lleva un `code` estable y los datos del
  contexto; el texto en inglés se arma donde se muestra.
- Persistencia de respuestas, outbox, ingesta. El motor no conoce `inspection` ni `submission`.
- Validaciones que dependen del estado de la base: que una `item_key` esté registrada o
  desactivada, que la versión sea la siguiente. Eso ya son FKs y triggers de la migración `0003`.

## Decisions

### El documento se muda a `packages/forms`; `@hs/contracts` lo re-exporta

`packages/forms` pasa a ser dueño de `templateDocumentSchema` y de los tipos de ítem.
`packages/contracts/src/template-document.ts` queda como una línea de re-export, así que
`apps/api` (esquema Drizzle, tests, seeds) no cambia un solo import.

Por qué en esa dirección: el documento es la **entrada del motor**, no un contrato de
request/response. ADR-007 separa los dos paquetes por esa razón. Además el motor no puede
depender de `@hs/contracts` sin arrastrar al service worker esquemas de endpoints que el
dispositivo no usa.

Alternativa descartada: dejarlo en `contracts` y que `forms` dependa de él. Menos churn hoy, pero
invierte la dirección de la dependencia respecto de lo que los paquetes significan, y el día que
`contracts` gane un esquema pesado el service worker se lo come entero.

`zod` pasa a ser dependencia de `packages/forms`. No viola ADR-007: es isomórfico y no toca
builtins de Node. La regla de lint verifica exactamente eso y no "cero dependencias".

### El ítem es una unión discriminada por `response_type`

Cada tipo declara con `strictObject` los campos de configuración que le corresponden y ninguno
más. Un `text` con `options` falla en el parse, no en la primera inspección. Es el mismo criterio
que ya justifica el `strictObject` de hoy.

Alternativa descartada: un objeto plano con todos los campos opcionales. Parsea cualquier
combinación sin sentido y empuja la validación real al render.

`single_choice` y `multi_choice` son tipos separados en vez de un `choice` con `multiple: boolean`:
el tipo de la respuesta (`string` contra `string[]`) queda determinado por el discriminante, sin
que cada validador y cada render tengan que ramificar sobre un flag.

### `visible_when` solo mira hacia atrás

Una condición nombra un `item_key`, un `operator` y — salvo `answered` / `unanswered` — un `value`.
La composición es un nivel: una condición sola, o `all_of` / `any_of` de condiciones. Sin
anidamiento arbitrario.

La restricción que hace todo lo demás fácil es que el `item_key` referenciado tiene que aparecer
**estrictamente antes** en orden de documento. Con eso la visibilidad se resuelve en una sola
pasada hacia adelante, no hay ciclos que detectar, y el resultado no depende del orden de
evaluación. La verificación es de carga: un documento con referencia hacia adelante o a una key
inexistente no publica.

Alternativa descartada: expresiones arbitrarias (una mini gramática, o `jsonLogic`). Resuelven
casos que ninguna plantilla de inspección de v1 tiene, y cada operador extra es un operador más
que cliente y servidor pueden interpretar distinto.

Un ítem oculto no se exige y **no puede traer respuesta**. Aceptar en silencio la respuesta de un
ítem oculto haría que dos dispositivos con el mismo documento produjeran registros distintos según
en qué orden el inspector cambió de opinión.

### La validación devuelve violaciones, no lanza

`validateAnswers(document, answers)` devuelve `{ ok: true }` o `{ ok: false, violations: [...] }`,
con una violación por `item_key` ofensora y un `code` estable (`required_missing`,
`out_of_range`, `unknown_item`, `answer_for_hidden_item`, …). El servidor mapea esa lista a su
respuesta de error; el cliente la mapea a marcas por ítem. Un `throw` en la primera violación
obligaría al inspector a descubrir los errores de a uno.

### Foto y firma son object keys, no blobs

Coherente con ADR-001: la respuesta de un `photo` es un array de object keys y la de un
`signature` es `{ object_key, signed_at }`. El motor valida forma y cardinalidad; que la key
exista en el object storage lo verifica la ingesta, que sí tiene red.

### La tabla de casos es un dato, no un test

Los casos viven en un módulo del paquete (`document + answers + verdicto esperado`), sin
`describe` ni `it`. Los tests unitarios de `packages/forms` iteran sobre él, y la suite de
integración de `apps/api` itera sobre el mismo módulo importado. Si los casos vivieran dentro de
un archivo de test, el servidor no podría ejecutarlos y la garantía de "mismo veredicto" volvería
a ser una afirmación.

### La lista de `response_type` se duplica en SQL, a propósito

El `CHECK` de `template_version_item` no puede importar TypeScript. Ya hay precedente: el patrón
de `item_key` está escrito en la migración `0003` y en el esquema Zod, con un comentario que dice
que si uno cambia el otro también. Se mantiene ese criterio, y un test de integración compara la
lista del `CHECK` real contra `RESPONSE_TYPES` para que la duplicación no pueda divergir en
silencio.

## Risks / Trade-offs

- **La migración toca tablas inmutables** → Solo DDL con `hs_migrator`: `ALTER TABLE ... DROP
  CONSTRAINT` + `ADD CONSTRAINT` sobre `template_version_item`, y `CREATE OR REPLACE FUNCTION` del
  trigger de proyección. Ninguna sentencia UPDATE ni DELETE sobre filas existentes. Un test de
  integración verifica que los documentos ya publicados quedan byte a byte iguales.
- **Las columnas nuevas de `template_version_item` no existen en las filas ya proyectadas** → Se
  agregan como `NULL`-ables. Re-proyectar exigiría reescribir filas de una tabla inmutable, que es
  exactamente lo que ADR-002 impide. Las filas viejas describen ítems de los cuatro tipos
  originales, que no necesitan configuración: la ausencia es correcta, no una deuda.
- **La configuración vive en el documento y solo parcialmente en las filas** → La fuente de verdad
  para validar es siempre `template_version.document`. `template_version_item` existe para
  consultar y para la serie de recurrencia, no para validar.
- **Zod entra al bundle del service worker** → Es la única dependencia y ya viaja en el cliente por
  `@hs/contracts`. Si el peso llegara a molestar, el reemplazo es un validador a mano detrás de la
  misma firma de función, sin tocar specs.
- **Un caso de la tabla compartida puede pasar en los dos entornos y aun así ser incorrecto** → La
  tabla prueba acuerdo, no verdad. Por eso los tests unitarios del motor siguen teniendo casos
  propios por tipo de ítem, más allá de la tabla compartida.

## Migration Plan

1. Mover el esquema del documento a `packages/forms` y dejar el re-export en `@hs/contracts`.
   Typecheck del monorepo verde antes de agregar tipos nuevos: el movimiento no cambia
   comportamiento.
2. Extender el esquema (unión discriminada, `visible_when`) y escribir motor y tests. Todavía sin
   tocar la base: un documento de v1 sigue siendo válido.
3. Migración `0007`: ampliar el `CHECK`, agregar las columnas derivadas nulables y reemplazar la
   función de proyección.
4. Suite de integración: proyección de un documento con tipos nuevos, `CHECK` que sigue rechazando
   un tipo inventado, documentos preexistentes intactos, y la tabla de casos compartida.

Rollback: si la migración `0007` falla, se revierte con una migración hacia adelante que restituye
el `CHECK` anterior. No hay datos que perder — las columnas nuevas nacen nulas y ningún documento
publicado usa todavía los tipos nuevos. El código de `packages/forms` es independiente de la
migración: revertir la base no rompe el motor, solo impide publicar documentos con tipos nuevos.
