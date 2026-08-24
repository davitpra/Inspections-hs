## Context

Ver `proposal.md` — Why. Lo que hace falta acá es el estado del archivo y del guardián.

**ADR-012** decide CSS propio con dos capas de tokens y deja la regla como condición del
build, no como convención: "una regla escrita solo en prosa se rompe de nuevo con el próximo
estado nuevo". Cuando se escribió, `index.css` tenía **1195 líneas y 141 clases**. Hoy tiene
**4022** — la etapa 8 (builder visual) triplicó la hoja. El guardián que ADR-012 nombra como
lo que sostiene el sistema sigue comprobando exactamente lo que comprobaba entonces, y sólo
sobre color.

El bloque de tokens declara hoy 37 tokens: 14 primitivas de color y 23 semánticas. Tres de
esas semánticas —`--radius`, `--radius-lg`, `--radius-pill`— y cuatro —`--text-xs/sm/base/lg`—
**no son alias de una primitiva: llevan el valor crudo directamente**. Ese precedente es la
pieza que resuelve la decisión principal de abajo.

Este change **no toca la base de datos**: ninguna tabla, inmutable o no, ninguna migración,
ninguna política RLS. Es CSS de `apps/web` y un script de build.

## Goals / Non-Goals

**Goals:**

- Que las cinco categorías de token del archivo (color, radio, tipografía, peso, espaciado)
  estén sujetas a la misma regla, y que la regla la compruebe el build.
- Que la escala de espaciado sea legible como escala: que mirar dos pasos consecutivos diga
  por qué son dos y no uno.
- Que el pase sea mecánico y revisable de a una declaración, no un rediseño.

**Non-Goals:**

- Rediseñar el espaciado de ninguna pantalla. Donde la escala obliga a mover píxeles, se
  mueven los mínimos; donde el valor actual ya está en la escala, no se toca nada.
- Una tercera capa de tokens. El encabezado de `index.css` explica por qué no hay una, y
  este change no cambia esa premisa.
- Tokenizar `width`, `height`, `border-width`, `line-height` o `z-index`. No son espaciado y
  no muestran la deuda que motiva el change.
- Extender el check a `apps/api` o a los paquetes. La regla es de la PWA.

## Decisions

### 1. `--space-*` va en la capa semántica, no en la de primitivas

**Decisión:** los tokens de espaciado se declaran después del marcador `Semánticas`, con el
valor crudo, igual que `--radius` y `--text-*`.

Es forzado por el propio guardián y conviene que quede escrito: la comprobación 3 de
`check-tokens.mjs` rechaza **una primitiva usada fuera de `:root`**. Si `--space-2` se
declarara como primitiva, `padding: var(--space-2)` sería una violación y el change se
contradiría a sí mismo en la primera línea.

La razón de fondo es la que da el encabezado del archivo. Una primitiva es "el valor crudo,
sin opinión sobre dónde va", y existe para que la semántica le ponga un nombre de propósito:
`--green-900` no dice nada, `--brand` sí. Un paso de escala **ya es** el nombre de propósito
—"un paso", "dos pasos"— y no hay una segunda capa que agregar sin inventar
`--gap-fila` / `--pad-control`, que es la tercera capa que la hoja rechaza.

*Alternativa considerada:* primitivas `--space-1..12` más semánticas por rol. Se descarta:
duplica 10 tokens en ~25 nombres de rol para un archivo con un solo tema y ningún consumidor
externo, que es exactamente el caso en que el encabezado dice que la indirección no paga.

*Alternativa considerada:* hacer la comprobación 3 sensible a la categoría (la regla de
primitivas aplica sólo a color). Se descarta: debilita la única comprobación que hoy atrapa
el salteo de capa, para acomodar una categoría que no lo necesita.

### 2. La escala: base 4px, once pasos, dos medios pasos declarados como tales

```
--space-0-5   0.125rem    2px
--space-1     0.25rem     4px
--space-1-5   0.375rem    6px
--space-2     0.5rem      8px
--space-3     0.75rem    12px
--space-4     1rem       16px
--space-5     1.25rem    20px
--space-6     1.5rem     24px
--space-8     2rem       32px
--space-10    2.5rem     40px
--space-12    3rem       48px
```

El número es el múltiplo de 4px, que es lo que hace la escala legible sin memorizarla:
`--space-3` son tres pasos, 12px. Los dos medios pasos llevan `-0-5` / `-1-5` en el nombre
justamente para que se lean como excepciones y no como pasos enteros.

**Por qué diez y no siete.** Una escala de 4px pura (`1, 2, 3, 4, 6, 8, 12`) obligaría a
mover 24 usos de `0.15rem` a 4px (+1.6px cada uno, en nudges de alineación óptica donde 1.6px
es el efecto entero) y 24 usos de `0.35`/`0.4rem` a 4 u 8px, partiendo en direcciones opuestas
dos valores que están a 0.8px de distancia. Los medios pasos de 2px y 6px absorben esos 48
usos con un corrimiento máximo de 0.8px. La misma lógica agrega `--space-5` (20px): sin él,
los 9 usos de `1.2`/`1.25rem` saltan a 24px, +4px.

Esto es un juicio, y es el que la hoja ya hizo dos veces: colapsó `0.85`/`0.9rem` en
`--text-sm` porque 0.8px "no significaba nada", y mantuvo `--line` y `--line-control`
separados porque 1.35:1 y 3:1 sí significan cosas distintas. El criterio es el mismo: se
colapsa lo que no se distingue, se nombra lo que sí.

