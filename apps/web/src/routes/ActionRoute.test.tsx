import { describe, expect, it } from 'vitest';
import { ASSIGNEE, transitionsFrom, type Action, type ActionState, type Session } from '@hs/contracts';

import { canAttempt } from './action-permissions';

const PERSON = '11111111-1111-4111-8111-111111111111';
const OTHER_PERSON = '22222222-2222-4222-8222-222222222222';

function action(state: ActionState): Action {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    site_id: '44444444-4444-4444-8444-444444444444',
    finding_id: '55555555-5555-4555-8555-555555555555',
    assignee_person_id: PERSON,
    description: 'Install a fixed guard on the infeed of line 3',
    severity: 'major',
    due_at: '2026-08-17T13:00:00.000Z',
    remediation_group_id: null,
    created_by: '66666666-6666-4666-8666-666666666666',
    created_at: '2026-08-10T13:00:00.000Z',
    state,
    overdue: false,
    events: [],
    escalations: [],
  };
}

function session(role: Session['role'], personId = PERSON): Session {
  return {
    userId: '77777777-7777-4777-8777-777777777777',
    personId,
    role,
    siteScope: ['44444444-4444-4444-8444-444444444444'],
    purpose: 'full',
    recordsFrom: null,
    recordsTo: null,
  };
}

/** Lo que la pantalla ofrece, derivado de la misma tabla que el servidor aplica. */
function offered(state: ActionState, actor: Session | null): string[] {
  return transitionsFrom(state)
    .filter((transition) => canAttempt(transition, action(state), actor))
    .map((transition) => transition.to);
}

describe('los botones del detalle', () => {
  it('el responsable puede empezar y declarar hecho, y nada más', () => {
    const assignee = session('supervisor', PERSON);

    expect(offered('open', assignee)).toEqual(['in_progress']);
    expect(offered('in_progress', assignee)).toEqual(['awaiting_verification']);
  });

  it('un supervisor que no es el responsable no puede empezarla', () => {
    // `supervisor` no está entre los roles de `open → in_progress`: ahí solo están el
    // responsable y el coordinador. Que la cuenta sea supervisora no la vuelve dueña de
    // la acción de otro.
    expect(offered('open', session('supervisor', OTHER_PERSON))).toEqual([]);
  });

  it('el coordinador puede avanzar en nombre de otro', () => {
    const coordinator = session('hs_coordinator', OTHER_PERSON);

    expect(offered('open', coordinator)).toEqual(['in_progress']);
    expect(offered('in_progress', coordinator)).toEqual(['awaiting_verification']);
  });

  it('un supervisor cualquiera sí puede verificar', () => {
    expect(offered('awaiting_verification', session('supervisor', OTHER_PERSON)).sort()).toEqual([
      'closed',
      'in_progress',
    ]);
  });

  it('gerencia verifica y no ejecuta', () => {
    const management = session('management', OTHER_PERSON);

    expect(offered('open', management)).toEqual([]);
    expect(offered('awaiting_verification', management).sort()).toEqual(['closed', 'in_progress']);
  });

  it('un miembro del JHSC y un auditor externo no ven ningún botón', () => {
    for (const role of ['jhsc_member', 'external_auditor'] as const) {
      for (const state of ['open', 'in_progress', 'awaiting_verification'] as const) {
        expect(offered(state, session(role, OTHER_PERSON))).toEqual([]);
      }
    }
  });

  it('una acción cerrada no ofrece nada a nadie', () => {
    for (const role of ['hs_coordinator', 'supervisor', 'management'] as const) {
      expect(offered('closed', session(role))).toEqual([]);
    }
  });

  it('sin sesión no se ofrece nada', () => {
    expect(offered('open', null)).toEqual([]);
  });

  /**
   * La regla del verificador NO vive acá y este test lo fija: la pantalla ofrece el
   * botón y el servidor responde `verifier_is_executor`. Media regla copiada en el
   * cliente es una que puede separarse de la otra mitad sin que nada se queje.
   */
  it('la pantalla no intenta adivinar si quien mira fue el ejecutor', () => {
    const executor = session('supervisor', PERSON);

    expect(offered('awaiting_verification', executor)).toContain('closed');
  });

  it('el responsable no aparece como rol en las transiciones de verificación', () => {
    const verifying = transitionsFrom('awaiting_verification');

    expect(verifying.every((transition) => !transition.roles.includes(ASSIGNEE))).toBe(true);
  });
});
