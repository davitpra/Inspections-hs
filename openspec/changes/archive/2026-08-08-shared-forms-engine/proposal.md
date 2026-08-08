# Motor de formularios compartido

## Why

ADR-007 lo dice sin rodeos: el dispositivo tiene que interpretar la plantilla sin red, y el
servidor tiene que re-validar el envío contra esa misma versión. Si esas dos interpretaciones
divergen, el inspector recorre 48 acres, firma, sincroniza — y el servidor rechaza, o acepta con
otra semántica. El único diseño que hace imposible esa divergencia es que las dos partes
importen **el mismo paquete**.

Hoy ese paquete existe como esqueleto: `packages/forms/src/index.ts` tiene una función
(`isAnswered`) y un comentario que dice que el resto llega en la etapa 3. Mientras tanto el
documento de `template_version` solo sabe describir cuatro tipos de respuesta y no sabe expresar
lógica condicional, así que no hay nada que interpretar.

Este change abre la **etapa 3** de `docs/Requisitos_V1.2.md` §7 y prepara el **spike 1**
(inspección completa sin señal). No la cierra: la PWA, el outbox y la ingesta idempotente son
changes siguientes que consumen este motor. Va primero porque los tres dependen de él —
construir la captura offline contra un motor que todavía no existe significa escribir el motor
dos veces, una en el cliente y otra en el servidor, que es exactamente el modo de falla que
ADR-007 prohíbe.

## What Changes

- **`packages/forms` pasa a ser dueño del documento de plantilla.** El esquema Zod se mueve de
  `packages/contracts/src/template-document.ts` a `packages/forms`; `@hs/contracts` lo re-exporta
  para que `apps/api` no cambie ni un import. El motor no depende de `@hs/contracts`: dentro del
  bundle del service worker viaja el paquete de formularios, no el de request/response.
- **Nueve tipos de ítem**, contra los cuatro de hoy: `yes_no`, `yes_no_na`, `scale`, `text`,
  `number`, `single_choice`, `multi_choice`, `photo`, `signature`. Cada tipo trae su
  configuración en el documento (rango y etiquetas de la escala, opciones de las selecciones,
  mínimo y máximo de fotos, largo del texto, rango y decimales del número) y su forma de
  respuesta.
- **BREAKING** — `RESPONSE_TYPES` deja de ser `['yes_no', 'scale', 'text', 'number']` y
  `templateItemSchema` deja de ser un objeto plano: pasa a ser una unión discriminada por
  `response_type`. Un documento que hoy parsea sigue parseando; código que asumía un solo shape
  de ítem, no.
- **Lógica condicional** en el documento: un ítem o una sección puede declarar `visible_when`,
  una expresión sobre respuestas de ítems anteriores. La evaluación es una función pura del
  motor. Un ítem oculto no se responde y no se exige.
- **Validación de un conjunto de respuestas contra una `template_version`**: obligatoriedad,
  tipo, rango, pertenencia al catálogo de opciones, e ítems ocultos que no pueden traer
  respuesta. Devuelve la lista completa de errores, no el primero.
- **La misma tabla de casos corre en los dos entornos.** Un archivo de casos compartido, ejecutado
  por los tests unitarios de `packages/forms` y por la suite de integración de `apps/api` contra
  el motor importado. Una divergencia rompe CI, no una inspección.
- **Migración `0007`**: ampliar el `CHECK` de `template_version_item.response_type` a los nueve
  tipos y proyectar los campos nuevos que la tabla necesita. `template_version` sigue siendo
  inmutable: se altera la restricción, nunca una fila.
- **La regla de lint de ADR-007 pasa a estar probada**, no solo escrita: un test verifica que
  `eslint` marca un `import 'node:crypto'` dentro de `packages/forms`.

Fuera de alcance, explícito: componentes de React y cualquier interfaz; Dexie, el service worker
y el outbox; el endpoint de ingesta; el builder visual (etapa 8). El motor no toca red ni base de
datos — todas sus funciones son puras.

## Capabilities

### New Capabilities

Ninguna. El motor es la interpretación de una `template_version`: sus requisitos pertenecen a la
capability que ya define qué es una versión publicada.

### Modified Capabilities

- `templates`: el conjunto de `response_type` válidos se amplía de cuatro a nueve y cada tipo
  gana su configuración; el documento gana lógica condicional; y se agrega qué significa que un
  conjunto de respuestas sea válido contra una versión — incluida la garantía de que cliente y
  servidor dan el mismo veredicto.

## Impact

| Área | Efecto |
| --- | --- |
| `packages/forms` | Deja de ser un esqueleto. Dependencia nueva: `zod` (isomórfico, sin builtins de Node). Módulos de documento, lógica condicional y validación. |
| `packages/contracts` | `template-document.ts` pasa a re-exportar desde `@hs/forms`. Sin cambios para quien lo importa. |
| `apps/api` | Migración `0007`, seeds actualizados si usan tipos nuevos, y la suite de integración que corre la tabla de casos compartida. |
| `apps/web` | Ninguno todavía. Consume el motor en el change de captura offline. |
| `eslint.config.js` | La regla de `packages/forms` no cambia; gana un test que la ejerce. |
| Tablas inmutables | `template_version` y `template_version_item`. Se modifica una restricción por DDL con el rol de migraciones; ninguna fila se actualiza. |
