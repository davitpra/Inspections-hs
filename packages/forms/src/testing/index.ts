import { templateDocumentSchema } from '../document/schema.js';
import { validateAnswers } from '../document/validate.js';
import { evaluateVisibility } from '../document/visibility.js';

import type { EngineCase, ExpectedViolation } from './cases.js';

export * from './cases.js';

/**
 * El recorrido de un caso, compartido por los dos entornos.
 *
 * El comparador también viaja en el paquete y no se reescribe de cada lado: si
 * `apps/api` armara su propia comparación, la tabla probaría que los dos
 * entornos coinciden con dos criterios distintos, que es justo lo que no sirve.
 */

function normalize(violations: readonly ExpectedViolation[]): string[] {
  return violations.map(({ item_key, code }) => `${item_key}:${code}`).sort();
}

/**
 * Corre un caso y devuelve las diferencias encontradas. Un array vacío es un
 * caso que pasa; cada entrada nombra el caso y qué no coincidió.
 */
export function runEngineCase(engineCase: EngineCase): string[] {
  const failures: string[] = [];
  const parsed = templateDocumentSchema.safeParse(engineCase.document);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');

    return [`${engineCase.name}: el documento del caso no parsea — ${issues}`];
  }

  const document = parsed.data;
  const result = validateAnswers(document, engineCase.answers);
  const actual = normalize(result.ok ? [] : result.violations);
  const expected = normalize(engineCase.expected);

  if (actual.join(' | ') !== expected.join(' | ')) {
    failures.push(
      `${engineCase.name}: se esperaba [${expected.join(', ')}] y se obtuvo [${actual.join(', ')}]`,
    );
  }

  if (engineCase.expected_visibility) {
    const visibility = evaluateVisibility(document, engineCase.answers);

    for (const [itemKey, expectedVisible] of Object.entries(engineCase.expected_visibility)) {
      if (visibility[itemKey] !== expectedVisible) {
        failures.push(
          `${engineCase.name}: se esperaba que "${itemKey}" fuera ${
            expectedVisible ? 'visible' : 'oculto'
          } y no lo fue`,
        );
      }
    }
  }

  return failures;
}
