import { ROLES, type Role, type Session } from '@hs/contracts';
import { describe, expect, it } from 'vitest';

import {
  canAddPersonToRoster,
  canAdministerRoster,
  canAdministerScheduling,
  canAuthorTemplates,
  canDeactivateTemplates,
  canPublishTemplates,
  canInviteFromRoster,
  canImportRoster,
} from './session';

const SITE = '11111111-1111-4111-8111-111111111111';

function session(role: Role): Session {
  return {
    userId: '22222222-2222-4222-8222-222222222222',
    personId: '33333333-3333-4333-8333-333333333333',
    role,
    siteScope: [SITE],
    recordsFrom: null,
    recordsTo: null,
  };
}

const permissions = [
  ['canAdministerRoster', canAdministerRoster],
  ['canAdministerScheduling', canAdministerScheduling],
  ['canInviteFromRoster', canInviteFromRoster],
  ['canImportRoster', canImportRoster],
  ['canAddPersonToRoster', canAddPersonToRoster],
  ['canAuthorTemplates', canAuthorTemplates],
  ['canPublishTemplates', canPublishTemplates],
  ['canDeactivateTemplates', canDeactivateTemplates],
] as const;

describe.each(permissions)('%s', (_name, allows) => {
  it('se lo concede al coordinador', () => {
    expect(allows(session('hs_coordinator'))).toBe(true);
  });

  /**
   * Se recorren los cinco roles de `ROLES` en vez de listar los cuatro negados a mano: un
   * rol nuevo en contracts entra solo a este test, y entra negado, que es el default que
   * corresponde. Si alguna vez debe permitirse, se decide acá y no por omisión.
   */
  it.each(ROLES.filter((role) => role !== 'hs_coordinator'))('se lo niega a %s', (role) => {
    expect(allows(session(role))).toBe(false);
  });

  it('se lo niega a quien no tiene cuenta resuelta todavía', () => {
    expect(allows(null)).toBe(false);
  });
});
