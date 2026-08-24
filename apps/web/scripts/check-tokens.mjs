import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * La regla que `index.css` declara en su encabezado, comprobada.
 *
 * "Fuera de este bloque no se escribe un literal." Lo que se rompió antes fue exactamente
 * eso —la etapa 7 inventó su propia paleta en hex y quedaron dos sistemas conviviendo—, y
 * una regla escrita solo en un comentario se rompe de nuevo con el próximo estado nuevo.
 * Esto la vuelve una condición del build.
 *
 * Cuatro comprobaciones sobre CINCO categorías. La distinción importa: al principio esto
 * miraba solo color, y mientras tanto el espaciado juntó 388 declaraciones repartidas en
 * 24 valores distintos sin que nadie se enterara. Un guardián que cubre una categoría de
 * cinco no sostiene la regla, sostiene un cuarto de la regla.
 *
 * En orden de lo que más duele cuando falla:
 *
 * 1. Ningún literal fuera del bloque de tokens, en ninguna de las cinco categorías
 *    (color, espaciado, radio, tipografía, peso). Es la regla del encabezado.
 * 2. Todo `var(--x)` resuelve a un token declarado. Un `var(--line-controll)` no falla
 *    ruidosamente: CSS descarta la declaración y el borde se dibuja con el default del
 *    navegador, que es la clase de error que se ve recién en el teléfono.
 * 3. Las primitivas no se usan fuera del bloque. Aplica SOLO a color, que es la única
 *    categoría con dos capas: un `var(--green-600)` en una regla saltea la capa semántica
 *    y deja el valor sin el nombre que dice para qué sirve. Las demás categorías declaran
 *    el valor crudo en la capa semántica y se usan directo —si `--space-2` fuera una
 *    primitiva, `padding: var(--space-2)` sería una violación y la escala no se podría
 *    usar en ningún lado.
 * 4. Los colores de `index.html` y del manifest coinciden con `--brand`. Son los tres
 *    lugares donde el color NO puede ser un `var()` —los lee el sistema operativo, no
 *    el navegador— y por eso son los únicos que pueden desincronizarse en silencio.
 *
 * Corre como parte de `pnpm --filter web build`.
 */

const WEB = new URL('../', import.meta.url).pathname;
const CSS_PATH = join(WEB, 'src/index.css');
const SRC = join(WEB, 'src');
const HTML_PATH = join(WEB, 'index.html');
const MANIFEST_PATH = join(WEB, 'public/manifest.webmanifest');

/**
 * Los marcadores de sección del propio archivo. Se leen en vez de adivinar qué es
 * primitiva por el nombre: el archivo ya lo dice, y si alguien reorganiza las secciones
 * conviene que esto falle y se lo relea, no que siga midiendo contra un supuesto viejo.
 */
const PRIMITIVES_MARKER = 'Primitivas ---';
const SEMANTIC_MARKER = 'Semánticas ---';

/**
 * Las cinco categorías.
 *
 * `color` mira la línea entera porque un color aparece en decenas de propiedades y en
 * gradientes, sombras y `conic-gradient()` dentro de un `.tsx`. Las otras cuatro miran el
 * VALOR de una propiedad concreta: `2rem` es un literal prohibido en `padding` y es
 * perfectamente válido en `max-width`, que no es espaciado y no está en el alcance.
 */
