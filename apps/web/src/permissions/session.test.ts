import { ROLES, type Role, type Session } from '@hs/contracts';
import { describe, expect, it } from 'vitest';

import {
  canAddPersonToRoster,
  canAdministerCatalog,
  canAdministerRoster,
  canAdministerScheduling,
  canAuthorTemplates,
  canDeactivateTemplates,
  canDemote,
  canPublishTemplates,
  canInviteFromRoster,
  canImportRoster,
  canPromote,
  canReviewSiteInspections,
} from './session';

const SITE = '11111111-1111-4111-8111-111111111111';

function session(role: Role): Session {
  return {
    userId: '22222222-2222-4222-8222-222222222222',
    personId: '33333333-3333-4333-8333-333333333333',
    role,
    siteScope: [SITE],
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
  ['canAdministerCatalog', canAdministerCatalog],
  ['canReviewSiteInspections', canReviewSiteInspections],
] as const;

describe.each(permissions)('%s', (_name, allows) => {
  it('se lo concede al coordinador', () => {
    expect(allows(session('coordinator'))).toBe(true);
  });

  it('se lo concede a management', () => {
    expect(allows(session('management'))).toBe(true);
  });

  it.each(ROLES.filter((role) => role === 'inspector'))('se lo niega a %s', (role) => {
    expect(allows(session(role))).toBe(false);
  });

  it('se lo niega a quien no tiene cuenta resuelta todavía', () => {
    expect(allows(null)).toBe(false);
  });
});

describe('canPromote', () => {
  it('se lo concede solo a management', () => {
    expect(canPromote(session('management'))).toBe(true);
    expect(canPromote(session('coordinator'))).toBe(false);
    expect(canPromote(session('inspector'))).toBe(false);
    expect(canPromote(null)).toBe(false);
  });
});

describe('canDemote', () => {
  it('se lo concede solo a management', () => {
    expect(canDemote(session('management'))).toBe(true);
    expect(canDemote(session('coordinator'))).toBe(false);
    expect(canDemote(session('inspector'))).toBe(false);
    expect(canDemote(null)).toBe(false);
  });
});
