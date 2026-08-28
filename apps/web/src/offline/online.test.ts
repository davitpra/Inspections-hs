import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useOnline } from './online';

/** `navigator.onLine` es de solo lectura: se sustituye la propiedad para la prueba. */
function setNavigatorOnLine(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
}

afterEach(() => setNavigatorOnLine(true));

describe('useOnline', () => {
  it('arranca con lo que dice el navegador', () => {
    setNavigatorOnLine(false);

    const { result } = renderHook(() => useOnline());

    expect(result.current).toBe(false);
  });

  it('sigue los eventos de red en los dos sentidos', () => {
    const { result } = renderHook(() => useOnline());

    expect(result.current).toBe(true);

    act(() => {
      setNavigatorOnLine(false);
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current).toBe(false);

    act(() => {
      setNavigatorOnLine(true);
      window.dispatchEvent(new Event('online'));
    });

    expect(result.current).toBe(true);
  });
});
