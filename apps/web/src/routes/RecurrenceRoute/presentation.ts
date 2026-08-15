import type { RecurrenceSeries } from '@hs/contracts';

/** En modo `item` la ubicación es nula, así que la clave de React la omite. */
export function seriesKey(series: RecurrenceSeries): string {
  return `${series.site_id}:${series.item_key}:${series.location_id ?? 'all'}`;
}
