import type { Person } from '@hs/contracts';
import { describe, expect, it } from 'vitest';

import {
  matchesSearch,
  personLabel,
  sortRoster,
  statusClass,
  statusLabel,
} from './presentation';

const SITE_A = '11111111-1111-4111-8111-111111111111';

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    site_id: SITE_A,
    employee_number: '10472',
    first_name: 'Ada',
    last_name: 'Reid',
    deactivated_at: null,
    ...overrides,
  };
}

describe('personLabel', () => {
  it('siempre lleva el número de empleado — el nombre no identifica', () => {
    expect(personLabel(person())).toBe('Reid, Ada (10472)');
  });

  it('distingue a dos homónimos', () => {
    const one = personLabel(person({ employee_number: '10472' }));
    const other = personLabel(person({ employee_number: '10473' }));

    expect(one).not.toBe(other);
  });
});

describe('el estado', () => {
  it('nombra activa e inactiva', () => {
    expect(statusLabel(person())).toBe('Active');
    expect(statusLabel(person({ deactivated_at: '2026-01-01T00:00:00.000Z' }))).toBe('Inactive');
  });

  it('no inventa colores: solo clases de la capa semántica', () => {
    expect(statusClass(person())).toBe('badge');
    expect(statusClass(person({ deactivated_at: '2026-01-01T00:00:00.000Z' }))).toContain(
      'badge--',
    );
  });
});

describe('matchesSearch', () => {
  it('encuentra por número de empleado, que es como busca quien lo tiene', () => {
    expect(matchesSearch(person(), '10472')).toBe(true);
    expect(matchesSearch(person(), '999')).toBe(false);
  });

  it('encuentra por apellido a medias y sin distinguir mayúsculas', () => {
    expect(matchesSearch(person(), 'rei')).toBe(true);
    expect(matchesSearch(person(), 'REID')).toBe(true);
  });

  it('encuentra por nombre', () => {
    expect(matchesSearch(person(), 'ada')).toBe(true);
  });

  it('ignora los acentos — "Álvarez" tipeado sin tilde tiene que encontrar', () => {
    const alvarez = person({ last_name: 'Álvarez' });

    expect(matchesSearch(alvarez, 'alvarez')).toBe(true);
    expect(matchesSearch(alvarez, 'álvarez')).toBe(true);
  });

  it('una búsqueda vacía no filtra nada', () => {
    expect(matchesSearch(person(), '')).toBe(true);
    expect(matchesSearch(person(), '   ')).toBe(true);
  });
});

describe('sortRoster', () => {
  it('ordena por apellido y después por nombre', () => {
    const sorted = sortRoster([
      person({ id: 'a', last_name: 'Zeta', first_name: 'Ana' }),
      person({ id: 'b', last_name: 'Alvarez', first_name: 'Bruno' }),
      person({ id: 'c', last_name: 'Alvarez', first_name: 'Ana' }),
    ]);

    expect(sorted.map((row) => row.id)).toEqual(['c', 'b', 'a']);
  });

  it('desempata por número de empleado: dos homónimos no se intercambian entre renders', () => {
    const rows = [
      person({ id: 'second', employee_number: '10473' }),
      person({ id: 'first', employee_number: '10472' }),
    ];

    expect(sortRoster(rows).map((row) => row.id)).toEqual(['first', 'second']);
    expect(sortRoster(rows.slice().reverse()).map((row) => row.id)).toEqual(['first', 'second']);
  });

  it('no muta la lista que recibe', () => {
    const rows = [person({ id: 'z', last_name: 'Zeta' }), person({ id: 'a', last_name: 'Alfa' })];
    sortRoster(rows);

    expect(rows.map((row) => row.id)).toEqual(['z', 'a']);
  });
});
