import { describe, expect, it } from 'vitest';

import {
  PERIOD_MONTHS,
  PERIOD_MONTHS_LABELS,
  PERIOD_STATUSES,
  periodLabel,
  periodMonthsSchema,
  periodStatusSchema,
} from './periods.js';

describe('period vocabulary', () => {
  it('keeps the four operational statuses', () => {
    expect(PERIOD_STATUSES).toEqual(['completed', 'missed', 'cancelled', 'open']);
    for (const status of PERIOD_STATUSES) expect(periodStatusSchema.parse(status)).toBe(status);
  });

  it('keeps supported frequencies and labels', () => {
    expect(PERIOD_MONTHS).toEqual([1, 3, 6, 12]);
    for (const months of PERIOD_MONTHS) {
      expect(periodMonthsSchema.parse(months)).toBe(months);
      expect(PERIOD_MONTHS_LABELS[months]).toBeTruthy();
    }
  });

  it('labels monthly periods', () => {
    expect(periodLabel('2026-08-01')).toBe('August 2026');
  });

  it('uses calendar shorthand only for aligned periods', () => {
    expect(periodLabel('2026-01-01', 3)).toBe('Q1 2026');
    expect(periodLabel('2026-02-01', 3)).toBe('Feb–Apr 2026');
    expect(periodLabel('2026-01-01', 6)).toBe('H1 2026');
    expect(periodLabel('2026-03-01', 6)).toBe('Mar–Aug 2026');
    expect(periodLabel('2026-01-01', 12)).toBe('2026');
  });

  it('names both years when a period crosses the calendar boundary', () => {
    expect(periodLabel('2026-11-01', 3)).toBe('Nov 2026–Jan 2027');
    expect(periodLabel('2026-09-01', 12)).toBe('Sep 2026–Aug 2027');
  });
});
