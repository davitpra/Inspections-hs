import { describe, expect, it } from 'vitest';

import { VIOLATION_CODES } from '../document/validate.js';

import { ENGINE_CASES, runEngineCase } from './index.js';

/**
 * El lado cliente de la garantía de ADR-007. El lado servidor corre esta misma
 * tabla en `apps/api/test/forms-engine.int-spec.ts`.
 */
describe('tabla de casos compartida', () => {
  it.each(ENGINE_CASES.map((engineCase) => [engineCase.name, engineCase] as const))(
    '%s',
    (_name, engineCase) => {
      expect(runEngineCase(engineCase)).toEqual([]);
    },
  );

  it('cubre todos los códigos de violación', () => {
    const covered = new Set(
      ENGINE_CASES.flatMap((engineCase) =>
        engineCase.expected.map((violation) => violation.code),
      ),
    );

    expect([...VIOLATION_CODES].filter((code) => !covered.has(code))).toEqual([]);
  });
});
