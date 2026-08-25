import { z } from 'zod';

export const PERIOD_STATUSES = ['completed', 'missed', 'cancelled', 'open'] as const;
export const periodStatusSchema = z.enum(PERIOD_STATUSES);
export type PeriodStatus = z.infer<typeof periodStatusSchema>;

export const PERIOD_MONTHS = [1, 3, 6, 12] as const;
export const periodMonthsSchema = z.union([
  z.literal(1),
  z.literal(3),
  z.literal(6),
  z.literal(12),
]);
export type PeriodMonths = z.infer<typeof periodMonthsSchema>;

export const PERIOD_MONTHS_LABELS: Readonly<Record<PeriodMonths, string>> = {
  1: 'Monthly',
  3: 'Quarterly',
  6: 'Semiannual',
  12: 'Annual',
};

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function periodLabel(periodStart: string, periodMonths: PeriodMonths = 1): string {
  const year = Number(periodStart.slice(0, 4));
  const month = Number(periodStart.slice(5, 7));

  if (periodMonths === 1) return `${MONTH_NAMES[month - 1]!} ${year}`;
  if (periodMonths === 12 && month === 1) return String(year);
  if (periodMonths === 6 && month % 6 === 1) return `H${Math.floor((month - 1) / 6) + 1} ${year}`;
  if (periodMonths === 3 && month % 3 === 1) return `Q${Math.floor((month - 1) / 3) + 1} ${year}`;

  const endOffset = month - 1 + periodMonths - 1;
  const endYear = year + Math.floor(endOffset / 12);
  const start = MONTH_NAMES[month - 1]!.slice(0, 3);
  const end = MONTH_NAMES[endOffset % 12]!.slice(0, 3);

  return endYear === year ? `${start}–${end} ${year}` : `${start} ${year}–${end} ${endYear}`;
}
