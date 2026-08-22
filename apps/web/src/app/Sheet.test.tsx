import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Sheet } from './Sheet';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * Lo que se prueba acá es la SALIDA del panel, que es lo único que el componente aporta
 * por sí mismo: el resto —foco atrapado, Escape, el fondo inerte— lo pone `showModal()`
 * del navegador, y jsdom lo simula con el atributo `open` (ver `src/test/setup.ts`).
 *
 * `onClose` se avisa por el evento `close` del `<dialog>` y no por el `onClick` del botón:
 * así el mismo camino cubre a las tres formas de salir, y una de ellas —Escape— nunca pasa
 * por el botón. La suite adelanta el reloj para dejar terminar la transición de salida.
 */
describe('Sheet', () => {
  it('cierra desde el botón del encabezado', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();

    render(
      <Sheet side="start" label="Menu" onClose={onClose}>
        <p>Contenido</p>
      </Sheet>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    act(() => vi.runAllTimers());

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('escribe el nombre del panel y lo usa como nombre accesible del diálogo', () => {
    render(
      <Sheet side="end" label="Account" onClose={vi.fn()}>
        <p>Contenido</p>
      </Sheet>,
    );

    expect(screen.getByRole('heading', { name: 'Account' })).toBeDefined();
    expect(screen.getByRole('dialog', { name: 'Account' })).toBeDefined();
  });
});
