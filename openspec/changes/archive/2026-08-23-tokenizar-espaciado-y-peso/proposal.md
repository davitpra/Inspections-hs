## Why

La hoja de tokens de `apps/web` declara en su encabezado una regla —"fuera de este bloque
no se escribe un literal"— y el build la comprueba, pero **sólo para el color**. Las otras
categorías nunca se tokenizaron y ya se rompieron sin que nadie se enterara: el espaciado
tiene **388 declaraciones de `padding`/`margin`/`gap` repartidas en 24 pasos distintos**
(`0.1` a `3rem`, con `0.35` / `0.4` / `0.45` conviviendo a menos de 1px de diferencia), y
`font-weight` tiene dos valores usados 57 veces sin un nombre que diga cuál es cuál.

Es exactamente la falla que el comentario de `--text-*` describe —"esto los nombra antes de
que la próxima etapa invente el quinto"— aplicada a la única categoría que nadie nombró. La
etapa 7 ya inventó una vez su propia paleta en hex; el mecanismo que impidió que se repitiera
fue `check-tokens.mjs`, no el comentario.

**Este change no cierra ninguna etapa de §7.** La etapa 8 (builder visual) es la última y ya
está cerrada. Existe porque el builder multiplicó la superficie de CSS de la PWA y dejó la
deuda medible: es el momento en que tokenizar cuesta un pase mecánico, y el momento anterior
a que la primera corrección post-v1 agregue el paso 25.

## What Changes

- **`--space-*`**: una escala de espaciado de base 4px declarada en el bloque de tokens
  (`0.25 / 0.5 / 0.75 / 1 / 1.5 / 2 / 3 rem`), y las 388 declaraciones de
  `padding`/`margin`/`gap` colapsadas contra ella. Los pasos intermedios sin significado
  (`0.1`, `0.15`, `0.3`, `0.35`, `0.45`, `0.55`, `0.65`, `0.7`, `0.85`, `0.9`, `1.2`) se
  redondean al paso más cercano de la escala.
- **`--weight-normal` / `--weight-strong`**: dos nombres para los dos pesos que ya existen
  (`400` y `600`), por la misma razón por la que hay dos pesos de línea y no uno.
- **`check-tokens.mjs` extendido**: las tres primeras comprobaciones que hoy hace sobre
  color —ningún literal fuera del bloque, todo `var()` resuelve, las primitivas no salen—
  pasan a cubrir también **radio, tipografía, peso y espaciado**. Sin esto el resto del
  change es una limpieza que se deshace sola.
- **Excepciones declaradas en el script, no toleradas en silencio**: `0`, `auto`, `100%`,
  los porcentajes de layout y las medidas que no son espaciado (`width`, `height`,
  `border-width`) quedan fuera del alcance de la regla, escritas como lista y no como
  omisión.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

Ninguna. El change no toca ningún requisito: no cambia qué hace el sistema, qué ve un
usuario ni qué garantiza el servidor. Es tokenización de CSS más una comprobación de build.
Por eso declara `skip_specs: true` en su `.openspec.yaml`, en vez de inventar un requisito
para satisfacer `openspec validate`.

## Impact

- `apps/web/src/index.css` — el bloque `:root` (tokens nuevos) y ~390 declaraciones en el
  cuerpo de la hoja. Es el archivo entero, pero el cambio es mecánico y de un solo tipo.
- `apps/web/scripts/check-tokens.mjs` — la lógica de detección deja de estar cableada a
  color y pasa a estar parametrizada por categoría.
- `pnpm --filter web build` — falla ante un literal nuevo de espaciado, radio, tipografía o
  peso. Es el punto del change.
- **Riesgo visual**: redondear ~11 pasos intermedios mueve píxeles en pantalla. Ninguna de
  las diferencias supera 1.5px por lado, pero se acumulan en listas densas. La verificación
  es ocular sobre las rutas más apretadas, no automática.
- Sin impacto en `apps/api`, `packages/*`, el esquema, RLS ni los contratos.
