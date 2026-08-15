import { describe, expect, it } from 'vitest';
import type { RecurrenceSeries } from '@hs/contracts';

import { seriesKey } from './presentation';

const SITE = '11111111-1111-4111-8111-111111111111';
const LOCATION = '22222222-2222-4222-8222-222222222222';

function series(overrides: Partial<RecurrenceSeries> = {}): RecurrenceSeries {
  return {
    site_id: SITE,
    item_key: 'dock.guards',
    location_id: LOCATION,
    ...overrides,
  } as RecurrenceSeries;
}

describe('la clave de la serie', () => {
  it('distingue dos series del mismo ítem en ubicaciones distintas', () => {
    expect(seriesKey(series())).not.toBe(
      seriesKey(series({ location_id: '33333333-3333-4333-8333-333333333333' })),
    );
  });

  it('en modo `item` la ubicación es nula y la clave no colisiona con la de una ubicación', () => {
    expect(seriesKey(series({ location_id: null }))).toBe(`${SITE}:dock.guards:all`);
  });
});
