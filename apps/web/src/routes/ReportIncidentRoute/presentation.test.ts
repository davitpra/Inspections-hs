import { describe, expect, it } from 'vitest';
import type { Location, PersonOption } from '@hs/contracts';

import {
  locationsOfSite,
  matchPeople,
  personLabel,
  subjectOptions,
  witnessOptions,
} from './presentation';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

const people: PersonOption[] = [
  { id: A, employee_number: 'DEMO-1001', first_name: 'Alex', last_name: 'Boivin' },
  { id: B, employee_number: 'DEMO-1002', first_name: 'Priya', last_name: 'Raman' },
  { id: C, employee_number: 'DEMO-1003', first_name: 'Chen', last_name: 'Wu' },
];

describe('presentación del reporte de incidente', () => {
  it('forma la etiqueta visible sin añadir atributos de perfil', () => {
    expect(personLabel(people[0]!)).toBe('DEMO-1001 \u2014 Alex Boivin');
  });

  it.each(['1002', 'raman', 'Priya Raman', 'Raman Priya'])('encuentra por %s', (query) => {
    expect(matchPeople(people, query).map((person) => person.id)).toEqual([B]);
  });

  it('ignora mayúsculas, no devuelve una consulta vacía y respeta el límite', () => {
    expect(matchPeople(people, 'PRiYa')).toHaveLength(1);
    expect(matchPeople(people, '   ')).toEqual([]);
    expect(matchPeople([...people, ...people], 'demo', 2)).toHaveLength(2);
  });

  it('quita al reportante del sujeto y al sujeto y elegidos de los testigos', () => {
    expect(subjectOptions(people, A).map((person) => person.id)).toEqual([B, C]);
    expect(witnessOptions(people, B, [C]).map((person) => person.id)).toEqual([A]);
  });

  it('filtra ubicaciones por planta y actividad', () => {
    const locations: Location[] = [
      { id: A, site_id: A, code: 'line-a', name: 'Line A', deactivated_at: null },
      { id: B, site_id: B, code: 'line-b', name: 'Line B', deactivated_at: null },
      { id: C, site_id: A, code: 'old', name: 'Old', deactivated_at: '2026-01-01T00:00:00Z' },
    ];

    expect(locationsOfSite(locations, A).map((location) => location.id)).toEqual([A]);
  });
});