const CATEGORIES = [
  {
    name: 'color',
    // Lo que cuenta como color escrito a mano. Las funciones modernas incluidas.
    line: /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/,
    hint: 'Agregá el token que falta en :root y usalo con var().',
  },
  {
    name: 'espaciado',
    props: /^(?:padding|margin)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?$|^(?:row-|column-)?gap$/,
    value: /(?<![\w.-])\d*\.?\d+(?:rem|px|em)\b/,
    hint: 'Usá el paso de `--space-*` más cercano, o agregá el paso a la escala con su razón escrita.',
  },
  {
    name: 'radio',
    props: /^border(?:-(?:top|bottom)-(?:left|right))?-radius$/,
    value: /(?<![\w.-])\d*\.?\d+(?:rem|px|em)\b/,
    hint: 'Es `--radius` (un control) o `--radius-lg` (una tarjeta). Un tercero necesita una razón.',
  },
  {
    name: 'tipografía',
    props: /^font-size$/,
    value: /(?<![\w.-])\d*\.?\d+(?:rem|px|em)\b/,
    hint: 'Usá `--text-xs`, `--text-sm`, `--text-base` o `--text-lg`.',
  },
  {
    name: 'peso',
    props: /^font-weight$/,
    value: /(?<![\w.-])\d{3}\b/,
    hint: 'Usá `--weight-normal` o `--weight-strong`.',
  },
];

/**
 * Lo que NO es un literal de escala, escrito y no tolerado en silencio: una lista se
 * discute cuando cambia, una omisión se hereda sin que nadie la haya elegido.
 *
 * - `0` sin unidad, `auto`, `inherit`, `initial`, `unset`, `revert`, `none` y los
 *   porcentajes: no son pasos de una escala.
 * - Un valor NEGATIVO: no es espaciado. Los tres del archivo son el ancho de una línea
 *   con signo —solapar el borde de una celda con el de su vecina, y el recorte de una
 *   etiqueta que sólo existe para el lector de pantalla—, y están anotados en el sitio.
 * - `env(safe-area-inset-*)`: lo da el dispositivo, no la escala. El literal que lo
 *   acompaña dentro de un `calc()` o un `max()` SÍ se comprueba, y por eso la excepción
 *   se aplica al `env(...)` y no a la declaración entera.
 */
const NEGATIVE = /-\s*\.?\d/;
const IGNORED_IN_VALUE = /\benv\([^)]*\)/g;

/** Una declaración CSS: `  padding: 0.5rem 1rem;`. Vale también para un objeto de estilo. */
const DECLARATION = /^\s*([a-z-]+)\s*:\s*([^;,]*)/;


const css = readFileSync(CSS_PATH, 'utf8');
const errors = [];

const rootStart = css.indexOf(':root {');
const rootEnd = css.indexOf('\n}', rootStart);

if (rootStart === -1 || rootEnd === -1) {
  console.error('No encontré el bloque `:root` en src/index.css.');
  process.exit(1);
}

const rootBlock = css.slice(rootStart, rootEnd);
const rootStartLine = css.slice(0, rootStart).split('\n').length;
const rootEndLine = css.slice(0, rootEnd).split('\n').length;

const declared = new Map();

for (const match of rootBlock.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
  declared.set(match[1], match[2].trim());
}

const semanticAt = rootBlock.indexOf(SEMANTIC_MARKER);

if (rootBlock.indexOf(PRIMITIVES_MARKER) === -1 || semanticAt === -1) {
  console.error(
    'No encontré los encabezados de sección "Primitivas"/"Semánticas" en el bloque de\n' +
      'tokens. Esto los usa para saber qué capa es cuál: si reorganizaste las secciones,\n' +
      'actualizá PRIMITIVES_MARKER / SEMANTIC_MARKER en este script.',
  );
  process.exit(1);
}

const primitives = new Set(
  [...rootBlock.slice(0, semanticAt).matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]),
);

/** Resuelve una cadena de `var()` hasta el valor crudo. */
function resolve(name, seen = new Set()) {
  const value = declared.get(name);

  if (value === undefined || seen.has(name)) return null;

  const ref = value.match(/^var\(--([a-z0-9-]+)\)/);

  return ref ? resolve(ref[1], new Set([...seen, name])) : value;
}