**El mapeo**, con la cantidad de usos actuales que caen en cada paso:

| Paso        | Absorbe                              | Usos | Corrimiento máx. |
| ----------- | ------------------------------------ | ---- | ---------------- |
| `--space-0-5` | `0.1` `0.125` `0.15`               | 24   | +0.4px           |
| `--space-1`   | `0.25` `0.3`                       | 25   | −0.8px           |
| `--space-1-5` | `0.35` `0.4` `0.45`                | 25   | ±0.8px           |
| `--space-2`   | `0.5` `0.55` `0.6` `0.625`         | 90   | −1.6px           |
| `--space-3`   | `0.65` `0.7` `0.75` `0.8` `0.85`   | 82   | +1.6px           |
| `--space-4`   | `0.9` `1`                          | 68   | +1.6px           |
| `--space-5`   | `1.2` `1.25`                       | 9    | +0.8px           |
| `--space-6`   | `1.5`                              | 10   | 0                |
| `--space-10`  | `2.5`                              | 1    | 0                |
| `--space-12`  | `3`                                | 3    | 0                |

Once pasos reemplazan veinticuatro. **350 declaraciones numéricas** en total (el archivo creció durante el apply).

`2.5rem` era el único caso con un corrimiento grande —a `--space-8` habría perdido 8px— y
mirarlo en contexto durante el apply cambió la decisión: **no es un paso de ritmo, es una
medida de alineación**. Alinea la caja de configuración con la columna del número, y el
valor sale del ancho de la manija de arrastre más el hueco. Redondearlo habría roto la
alineación en vez de ajustar un espacio. Son 40px, que caen en diez pasos exactos, así que
entra en la escala como `--space-10` sin corrimiento y sin pedirle una excepción al
guardián. Once pasos, no diez.

Ésa es la regla general para el uso único: un valor que aparece una vez no tiene un patrón
que respetar, tiene una razón local que hay que leer antes de tocarlo.

### 3. `--weight-normal` / `--weight-strong`

Dos tokens para los dos pesos que ya existen (`400` ×6, `600` ×51). `strong` y no `semibold`
porque el nombre debe decir el rol, no el valor —es la misma razón por la que el token es
`--brand` y no `--green-900`— y porque si mañana el peso fuerte pasa a `700` el nombre sigue
siendo cierto.

### 4. El check se parametriza por categoría, con una lista de excepciones escrita

`check-tokens.mjs` tiene hoy la detección cableada a color: una constante `COLOR_LITERAL` y
un conjunto de primitivas. Pasa a una tabla de categorías, cada una con las propiedades CSS
que gobierna y qué cuenta como literal en ellas:

| Categoría | Propiedades                                            | Literal |
| --------- | ------------------------------------------------------ | ------- |
| color     | cualquiera                                             | el `COLOR_LITERAL` actual |
| space     | `padding*` `margin*` `gap` `row-gap` `column-gap`       | cualquier número con unidad |
| radius    | `border-radius*`                                       | cualquier número con unidad |
| text      | `font-size`                                            | cualquier número con unidad |
| weight    | `font-weight`                                          | cualquier número |

Las comprobaciones 2 y 4 (todo `var()` resuelve; la marca coincide con el manifest) no
cambian. La 3 (primitivas fuera de `:root`) sigue siendo de color, que es la única categoría
con dos capas — y por la decisión 1, la única que puede tenerlas.

**Las excepciones, declaradas y no toleradas en silencio**, porque una lista escrita se
discute y una omisión se hereda:

- `0` sin unidad, `auto`, `inherit`, `none` y los porcentajes. No son pasos de escala.
- `-1px` en `margin`. Aparece dos veces y es la corrección de bordes colapsados de una grilla:
  no es espaciado, es el ancho de una línea con signo.
- `env(safe-area-inset-*)` dentro de `calc()` / `max()`. Tres usos. El literal que los
  acompaña (`1rem`) **sí** se tokeniza: `max(var(--space-4), env(safe-area-inset-left))`.
- Dentro del bloque `:root`, donde el literal es el punto. Ya lo hace el script.

El mensaje de error mantiene la forma actual —archivo:línea, la línea ofensora, y qué hacer—
porque es lo que hace que el fallo del build se arregle en vez de silenciarse.

## Risks / Trade-offs

- **El pase mueve píxeles en 337 declaraciones.** → Ningún corrimiento supera 1.6px salvo el
  caso único de `2.5rem`, que se decide a mano. La verificación es ocular sobre las rutas más
  densas (la grilla de una inspección, la lista de hallazgos) en un teléfono de 360px, que es
  el dispositivo de ADR-010. No hay forma automática de verificar esto y no se va a fingir que
  la hay.
- **Un diff de ~390 líneas sobre un archivo con comentarios que documentan decisiones de
  accesibilidad.** → El cambio es de un solo tipo por línea y no toca ningún comentario ni
  ningún valor de color; los contrastes medidos que ADR-012 protege quedan intactos.
- **La escala puede quedar corta y aparecer el paso once.** → Es el resultado esperado y
  aceptable: con el check en su lugar, agregar un paso pasa a ser una línea en `:root` con su
  razón escrita, en vez de un número suelto a mitad de la hoja. Lo que el change compra no es
  que la escala sea perfecta, es que crecer sea deliberado.
- **Los medios pasos son la puerta por la que volvería el problema.** → Por eso van nombrados
  `-0-5` y `-1-5` y no `--space-1`/`--space-2` corridos: el nombre delata que son una
  excepción cada vez que alguien los escribe.
