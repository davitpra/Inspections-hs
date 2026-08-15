import { describe, expect, it } from 'vitest';

import { formatDay, formatInstant } from './dates';

describe('cómo se lee un instante', () => {
  it('un plazo se lee por día', () => {
    expect(formatDay('2026-08-17T13:00:00.000Z')).toBe('2026-08-17');
  });

  it('un reloj regulatorio se lee con la hora, que ahí es el plazo', () => {
    expect(formatInstant('2026-08-17T13:00:00.000Z')).toBe('2026-08-17 13:00');
  });

  /**
   * El motivo de recortar en vez de formatear con `Intl`: un envío de las 23:00 UTC no
   * puede aparecer con un día en una pantalla y con otro en la de al lado.
   */
  it('no desplaza al huso del dispositivo', () => {
    expect(formatDay('2026-08-17T23:30:00.000Z')).toBe('2026-08-17');
    expect(formatDay('2026-08-17T00:30:00.000Z')).toBe('2026-08-17');
  });
});
