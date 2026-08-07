import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Config aparte de `vitest.config.mts` a propósito.
 *
 * Los tests de funciones puras (`src/**\/*.spec.ts`) corren en milisegundos y esa
 * propiedad se pierde si empiezan a levantar contenedores. Acá vive lo que
 * necesita un Postgres real: `test/**\/*.int-spec.ts`, con `testTimeout` amplio
 * porque el primer arranque baja la imagen y aplica las migraciones.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.int-spec.ts'],
    root: './',
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // Un contenedor por archivo se paga caro y los tests comparten la misma
    // tabla: en serie, con una base por archivo, el aislamiento es explícito.
    fileParallelism: false,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
