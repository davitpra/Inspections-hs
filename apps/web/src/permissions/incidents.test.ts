import { describe, expect, it } from 'vitest';
import type { Incident, Session } from '@hs/contracts';

import { availableTransitions } from './incidents';

const PERSON = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

function session(role: Session['role']): Session {
  return {
    userId: USER,
    personId: PERSON,
    role,
    siteScope: ['33333333-3333-4333-8333-333333333333'],
    recordsFrom: null,
    recordsTo: null,
  };
}

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    site_id: '33333333-3333-4333-8333-333333333333',
    form_version: 1,
    classification: 'first_aid',
    subject_person_id: PERSON,
    reported_by: USER,
    occurred_at: '2026-03-02T13:00:00.000Z',
    reported_at: '2026-03-02T14:00:00.000Z',
    location_id: '55555555-5555-4555-8555-555555555555',
    task_performed: 'Moving pallets',
    equipment_involved: 'Forklift #4',
    what_happened: 'The load shifted',
    body_part: 'hand_or_finger',
    on_site_treatment: 'first_aid_on_site',
    immediate_action: 'Area cordoned off',
    narrative_language: 'en',
    created_at: '2026-03-02T14:00:00.000Z',
    state: 'reported',
    clocks: [],
    fields_of_version: [
      'occurred_at',
      'location_id',
      'task_performed',
      'equipment_involved',
      'what_happened',
      'body_part',
      'on_site_treatment',
      'witnesses',
      'immediate_action',
    ],
    witnesses: [],
    events: [],
    investigation: null,
    ...overrides,
  };
}

describe('qué botones ofrece la pantalla', () => {
  it('el supervisor que reportó no puede investigar ni cerrar', () => {
    expect(availableTransitions(incident(), session('supervisor'))).toEqual([]);
  });

  it('gerencia tampoco: §4 dice que investigar y cerrar son del coordinador', () => {
    expect(availableTransitions(incident(), session('management'))).toEqual([]);
  });

  it('el coordinador puede investigar y cerrar un primeros auxilios', () => {
    const available = availableTransitions(incident(), session('hs_coordinator'));

    expect(available.map((transition) => transition.to).sort()).toEqual([
      'closed',
      'under_investigation',
    ]);
  });

  /**
   * La mitad de la regla que SÍ se puede resolver sin la base: la clasificación decide si
   * el cierre directo existe siquiera. Las otras dos —causa raíz y acciones abiertas—
   * dependen de otras filas y las contesta el servidor.
   */
  it('una lesión crítica no ofrece el cierre directo, ni siquiera al coordinador', () => {
    const available = availableTransitions(
      incident({ classification: 'critical_injury' }),
      session('hs_coordinator'),
    );

    expect(available.map((transition) => transition.to)).toEqual(['under_investigation']);
  });

  it('sin sesión no se ofrece nada', () => {
    expect(availableTransitions(incident(), null)).toEqual([]);
  });

  it('un incidente cerrado ofrece reabrir al coordinador y nada a los demás', () => {
    const closed = incident({ state: 'closed' });

    expect(
      availableTransitions(closed, session('hs_coordinator')).map((transition) => transition.to),
    ).toEqual(['under_investigation']);
    expect(availableTransitions(closed, session('supervisor'))).toEqual([]);
  });
});
