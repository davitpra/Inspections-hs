import { describe, expect, it, vi } from 'vitest';

import type { SessionContext } from '../auth/session.service';
import { IncidentsController } from './incidents.controller';

const SITE = '11111111-1111-4111-8111-111111111111';
const session = {
  userId: '22222222-2222-4222-8222-222222222222',
  personId: '33333333-3333-4333-8333-333333333333',
  role: 'management',
  siteIds: [SITE],
  sessionId: '44444444-4444-4444-8444-444444444444',
  email: 'manager@example.com',
} satisfies SessionContext;

describe('IncidentsController.roster', () => {
  it('parsea site_id antes de delegar al servicio', async () => {
    const roster = [{
      id: '55555555-5555-4555-8555-555555555555',
      employee_number: 'E-1',
      first_name: 'Alex',
      last_name: 'Boivin',
    }];
    const service = { roster: vi.fn().mockResolvedValue(roster) };
    const controller = new IncidentsController(service as never);

    await expect(controller.roster(session, SITE)).resolves.toEqual(roster);
    expect(service.roster).toHaveBeenCalledWith(session, SITE);
  });

  it.each([undefined, 'not-a-uuid'])('rechaza site_id inválido: %s', async (siteId) => {
    const service = { roster: vi.fn() };
    const controller = new IncidentsController(service as never);

    await expect(controller.roster(session, siteId)).rejects.toBeTruthy();
    expect(service.roster).not.toHaveBeenCalled();
  });
});
