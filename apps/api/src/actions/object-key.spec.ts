import { describe, expect, it } from 'vitest';

import { deriveActionObjectKey } from '../uploads/object-storage';
import { actionObjectKeyPrefix, foreignEvidenceKeys } from './object-key';

const SITE = '11111111-1111-4111-8111-111111111111';
const ACTION = '22222222-2222-4222-8222-222222222222';

describe('el prefijo de la evidencia de una acción', () => {
  /**
   * La afirmación que importa: lo que el servidor firma es lo que el servidor acepta.
   * Se compara contra `deriveActionObjectKey` real y no contra una cadena escrita a
   * mano — si el prefijo cambiara de un lado, esto lo dice. Mismo criterio que los dos
   * casos equivalentes de `findings/object-key.spec.ts` y `inspections/submission.spec.ts`.
   */
  it('acepta la key que uploads deriva para esta acción', () => {
    const derived = deriveActionObjectKey(SITE, ACTION);

    expect(derived.startsWith(actionObjectKeyPrefix(SITE, ACTION))).toBe(true);
    expect(foreignEvidenceKeys([derived], SITE, ACTION)).toEqual([]);
  });

  it('rechaza la key de otra acción', () => {
    const other = deriveActionObjectKey(SITE, '33333333-3333-4333-8333-333333333333');

    expect(foreignEvidenceKeys([other], SITE, ACTION)).toEqual([other]);
  });

  it('rechaza la key de otra planta', () => {
    const other = deriveActionObjectKey('44444444-4444-4444-8444-444444444444', ACTION);

    expect(foreignEvidenceKeys([other], SITE, ACTION)).toEqual([other]);
  });

  /**
   * El segmento `actions/` es lo que impide que la key de una inspección programada o
   * la de un hallazgo manual pasen por la de una acción con el mismo uuid. Sin él, los
   * tres prefijos competirían por la misma forma y esta comprobación no diría nada.
   */
  it('rechaza la key de una inspección o de un hallazgo manual con el mismo uuid', () => {
    const asInspection = `${SITE}/${ACTION}/foto.jpg`;
    const asManual = `${SITE}/manual/${ACTION}/foto.jpg`;

    expect(foreignEvidenceKeys([asInspection, asManual], SITE, ACTION)).toEqual([
      asInspection,
      asManual,
    ]);
  });

  it('devuelve solo las ajenas cuando la lista está mezclada', () => {
    const mine = deriveActionObjectKey(SITE, ACTION);
    const other = deriveActionObjectKey(SITE, '55555555-5555-4555-8555-555555555555');

    expect(foreignEvidenceKeys([mine, other, mine], SITE, ACTION)).toEqual([other]);
  });

  it('una lista vacía no tiene keys ajenas', () => {
    expect(foreignEvidenceKeys([], SITE, ACTION)).toEqual([]);
  });
});
