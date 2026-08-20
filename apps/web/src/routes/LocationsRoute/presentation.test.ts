import type { Location, OrganizationLocation } from '@hs/contracts';
import { describe, expect, it } from 'vitest';

import {
  assignedLocation,
  canCreate,
  coverage,
  matchesFilter,
  progressLabel,
  reusableLocation,
  siteProgress,
  sortShared,
  suggestCode,
  unmappedLocations,
  visibleLocations,
} from './presentation';

const ST_THOMAS = '11111111-1111-4111-8111-111111111111';
const GLENCOE = '22222222-2222-4222-8222-222222222222';
const BOTH = [ST_THOMAS, GLENCOE];

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

describe('reusableLocation', () => {
  /**
   * Destildar suelta el mapeo pero no borra la fila (ADR-002). Sin esto, volver a tildar
   * crearía una segunda física con el mismo código y el único `(site_id, code)` la rechaza.
   */
  it('recupera la física huérfana que lleva el código de la compartida', () => {
    const dock = shared('loading-dock');
    const dropped = location({ code: 'loading-dock', name: 'Loading dock' });

    expect(reusableLocation(dock, [dropped], ST_THOMAS)?.id).toBe(dropped.id);
  });

  it('no toca una que ya representa a otra compartida', () => {
    const dock = shared('loading-dock');
    const taken = location({ code: 'loading-dock', organization_location_code: 'cold-storage' });

    expect(reusableLocation(dock, [taken], ST_THOMAS)).toBeUndefined();
  });

  it('no cruza de planta', () => {
    const dock = shared('loading-dock');
    const elsewhere = location({ site_id: GLENCOE, code: 'loading-dock' });

    expect(reusableLocation(dock, [elsewhere], ST_THOMAS)).toBeUndefined();
  });

  /** «Dock east» representa al muelle pero no se llama como él: crear es lo correcto. */
  it('ignora una huérfana con otro código', () => {
    const dock = shared('loading-dock');
    const other = location({ code: 'dock-east' });

    expect(reusableLocation(dock, [other], ST_THOMAS)).toBeUndefined();
  });
});

describe('coverage', () => {
  it('distingue en todas, en algunas y en ninguna', () => {
    const dock = shared('loading-dock');
    const here = location({ organization_location_code: 'loading-dock' });
    const there = location({ site_id: GLENCOE, organization_location_code: 'loading-dock' });

    expect(coverage(dock, [here, there], BOTH)).toBe('every');
    expect(coverage(dock, [here], BOTH)).toBe('some');
    expect(coverage(dock, [], BOTH)).toBe('none');
  });

  /** Con una sola planta no hay «algunas»: o está o no está. */
  it('con una sola planta nunca dice "some"', () => {
    const dock = shared('loading-dock');
    const here = location({ organization_location_code: 'loading-dock' });

    expect(coverage(dock, [here], [ST_THOMAS])).toBe('every');
  });
});

describe('matchesFilter', () => {
  const dock = shared('loading-dock');
  const here = location({ organization_location_code: 'loading-dock' });
  const there = location({ site_id: GLENCOE, organization_location_code: 'loading-dock' });

  it('"all" no filtra nada', () => {
    expect(matchesFilter(dock, [], 'all', BOTH)).toBe(true);
  });

  it('"every" pide todas las plantas', () => {
    expect(matchesFilter(dock, [here, there], 'every', BOTH)).toBe(true);
    expect(matchesFilter(dock, [here], 'every', BOTH)).toBe(false);
  });

  /** «Solo acá» es tan exigente en lo que EXCLUYE como en lo que pide. */
  it('"solo esta planta" excluye la que también está en la otra', () => {
    expect(matchesFilter(dock, [here], { only: ST_THOMAS }, BOTH)).toBe(true);
    expect(matchesFilter(dock, [here, there], { only: ST_THOMAS }, BOTH)).toBe(false);
    expect(matchesFilter(dock, [there], { only: ST_THOMAS }, BOTH)).toBe(false);
  });
});

describe('visibleLocations', () => {
  const view = (over: Partial<Parameters<typeof visibleLocations>[2]> = {}) => ({
    filter: 'all' as const,
    query: '',
    siteIds: BOTH,
    direction: 'asc' as const,
    ...over,
  });

  it('busca por nombre y por código, sin distinguir mayúsculas', () => {
    const dock = shared('loading-dock', 'Loading dock');
    const cold = shared('cold-storage', 'Cold storage');
    const rows = [dock, cold];

    expect(visibleLocations(rows, [], view({ query: 'LOAD' })).map((s) => s.name)).toEqual([
      'Loading dock',
    ]);
    expect(visibleLocations(rows, [], view({ query: 'cold-st' })).map((s) => s.name)).toEqual([
      'Cold storage',
    ]);
  });

  it('combina el filtro con la búsqueda', () => {
    const dock = shared('loading-dock', 'Loading dock');
    const here = location({ organization_location_code: 'loading-dock' });

    expect(visibleLocations([dock], [here], view({ filter: 'every', query: 'loading' }))).toEqual(
      [],
    );
  });

  it('devuelve el resultado ordenado por nombre', () => {
    const rows = [shared('z', 'Zulu'), shared('a', 'Alpha')];

    expect(visibleLocations(rows, [], view()).map((s) => s.name)).toEqual(['Alpha', 'Zulu']);
  });

  /** El orden se aplica sobre lo que quedó, no sobre el catálogo entero. */
  it('ordena al revés lo que pasó el filtro', () => {
    const rows = [shared('g', 'Grading area'), shared('z', 'Zulu'), shared('a', 'Alpha')];

    expect(
      visibleLocations(rows, [], view({ direction: 'desc', query: 'l' })).map((s) => s.name),
    ).toEqual(['Zulu', 'Alpha']);
  });
});

describe('siteProgress', () => {
  it('cuenta solo las compartidas que tienen lugar en esta planta', () => {
    const a = shared('a');
    const b = shared('b');
    const mapped = location({ organization_location_code: 'a' });

    expect(siteProgress([a, b], [mapped], ST_THOMAS)).toEqual({ mapped: 1, total: 2 });
  });

  it('un mapeo de la otra planta no cuenta para esta', () => {
    const a = shared('a');
    const elsewhere = location({ site_id: GLENCOE, organization_location_code: 'a' });

    expect(siteProgress([a], [elsewhere], ST_THOMAS)).toEqual({ mapped: 0, total: 1 });
  });
});

describe('progressLabel', () => {
  it('dice cuántas sobre cuántas', () => {
    expect(progressLabel({ mapped: 9, total: 11 })).toBe('9 of 11');
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

  it('invierte con "desc", y tampoco muta', () => {
    const input = [shared('a', 'Alpha'), shared('z', 'Zulu')];

    expect(sortShared(input, 'desc').map((s) => s.name)).toEqual(['Zulu', 'Alpha']);
    expect(input.map((s) => s.name)).toEqual(['Alpha', 'Zulu']);
  });

  /** Los nombres los escribe una persona: el orden de puntos de código deja «Área» al final. */
  it('ordena con acentos donde una persona los buscaría', () => {
    const input = [shared('zona', 'Zona de carga'), shared('area', 'Área de bombas')];

    expect(sortShared(input).map((s) => s.name)).toEqual(['Área de bombas', 'Zona de carga']);
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
