import { describe, expect, it } from 'vitest';

import { queryKeys } from './query-keys';

const INSPECTION = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '44444444-4444-4444-8444-444444444444';

describe('claves del espacio de acciones', () => {
  it('mantiene una clave compartida y estable para los hallazgos', () => {
    expect(queryKeys.findings()).toEqual(['findings']);
  });

  it('separa cada URL temporal por evidencia y conserva un prefijo invalidable', () => {
    expect(queryKeys.actionEvidence('evidence-a')).toEqual(['action-evidence', 'evidence-a']);
    expect(queryKeys.actionEvidence()).toEqual(['action-evidence']);
  });
});

/** `invalidateQueries` empareja por prefijo: esta es la regla que las claves deben cumplir. */
function isPrefixOf(
  prefix: readonly (string | number)[],
  candidate: readonly (string | number)[],
): boolean {
  return prefix.every((part, index) => candidate[index] === part);
}

/**
 * DOS FORMAS DE DATO NO PUEDEN COMPARTIR UNA ENTRADA DE CACHÉ.
 *
 * `CaptureRoute` guarda un envoltorio (`{ kind: 'loaded' | 'refused' }`) porque abre el
 * borrador y puede negarse; `ReviewRoute` guarda el borrador que devuelve `loadDraft`.
 * Cuando las dos claves coincidían, pasar de la captura a la revisión servía el
 * envoltorio de la primera a la segunda, que leía `.draft` de algo que no lo tiene y
 * rompía la pantalla entera al entrar.
 *
 * No lo agarra el test de ninguna de las dos rutas: cada uno monta la suya con un
 * `QueryClient` limpio, y el choque solo existe cuando las dos comparten cliente.
 */
describe('claves de borrador', () => {
  it('la consulta de captura y la de revisión no comparten entrada de caché', () => {
    expect(queryKeys.captureDraft(INSPECTION, ACCOUNT)).not.toEqual(
      queryKeys.draft(INSPECTION, ACCOUNT),
    );
  });

  it('las dos siguen cayendo bajo el prefijo que las invalida', () => {
    const prefix = queryKeys.draft(INSPECTION);

    expect(isPrefixOf(prefix, queryKeys.draft(INSPECTION, ACCOUNT))).toBe(true);
    expect(isPrefixOf(prefix, queryKeys.captureDraft(INSPECTION, ACCOUNT))).toBe(true);
  });

  it('la cuenta separa el borrador de dos usuarios del mismo dispositivo', () => {
    expect(queryKeys.draft(INSPECTION, ACCOUNT)).not.toEqual(queryKeys.draft(INSPECTION));
    expect(queryKeys.captureDraft(INSPECTION, ACCOUNT)).not.toEqual(
      queryKeys.captureDraft(INSPECTION),
    );
  });
});
