import type { Location, OrganizationLocation } from '@hs/contracts';
import { describe, expect, it } from 'vitest';

import {
  assignedLocation,
  availableLocations,
  canCreate,
  mappingProgress,
  progressLabel,
  sortShared,
  suggestCode,
  unmappedLocations,
} from './presentation';

const ST_THOMAS = '11111111-1111-4111-8111-111111111111';
const GLENCOE = '22222222-2222-4222-8222-222222222222';

let counter = 0;

function shared(code: string, name = code): OrganizationLocation {
  counter += 1;
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(counter).padStart(12, '0')}`,
    code,
    name,
    deactivated_at: null,
  };
}

function location(overrides: Partial<Location> = {}): Location {
  counter += 1;
  return {
    id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(counter).padStart(12, '0')}`,
    site_id: ST_THOMAS,
    code: 'dock',
    name: 'Dock',
    deactivated_at: null,
    organization_location_code: null,
    ...overrides,
  };
}

describe('assignedLocation', () => {
  it('encuentra la física de ESTA planta que representa a la compartida', () => {
    const dock = shared('loading-dock', 'Loading dock');
    const here = location({ name: 'Dock east', organization_location_code: 'loading-dock' });
    const there = location({
      site_id: GLENCOE,
      name: 'Dock west',
      organization_location_code: 'loading-dock',
    });

    expect(assignedLocation(dock, [there, here], ST_THOMAS)?.id).toBe(here.id);
  });

  it('no encuentra nada cuando la compartida no tiene lugar en esta planta', () => {
    const dock = shared('loading-dock');
    const other = location({ organization_location_code: 'cold-storage' });

    expect(assignedLocation(dock, [other], ST_THOMAS)).toBeUndefined();
  });
});

describe('availableLocations', () => {
  /**
   * Es la mitad de la razón de existir de este archivo: `UNIQUE (site_id,
   * organization_location_id)` rechaza el duplicado, así que ofrecer una física ya tomada
   * sería ofrecer un error de Postgres.
   */
  it('excluye las físicas que ya representan a OTRA compartida', () => {
    const dock = shared('loading-dock');
    const free = location({ name: 'Free' });
    const taken = location({ name: 'Taken', organization_location_code: 'cold-storage' });

    expect(availableLocations(dock, [free, taken], ST_THOMAS).map((l) => l.name)).toEqual(['Free']);
  });

  it('incluye la que YA tiene, o el select no podría mostrar su propio valor', () => {
    const dock = shared('loading-dock');
    const mine = location({ name: 'Mine', organization_location_code: 'loading-dock' });

    expect(availableLocations(dock, [mine], ST_THOMAS).map((l) => l.name)).toEqual(['Mine']);
  });

  it('no ofrece las de la otra planta', () => {
    const dock = shared('loading-dock');
    const elsewhere = location({ site_id: GLENCOE, name: 'Elsewhere' });

    expect(availableLocations(dock, [elsewhere], ST_THOMAS)).toEqual([]);
  });

  it('las ordena por nombre', () => {
    const dock = shared('loading-dock');
    const rows = [location({ name: 'Zulu' }), location({ name: 'Alpha' })];

    expect(availableLocations(dock, rows, ST_THOMAS).map((l) => l.name)).toEqual(['Alpha', 'Zulu']);
  });
});

describe('mappingProgress', () => {
  it('cuenta solo las compartidas que tienen lugar en esta planta', () => {
    const a = shared('a');
    const b = shared('b');
    const mapped = location({ organization_location_code: 'a' });

    expect(mappingProgress([a, b], [mapped], ST_THOMAS)).toEqual({ mapped: 1, total: 2 });
  });

  it('un mapeo de la otra planta no cuenta para esta', () => {
    const a = shared('a');
    const elsewhere = location({ site_id: GLENCOE, organization_location_code: 'a' });

    expect(mappingProgress([a], [elsewhere], ST_THOMAS)).toEqual({ mapped: 0, total: 1 });
  });
});

describe('progressLabel', () => {
  it('dice cuántas sobre cuántas', () => {
    expect(progressLabel({ mapped: 9, total: 11 })).toBe('9 of 11 shared locations mapped here');
  });

  it('el catálogo vacío no se lee como "0 de 0"', () => {
    expect(progressLabel({ mapped: 0, total: 0 })).toBe('No shared locations yet');
  });
});

describe('unmappedLocations', () => {
  it('devuelve las físicas de esta planta que ninguna compartida usa', () => {
    const orphan = location({ name: 'Orphan' });
    const used = location({ name: 'Used', organization_location_code: 'a' });
    const elsewhere = location({ site_id: GLENCOE, name: 'Elsewhere' });

    expect(unmappedLocations([orphan, used, elsewhere], ST_THOMAS).map((l) => l.name)).toEqual([
      'Orphan',
    ]);
  });
});

describe('sortShared', () => {
  it('ordena por nombre sin mutar la entrada', () => {
    const input = [shared('z', 'Zulu'), shared('a', 'Alpha')];
    const sorted = sortShared(input);

    expect(sorted.map((s) => s.name)).toEqual(['Alpha', 'Zulu']);
    expect(input.map((s) => s.name)).toEqual(['Zulu', 'Alpha']);
  });
});

describe('suggestCode', () => {
  it('propone un code que el catálogo acepta', () => {
    expect(suggestCode('Loading dock — east')).toBe('loading-dock-east');
  });

  it('saca acentos', () => {
    expect(suggestCode('Depósito')).toBe('deposito');
  });

  it('devuelve vacío cuando no queda nada utilizable', () => {
    expect(suggestCode('   ')).toBe('');
    expect(suggestCode('???')).toBe('');
  });
});

describe('canCreate', () => {
  it('exige nombre y un code válido', () => {
    expect(canCreate('Loading dock', 'loading-dock')).toBe(true);
    expect(canCreate('   ', 'loading-dock')).toBe(false);
    expect(canCreate('Loading dock', '')).toBe(false);
    expect(canCreate('Loading dock', 'Loading Dock')).toBe(false);
  });
});
