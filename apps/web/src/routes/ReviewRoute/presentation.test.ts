import { describe, expect, it } from 'vitest';
import { FINDING_DESCRIPTION_MIN } from '@hs/contracts';

import { readableMissing } from './presentation';

describe('lo que le falta al hallazgo', () => {
  /**
   * El caso por el que la función existe: "missing description" cuando el inspector ya
   * escribió "ok" lo manda a mirar un campo que para él está lleno.
   */
  it('separa el campo vacío del campo demasiado corto', () => {
    expect(readableMissing('description')).toBe('missing description');
    expect(readableMissing('description_too_short')).toBe(
      `description shorter than ${FINDING_DESCRIPTION_MIN} characters`,
    );
  });

  it('nombra la ubicación y la foto', () => {
    expect(readableMissing('location')).toBe('missing location');
    expect(readableMissing('photo')).toBe('missing photo');
  });
});