/** Todos los archivos donde un literal sería una violación. */
function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);

    if (entry.isDirectory()) return sources(full);
    if (/\.test\.[jt]sx?$/.test(entry.name)) return [];

    return /\.(css|ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/** El literal de escala que quede en un valor, una vez sacadas las excepciones. */
function scaleLiteral(category, value) {
  if (NEGATIVE.test(value)) return null;

  const clean = value.replace(IGNORED_IN_VALUE, '');
  const found = clean.match(category.value);

  return found ? found[0] : null;
}

for (const file of sources(SRC)) {
  const isTokenSheet = file === CSS_PATH;
  const lines = readFileSync(file, 'utf8').split('\n');
  const relative = file.slice(WEB.length);
  /**
   * La categoría de una declaración que quedó abierta en la línea anterior. Una
   * declaración puede seguir abajo —`padding-inline` con un `max()` por lado es el caso
   * real de esta hoja— y la continuación no empieza con el nombre de la propiedad. Sin
   * arrastrar la categoría, un literal ahí se cuela por la puerta de atrás.
   */
  let pending = null;

  lines.forEach((line, index) => {
    const number = index + 1;
    // Dentro del bloque de tokens el literal es justamente el punto.
    const inRootBlock = isTokenSheet && number >= rootStartLine && number <= rootEndLine;
    const code = line.replace(/\/\*.*?\*\//g, '').replace(/^\s*\*.*$/, '');

    if (!inRootBlock) {
      for (const category of CATEGORIES) {
        let literal = null;

        if (category.line) {
          const found = code.match(category.line);
          literal = found ? found[0] : null;
        } else {
          const declaration = code.match(DECLARATION);

          if (declaration && category.props.test(declaration[1])) {
            literal = scaleLiteral(category, declaration[2]);
            pending = code.includes(';') ? null : category;
          } else if (pending === category && !declaration) {
            literal = scaleLiteral(category, code);
            if (code.includes(';')) pending = null;
          }
        }

        if (literal !== null) {
          errors.push(
            `${relative}:${number} — literal de ${category.name} (\`${literal}\`) fuera del bloque de tokens.\n` +
              `    ${line.trim()}\n` +
              `    ${category.hint}`,
          );
        }
      }
    }

    for (const use of code.matchAll(/var\(--([a-z0-9-]+)/g)) {
      const name = use[1];

      if (!declared.has(name)) {
        errors.push(
          `${relative}:${number} — var(--${name}) no está declarado en :root.\n` +
            '    CSS descarta la declaración en silencio y el valor cae al default.',
        );
      } else if (!inRootBlock && primitives.has(name)) {
        errors.push(
          `${relative}:${number} — var(--${name}) es una primitiva, usada fuera de :root.\n` +
            '    Usá el token semántico, o creá uno si todavía no existe.',
        );
      }
    }
  });
}

// El color de marca en los tres lugares que el sistema operativo lee y que no pueden
// escribirse con var().
const brand = resolve('brand');
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const themeColor = readFileSync(HTML_PATH, 'utf8').match(
  /<meta\s+name="theme-color"\s+content="([^"]+)"/,
);

const external = [
  ['index.html', 'theme-color', themeColor?.[1]],
  ['public/manifest.webmanifest', 'theme_color', manifest.theme_color],
  ['public/manifest.webmanifest', 'background_color', manifest.background_color],
];

for (const [where, field, value] of external) {
  if (value?.toLowerCase() !== brand?.toLowerCase()) {
    errors.push(
      `${where} — ${field} es ${value}, y --brand resuelve a ${brand}.\n` +
        '    Son el mismo color por diseño: lo pinta el sistema operativo alrededor de la app.',
    );
  }
}

if (errors.length > 0) {
  console.error(`\n${errors.join('\n\n')}\n`);
  console.error(`tokens: ${errors.length} violación(es).`);
  process.exit(1);
}

console.log(`tokens: ${declared.size} declarados (${primitives.size} primitivas) ✓`);
console.log(`categorías vigiladas: ${CATEGORIES.map((c) => c.name).join(', ')} ✓`);
console.log(`marca: ${brand} coincide en index.html y el manifest ✓`);
