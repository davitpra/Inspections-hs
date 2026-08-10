import { describe, expect, it } from 'vitest';

import {
  PROBABILITIES,
  SEVERITIES,
  type Probability,
  type RiskLevel,
  type Severity,
} from '@hs/contracts';

import { riskLevel } from './risk';

/**
 * Las 25 celdas, escritas a mano.
 *
 * A propósito no se generan con el mismo producto que implementa la función: una
 * tabla generada por el código que prueba solo demuestra que el código hace lo que
 * hace. Escritas, dicen qué significa cada combinación, y una celda que cambie sin
 * querer se ve.
 *
 * La otra mitad de la garantía está en `test/findings.int-spec.ts`, que corre estas
 * mismas 25 contra `hs_risk_level` en Postgres.
 */
const MATRIX: readonly (readonly [Probability, Severity, RiskLevel])[] = [
  // rare (1)
  ['rare', 'negligible', 'low'], //          1
  ['rare', 'minor', 'low'], //               2
  ['rare', 'moderate', 'low'], //            3
  ['rare', 'major', 'low'], //               4
  ['rare', 'catastrophic', 'medium'], //     5

  // unlikely (2)
  ['unlikely', 'negligible', 'low'], //      2
  ['unlikely', 'minor', 'low'], //           4
  ['unlikely', 'moderate', 'medium'], //     6
  ['unlikely', 'major', 'medium'], //        8
  ['unlikely', 'catastrophic', 'high'], //  10

  // possible (3)
  ['possible', 'negligible', 'low'], //      3
  ['possible', 'minor', 'medium'], //        6
  ['possible', 'moderate', 'medium'], //     9
  ['possible', 'major', 'high'], //         12
  ['possible', 'catastrophic', 'critical'], // 15

  // likely (4)
  ['likely', 'negligible', 'low'], //        4
  ['likely', 'minor', 'medium'], //          8
  ['likely', 'moderate', 'high'], //        12
  ['likely', 'major', 'critical'], //       16
  ['likely', 'catastrophic', 'critical'], // 20

  // almost_certain (5)
  ['almost_certain', 'negligible', 'medium'], //  5
  ['almost_certain', 'minor', 'high'], //        10
  ['almost_certain', 'moderate', 'critical'], // 15
  ['almost_certain', 'major', 'critical'], //    20
  ['almost_certain', 'catastrophic', 'critical'], // 25
];

describe('riskLevel', () => {
  it.each(MATRIX)('%s × %s es %s', (probability, severity, expected) => {
    expect(riskLevel(probability, severity)).toBe(expected);
  });

  it('cubre las 25 celdas de la matriz', () => {
    expect(MATRIX).toHaveLength(PROBABILITIES.length * SEVERITIES.length);

    const seen = new Set(MATRIX.map(([p, s]) => `${p}:${s}`));

    expect(seen.size).toBe(25);
  });

  /**
   * Monótona en los dos ejes: subir la probabilidad o la severidad nunca baja el
   * nivel. Es la propiedad que hace que la matriz signifique algo, y la que una
   * "corrección" de una celda suelta rompería.
   */
  it('no baja de nivel al subir cualquiera de los dos ejes', () => {
    const order: readonly RiskLevel[] = ['low', 'medium', 'high', 'critical'];
    const rank = (level: RiskLevel): number => order.indexOf(level);

    PROBABILITIES.forEach((probability, p) => {
      SEVERITIES.forEach((severity, s) => {
        const here = rank(riskLevel(probability, severity));
        const nextProbability = PROBABILITIES[p + 1];
        const nextSeverity = SEVERITIES[s + 1];

        if (nextProbability) {
          expect(rank(riskLevel(nextProbability, severity))).toBeGreaterThanOrEqual(here);
        }

        if (nextSeverity) {
          expect(rank(riskLevel(probability, nextSeverity))).toBeGreaterThanOrEqual(here);
        }
      });
    });
  });
});
