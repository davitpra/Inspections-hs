import type { Session } from '@hs/contracts';
import { describe, expect, it } from 'vitest';

import { sectionTitle, visibleNavItems } from './nav-items';

function account(role: Session['role']): Session {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    personId: '22222222-2222-4222-8222-222222222222',
    role,
    siteScope: ['33333333-3333-4333-8333-333333333333'],
    recordsFrom: null,
    recordsTo: null,
  };
}

describe('visibleNavItems', () => {
  it('ofrece programación y roster solo al coordinador', () => {
    const labels = visibleNavItems(account('hs_coordinator')).map((item) => item.label);

    expect(labels).toContain('Scheduling');
    expect(labels).toContain('Roster');
  });

  it('no se los ofrece a un inspector, que no puede administrar ninguna de las dos', () => {
    const labels = visibleNavItems(account('supervisor')).map((item) => item.label);

    expect(labels).not.toContain('Scheduling');
    expect(labels).not.toContain('Roster');
    // Y sí conserva lo que es de todos: el menú no queda vacío.
    expect(labels).toContain('Inspections');
  });
});

describe('sectionTitle', () => {
  it('nombra la raíz sin dejar que sea prefijo de todo', () => {
    expect(sectionTitle('/')).toBe('Inspections');
    expect(sectionTitle('/outbox')).toBe('Waiting to be sent');
  });

  it('nombra las pantallas con id, que son a las que se llega desde otra', () => {
    expect(sectionTitle('/inspections/abc-123/capture')).toBe('Inspection');
    expect(sectionTitle('/inspections/abc-123/review')).toBe('Review');
    expect(sectionTitle('/actions/abc-123')).toBe('Corrective action');
  });

  it('prefiere el patrón específico al comodín, en el orden en que están escritos', () => {
    expect(sectionTitle('/incidents/report')).toBe('Report an incident');
    expect(sectionTitle('/incidents/abc-123')).toBe('Incident');
    expect(sectionTitle('/incidents/abc-123/form7')).toBe('Form 7');
    expect(sectionTitle('/inspections/past')).toBe('Past inspections');
  });

  it('nunca devuelve vacío: una URL desconocida cae al nombre de la aplicación', () => {
    expect(sectionTitle('/no-existe')).toBe('Health & Safety');
  });
});
