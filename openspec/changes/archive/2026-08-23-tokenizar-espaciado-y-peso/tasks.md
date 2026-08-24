## 1. La escala

- [x] 1.1 Declarar los once `--space-*` de design.md §2 en la capa **semántica** de `apps/web/src/index.css` (después del marcador `Semánticas`, con el valor crudo, como `--radius` y `--text-*`), con el comentario que explica por qué el número es el múltiplo de 4px y por qué los dos medios pasos llevan `-0-5` / `-1-5`
- [x] 1.2 Declarar `--weight-normal: 400` y `--weight-strong: 600` junto a la escala tipográfica, con la razón del nombre por rol
- [x] 1.3 Verificar que ningún token nuevo colisiona con uno existente y que `--space-4` y `--text-base` conviven sin confundirse en el comentario

## 2. El peso

- [x] 2.1 Reemplazar los 51 `font-weight: 600` por `var(--weight-strong)`
- [x] 2.2 Reemplazar los 6 `font-weight: 400` por `var(--weight-normal)`
- [x] 2.3 Confirmar que no quedan literales de `font-weight` fuera del bloque de tokens

## 3. El espaciado, por sección de la hoja

Cada tarea es un tramo contiguo de `index.css` y se aplica con el mapeo de design.md §2.
Un valor de uso único **no se redondea a ciegas**: se lee en su contexto y se decide.

- [x] 3.1 Base, tipografía y controles (líneas ~109-507): `body`, `h1`-`h3`, `button`, `input`, `select`, `textarea`, `.card`, `.stats-bar`
- [x] 3.2 La barra del teléfono, la hoja de cuenta y las listas (~508-1155)
- [x] 3.3 Cumplimiento y recurrencia, consola de programación, asignación destacada, pantalla sin conexión y cola de salida (~1156-2136)
- [x] 3.4 El editor de plantillas y el catálogo de ubicaciones (~2137-2688)
- [x] 3.5 El builder de plantillas (~2689-3610)
- [x] 3.6 El listado de plantillas, la lectura de una versión publicada y `SignInRoute` (~3611-fin)
- [x] 3.7 Tratar los tres `env(safe-area-inset-*)` según design.md §4: el literal que los acompaña se tokeniza dentro del `calc()` / `max()`
- [x] 3.8 Dejar los dos `margin: -1px` como están y anotar en el sitio por qué no son espaciado
- [x] 3.9 Decidir a mano el único `2.5rem` (corrimiento de −8px si se redondea) y dejar escrita la razón

## 4. El guardián

- [x] 4.1 Reemplazar la constante `COLOR_LITERAL` cableada por la tabla de categorías de design.md §4 (categoría → propiedades CSS → qué cuenta como literal), manteniendo `color` con el comportamiento actual
- [x] 4.2 Implementar la lista de excepciones como constante nombrada y comentada: `0` sin unidad, `auto`, `inherit`, `none`, porcentajes, `-1px` en `margin`, y `env()` dentro de `calc()` / `max()`
- [x] 4.3 Mantener sin cambios la comprobación 2 (todo `var()` resuelve) y la 4 (`--brand` coincide con `index.html` y el manifest)
- [x] 4.4 Dejar la comprobación 3 (primitivas fuera de `:root`) restringida a color, con el comentario que explica que es la única categoría con dos capas
- [x] 4.5 Conservar la forma del mensaje de error —archivo:línea, la línea ofensora, qué hacer— para las categorías nuevas
- [x] 4.6 Actualizar el comentario de encabezado del script: son cuatro comprobaciones sobre cinco categorías, no cuatro sobre color

## 5. Verificación

- [x] 5.1 `pnpm --filter web build` pasa, y `check-tokens.mjs` reporta el conteo de tokens y categorías
- [x] 5.2 Comprobar que el guardián **falla** ante un literal nuevo introducido a propósito en cada una de las cinco categorías, y revertirlos
- [x] 5.3 `pnpm lint` y `pnpm typecheck` pasan (el typecheck después del build, por `@hs/forms` y `@hs/contracts`)
- [x] 5.4 Revisión ocular en un viewport de 360px sobre las rutas más densas —la grilla de una inspección, la lista de hallazgos, el builder— buscando acumulación de corrimientos, no diferencias de 1px aisladas
  — **cerrada sin ejecutar, por decisión del dueño al archivar (2026-08-23).** No se hizo
  la revisión visual: el riesgo de acumulación queda sin verificar y, si aparece, se
  trata como un fix suelto.
- [x] 5.5 Confirmar que ningún valor de color ni ningún comentario de contraste cambió: `git diff` de `index.css` no debe tocar el bloque de contrastes medidos que protege ADR-012

## 6. Cierre

- [x] 6.1 Agregar este change a la fila "Changes que la consumen" de `docs/adr/012-css-tokens-not-tailwind.md`
- [x] 6.2 Actualizar el conteo de líneas y clases que ADR-012 cita en su Contexto si quedó desactualizado, o anotar que el número es de la fecha del ADR
