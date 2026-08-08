import { builtinModules } from 'node:module';

import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * ADR-007 — `packages/forms` no puede tener dependencias de Node.
 *
 * El motor de formularios se empaqueta dentro del bundle del service worker: el
 * dispositivo lo ejecuta sin red y sin runtime de Node. Un `import 'node:crypto'`
 * ahí no rompe el build de la API — rompe la inspección en el invernadero.
 *
 * La lista se deriva de `builtinModules` en vez de escribirse a mano para que un
 * builtin nuevo de Node no quede fuera de la regla en silencio.
 */
const nodeBuiltinsMessage =
  'ADR-007: packages/forms va dentro del bundle del service worker. Sin builtins de Node.';

/**
 * El motor corre dos veces sobre la misma entrada: en el dispositivo antes de
 * dejar enviar, y en el servidor al recibir el envío. Si una de esas corridas
 * mira el reloj, tira un número al azar o sale a la red, el veredicto puede
 * diferir — que es el modo de falla que ADR-007 evita poniendo el motor en un
 * solo paquete. La pureza no se puede probar con un test: se aplica acá.
 */
const impurityMessage =
  'ADR-007: el motor corre en el dispositivo y en el servidor sobre la misma entrada. Sin reloj, sin azar y sin red.';

const forbidNodeBuiltins = {
  files: ['packages/forms/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: builtinModules.map((name) => ({ name, message: nodeBuiltinsMessage })),
        patterns: [{ group: ['node:*'], message: nodeBuiltinsMessage }],
      },
    ],
    'no-restricted-globals': [
      'error',
      { name: 'process', message: nodeBuiltinsMessage },
      { name: '__dirname', message: nodeBuiltinsMessage },
      { name: '__filename', message: nodeBuiltinsMessage },
      { name: 'require', message: nodeBuiltinsMessage },
      { name: 'Buffer', message: nodeBuiltinsMessage },
      // Red: mismo glob, misma lista. Ver `forbidImpurity` más abajo.
      { name: 'fetch', message: impurityMessage },
      { name: 'XMLHttpRequest', message: impurityMessage },
    ],
  },
};

/** Ver `impurityMessage`. Reloj y azar, que no son globals sino propiedades. */
const forbidImpurity = {
  files: ['packages/forms/**/*.ts'],
  rules: {
    // `no-restricted-globals` no se configura acá: `forbidNodeBuiltins` ya lo
    // usa para el mismo glob y el último bloque que lo declare reemplaza al
    // anterior entero. Los globals de red se agregan allá, en una sola lista.
    'no-restricted-properties': [
      'error',
      { object: 'Math', property: 'random', message: impurityMessage },
      { object: 'Date', property: 'now', message: impurityMessage },
    ],
    'no-restricted-syntax': [
      'error',
      { selector: "NewExpression[callee.name='Date']", message: impurityMessage },
    ],
  },
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/*.tsbuildinfo',
    ],
  },

  js.configs.recommended,
  tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // apps/web: navegador + hooks de React.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },

  // apps/api: Node. Los decoradores de Nest usan parámetros de constructor.
  // Incluye los `.mjs` de `scripts/`: `db:seed` los ejecuta con `node` directo,
  // sin paso de compilación, así que también corren en Node.
  {
    files: ['apps/api/**/*.{ts,mjs}'],
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },

  // packages/*: código isomórfico. Sin globals de Node ni de navegador por defecto.
  {
    files: ['packages/**/*.ts'],
    languageOptions: { globals: {} },
  },

  forbidNodeBuiltins,
  forbidImpurity,

  // Los archivos de configuración de la raíz y de las apps sí corren en Node.
  {
    files: ['*.js', '**/*.config.{ts,js,mjs}'],
    languageOptions: { globals: globals.node },
  },
);
