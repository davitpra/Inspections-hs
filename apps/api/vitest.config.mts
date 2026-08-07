import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Nest depende de `emitDecoratorMetadata`, que esbuild no implementa. SWC sí:
// es la vía soportada para correr Vitest sobre código con decoradores de Nest.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    root: './',
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
