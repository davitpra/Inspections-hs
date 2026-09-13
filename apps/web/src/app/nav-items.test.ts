import type { Session } from '@hs/contracts';
import { describe, expect, it } from 'vitest';

import { NAV_ITEMS, sectionTitle, visibleNavItems } from './nav-items';

function account(role: Session['role']): Session {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    personId: '22222222-2222-4222-8222-222222222222',
    role,
    siteScope: ['33333333-3333-4333-8333-333333333333'],
  };
}

describe('visibleNavItems', () => {
  it('todos los destinos tienen un icono', () => {
    expect(NAV_ITEMS.every((item) => typeof item.icon === 'function')).toBe(true);
  });

  it('no ofrece un workspace independiente de acciones correctivas', () => {
    expect(NAV_ITEMS.some((item) => item.label === 'Corrective actions')).toBe(false);
  });

  it.each(['coordinator', 'management'] as const)('ofrece la administración a %s', (role) => {
    const labels = visibleNavItems(account(role)).map((item) => item.label);

    expect(labels).toEqual(expect.arrayContaining(['Scheduling', 'People', 'Templates', 'Locations']));
  });

  it('no se los ofrece a un miembro del JHSC', () => {
    const labels = visibleNavItems(account('inspector')).map((item) => item.label);

    expect(labels).not.toContain('Scheduling');
    expect(labels).not.toContain('People');
    // Y sí conserva lo que es de todos: el menú no queda vacío.
    expect(labels).toContain('Inspections');
  });
});

describe('sectionTitle', () => {
  it('nombra la raíz sin dejar que sea prefijo de todo', () => {
    expect(sectionTitle('/')).toBe('Inspections');
    expect(sectionTitle('/outbox')).toBe('Waiting to be sent');
    expect(sectionTitle('/historical')).toBe('Historical inspections');
  });

  it('nombra las pantallas con id, que son a las que se llega desde otra', () => {
    expect(sectionTitle('/inspections/abc-123/capture')).toBe('Inspection');
    expect(sectionTitle('/inspections/abc-123/review')).toBe('Review');
  });

  /**
   * `matches` exige el mismo número de segmentos, así que
   * `/findings` no cubre `/findings/abc-123` y el detalle caería al nombre de la
   * aplicación — que en el teléfono es lo único que dice dónde se está.
   */
  it('nombra la lista de hallazgos y también el envío que se abre desde ella', () => {
    expect(sectionTitle('/findings')).toBe('Findings');
    expect(sectionTitle('/findings/abc-123')).toBe('Inspection findings');
  });

  it('prefiere el patrón específico al comodín, en el orden en que están escritos', () => {
    expect(sectionTitle('/incidents/report')).toBe('Report an incident');
    expect(sectionTitle('/incidents/abc-123')).toBe('Incident');
    expect(sectionTitle('/incidents/abc-123/form7')).toBe('Form 7');
    expect(sectionTitle('/inspections/abc-123')).toBe('Inspection');
  });

  it('nunca devuelve vacío: una URL desconocida cae al nombre de la aplicación', () => {
    expect(sectionTitle('/no-existe')).toBe('Health & Safety');
  });
});
