import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/**
 * La regla que protege ADR-007, bajo prueba.
 *
 * `packages/forms` va dentro del bundle del service worker: un `import
 * 'node:crypto'` ahí no rompe el build de la API, rompe la inspección en el
 * invernadero. La regla existe desde el primer commit, pero una regla mal
 * configurada — un glob que no matchea, un bloque que otro pisa — falla en
 * silencio, que es la única forma de falla que importa acá.
 *
 * Se usa `lintText` con un `filePath` que no existe en disco: el archivo se
 * lintea como si estuviera en `packages/forms`, sin dejar un fixture que después
 * rompa `pnpm lint` de verdad.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: resolve(repoRoot, 'eslint.config.js'),
});

/** Los mensajes de lint de un fragmento, como si viviera en `packages/forms`. */
async function lintInForms(code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, {
    filePath: resolve(repoRoot, 'packages/forms/src/probe.ts'),
  });

  return (result?.messages ?? []).map((message) => message.message);
}

/** El mismo fragmento, pero en un paquete que sí puede usar Node. */
async function lintInApi(code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, {
    filePath: resolve(repoRoot, 'apps/api/src/probe.ts'),
  });

  return (result?.messages ?? []).map((message) => message.message);
}

describe('ADR-007: packages/forms sin Node', () => {
  it('rechaza importar un builtin de Node', async () => {
    const messages = await lintInForms("import { randomUUID } from 'node:crypto';\n");

    expect(messages.join('\n')).toContain('ADR-007');
  });

  it('rechaza un builtin de Node importado sin el prefijo node:', async () => {
    const messages = await lintInForms("import { readFile } from 'fs';\n");

    expect(messages.join('\n')).toContain('ADR-007');
  });

  it('rechaza el global process', async () => {
    const messages = await lintInForms('export const url = process.env.DATABASE_URL;\n');

    expect(messages.join('\n')).toContain('ADR-007');
  });

  it('rechaza Buffer', async () => {
    const messages = await lintInForms('export const bytes = Buffer.from("x");\n');

    expect(messages.join('\n')).toContain('ADR-007');
  });

  it('acepta el mismo código en apps/api, que sí corre en Node', async () => {
    const messages = await lintInApi("import { randomUUID } from 'node:crypto';\nexport { randomUUID };\n");

    expect(messages.join('\n')).not.toContain('ADR-007');
  });
});

describe('ADR-007: el motor es puro', () => {
  it('rechaza el reloj', async () => {
    const messages = await lintInForms('export const now = Date.now();\n');

    expect(messages.join('\n')).toContain('Sin reloj');
  });

  it('rechaza construir una fecha', async () => {
    const messages = await lintInForms('export const now = new Date();\n');

    expect(messages.join('\n')).toContain('Sin reloj');
  });

  it('rechaza el azar', async () => {
    const messages = await lintInForms('export const roll = Math.random();\n');

    expect(messages.join('\n')).toContain('Sin reloj');
  });

  it('rechaza salir a la red', async () => {
    const messages = await lintInForms('export const load = () => fetch("/x");\n');

    expect(messages.join('\n')).toContain('Sin reloj');
  });
});
