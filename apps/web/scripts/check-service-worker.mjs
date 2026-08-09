import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ADR-007 en el borde donde se paga: el service worker construido.
 *
 * `packages/forms` viaja dentro de este bundle, y por eso no puede depender de builtins
 * de Node. La regla está escrita como lint sobre el fuente del paquete; esto la
 * comprueba sobre el ARTEFACTO, que es lo único que el navegador va a ejecutar. Un
 * `require('crypto')` que entra por una dependencia transitiva no lo ve el lint del
 * paquete, y el síntoma sería un service worker que no instala en el teléfono del
 * inspector.
 *
 * Mide además el precache. El número se imprime y se compara contra un presupuesto
 * escrito acá abajo: el crecimiento aparece en un diff, que es exactamente lo que el
 * riesgo de `design.md` pide.
 *
 * Corre como parte de `pnpm --filter web build`.
 */

const DIST = new URL('../dist/', import.meta.url).pathname;

/**
 * El presupuesto del precache. Cuando crezca, este número sube en un commit y el
 * revisor ve cuánto: es el mecanismo entero. Holgado respecto de lo medido hoy, para
 * que un chunk nuevo no rompa el build antes de que alguien pueda mirarlo.
 */
const PRECACHE_BUDGET_BYTES = 900 * 1024;

/**
 * Los builtins de Node que un bundle de navegador no puede nombrar. Se busca la forma
 * con la que un bundler los deja: `require("node:fs")`, `require("fs")`, o el
 * `from "node:fs"` de un import que no se resolvió.
 */
const NODE_BUILTINS = [
  'fs',
  'path',
  'crypto',
  'os',
  'child_process',
  'http',
  'https',
  'net',
  'stream',
  'zlib',
  'util',
  'buffer',
  'worker_threads',
];

const swPath = join(DIST, 'sw.js');
const sw = readFileSync(swPath, 'utf8');

const found = NODE_BUILTINS.filter((builtin) =>
  new RegExp(`(require\\(|from\\s*)["'](node:)?${builtin}["']`).test(sw),
);

if (found.length > 0) {
  console.error(
    `El service worker construido nombra builtins de Node: ${found.join(', ')}.\n` +
      'ADR-007: `packages/forms` viaja adentro de este bundle y no puede depender de Node.',
  );
  process.exit(1);
}

const precacheBytes = totalBytes(DIST);
const kib = (precacheBytes / 1024).toFixed(1);

console.log(`service worker: sin builtins de Node ✓`);
console.log(`precache: ${kib} KiB (presupuesto ${(PRECACHE_BUDGET_BYTES / 1024).toFixed(0)} KiB)`);

if (precacheBytes > PRECACHE_BUDGET_BYTES) {
  console.error(
    `El precache supera el presupuesto. Subí PRECACHE_BUDGET_BYTES en un commit propio\n` +
      'para que el crecimiento quede visible en el diff, o averiguá qué entró de más.',
  );
  process.exit(1);
}

/** Todo lo que el precache incluye: el build entero menos el service worker. */
function totalBytes(directory) {
  return readdirSync(directory, { withFileTypes: true }).reduce((sum, entry) => {
    const full = join(directory, entry.name);

    if (entry.isDirectory()) return sum + totalBytes(full);
    if (entry.name === 'sw.js') return sum;

    return sum + statSync(full).size;
  }, 0);
}
