import { describe, expect, it } from 'vitest';

import { deriveManualObjectKey } from '../uploads/object-storage';
import { foreignManualKeys, manualObjectKeyPrefix } from './object-key';

const SITE = '11111111-1111-4111-8111-111111111111';
const DRAFT = '22222222-2222-4222-8222-222222222222';

describe('el prefijo del hallazgo manual', () => {
  /**
   * La afirmación que importa: lo que el servidor firma es lo que el servidor acepta.
   * Se compara contra `deriveManualObjectKey` real y no contra una cadena escrita a
   * mano — si el prefijo cambiara de un lado, esto lo dice. Mismo criterio que el caso
   * equivalente de `inspections/submission.spec.ts`.
   */
  it('acepta la key que uploads deriva para este borrador', () => {
    const derived = deriveManualObjectKey(SITE, DRAFT);

    expect(derived.startsWith(manualObjectKeyPrefix(SITE, DRAFT))).toBe(true);
    expect(foreignManualKeys([derived], SITE, DRAFT)).toEqual([]);
  });

  it('rechaza la key de otro borrador', () => {
    const other = deriveManualObjectKey(SITE, '33333333-3333-4333-8333-333333333333');

    expect(foreignManualKeys([other], SITE, DRAFT)).toEqual([other]);
  });

  it('rechaza la key de otra planta', () => {
    const other = deriveManualObjectKey('44444444-4444-4444-8444-444444444444', DRAFT);

    expect(foreignManualKeys([other], SITE, DRAFT)).toEqual([other]);
  });

  /**
   * El segmento `manual/` es lo que impide que la key de una inspección programada
   * pase por la de un borrador con el mismo uuid. Sin él los dos prefijos serían
   * `{site}/{uuid}/` y esta comprobación no diría nada.
   */
  it('rechaza la key de una inspección programada aunque comparta el uuid', () => {
    const asInspection = `${SITE}/${DRAFT}/foto.jpg`;

    expect(foreignManualKeys([asInspection], SITE, DRAFT)).toEqual([asInspection]);
  });

  it('una lista vacía no tiene keys ajenas', () => {
    expect(foreignManualKeys([], SITE, DRAFT)).toEqual([]);
  });
});
