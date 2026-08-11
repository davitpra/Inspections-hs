import { serwist } from '@serwist/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * ADR-003 / design D1 — Vite, y el service worker escrito a mano.
 *
 * `injectManifest` y no `generateSW`: el service worker es código propio
 * (`src/sw.ts`) y `@serwist/vite` solo le inyecta la lista de precache. La pieza más
 * importante del change no puede vivir detrás de una capa de configuración.
 *
 * `rollupFormat: 'iife'` mantiene el service worker como script clásico: un módulo
 * requiere `{ type: 'module' }` en el `register`, que Android soporta pero que no
 * aporta nada acá y agrega un modo más en el que la instalación puede fallar en el
 * campo.
 */
export default defineConfig({
  server: {
    // Vite por defecto escucha solo en `127.0.0.1`. Bajo WSL2 el navegador de Windows
    // resuelve `localhost` a `::1` primero y el reenvío no llega a esa escucha IPv4:
    // el dev server queda inalcanzable. Escuchar en todas las interfaces también es lo
    // que permite abrir la PWA desde un teléfono en la misma red, que es la única forma
    // de probar de verdad la instalación y el modo offline.
    host: true,
    port: 5173,
  },
  plugins: [
    react(),
    serwist({
      swSrc: 'src/sw.ts',
      swDest: 'sw.js',
      globDirectory: 'dist',
      injectionPoint: 'self.__SW_MANIFEST',
      rollupFormat: 'iife',
      // El precache tiene que incluir el bundle entero, y `@hs/forms` va adentro: el
      // service worker tiene que poder renderizar la inspección sin una sola petición
      // de red (ADR-007).
      globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
      // Una foto de 25 MB no está en el bundle, pero el tope por defecto de 2 MiB deja
      // afuera el chunk del motor de formularios el día que crezca. Que el precache
      // esté completo importa más que su tamaño: se paga una vez, con red.
      maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
});
