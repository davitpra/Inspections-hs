import {
  PROBABILITIES,
  SEVERITIES,
  type Probability,
  type RiskLevel,
  type Severity,
} from '@hs/contracts';

/**
 * ADR-008, "la derivación de estado" — las reglas viven en funciones puras, sin
 * base, testeables en milisegundos con tabla de casos.
 *
 * La matriz de probabilidad × severidad de R2. **Está escrita dos veces**: acá y
 * como `hs_risk_level` en la migración 0010, que alimenta la columna generada.
 *
 * La duplicación es deliberada. La de SQL existe para que no haya ningún camino
 * —endpoint, seed, INSERT a mano— por el que alguien escriba un nivel que la
 * matriz no dio; esta existe para que la UI y la respuesta del endpoint tengan el
 * nivel sin una ida y vuelta a la base. SQL no puede importar TypeScript, así que
 * la única defensa posible es una prueba: `findings.int-spec.ts` evalúa las 25
 * celdas por los dos caminos y las compara. Mismo precedente que el `CHECK` de
 * `response_type` en 0007.
 */

/** El índice 1..5 de cada eje. El orden de las listas de `@hs/contracts` ES la escala. */
function rank<T extends string>(scale: readonly T[], value: T): number {
  return scale.indexOf(value) + 1;
}

/**
 * El nivel de riesgo de una clasificación.
 *
 * Producto de los dos índices, con cortes en 4, 9 y 14. Un producto y no una tabla
 * de 25 celdas escritas a mano porque la matriz de riesgo estándar ES un producto:
 * escribirla celda por celda invitaría a que alguien "corrija" una celda suelta y
 * la escala deje de ser monótona sin que nada se queje. Las 25 celdas están, pero
 * en el test, que es donde sirven.
 */
export function riskLevel(probability: Probability, severity: Severity): RiskLevel {
  const score = rank(PROBABILITIES, probability) * rank(SEVERITIES, severity);

  if (score <= 4) return 'low';
  if (score <= 9) return 'medium';
  if (score <= 14) return 'high';

  return 'critical';
}

/**
 * No hay acá ninguna función que juzgue el nivel de control, y esa ausencia es
 * deliberada: R2 pide **registrar** en qué nivel de la jerarquía está la solución
 * propuesta, no aprobarla. Un sistema que rechazara "guantes" para un riesgo
 * crítico conseguiría que alguien escriba "controles de ingeniería", no que se
 * instale una guarda.
 */
