import type { InspectionSchedule } from '@hs/contracts';

import { CalendarIcon, GridIcon, ListIcon } from '../../components/icons';
import { currentRules, type ScheduleFilter, type ScheduleFilters, type YearStats } from './presentation';

const FILTERS: readonly { value: ScheduleFilter; label: string; count?: keyof YearStats }[] = [
  { value: 'all', label: 'All' },
  { value: 'completed', label: 'Completed', count: 'completed' },
  { value: 'missed', label: 'Missed', count: 'missed' },
  { value: 'unassigned', label: 'Unassigned', count: 'unassigned' },
  { value: 'unopened', label: 'Not opened', count: 'unopened' },
];

export function ScheduleToolbar({
  year,
  canGoBack,
  onYearChange,
  rules,
  filters,
  onFiltersChange,
  stats,
  view,
  onViewChange,
}: {
  year: string;
  canGoBack: boolean;
  onYearChange: (year: string) => void;
  rules: readonly InspectionSchedule[];
  filters: ScheduleFilters;
  onFiltersChange: (filters: ScheduleFilters) => void;
  stats: YearStats;
  view: 'matrix' | 'list';
  onViewChange: (view: 'matrix' | 'list') => void;
}): React.JSX.Element {
  const clearFilters = () => onFiltersChange({ templateId: 'all', state: 'all' });
  const hasFilters = filters.templateId !== 'all' || filters.state !== 'all';

  return (
    <div className="schedule-toolbar">
      <div className="year-nav" aria-label="Calendar year">
        <button
          type="button"
          className="year-nav__arrow"
          disabled={!canGoBack}
          onClick={() => onYearChange(String(Number(year) - 1))}
        >
          ← {Number(year) - 1}
        </button>
        <div className="year-nav__current">
          <CalendarIcon size={18} />
          <h3>{year}</h3>
        </div>
        <button
          type="button"
          className="year-nav__arrow"
          onClick={() => onYearChange(String(Number(year) + 1))}
        >
          {Number(year) + 1} →
        </button>
      </div>

      <div className="schedule-toolbar__controls">
        <label htmlFor="schedule-requirement-filter">Requirement</label>
        <select
          id="schedule-requirement-filter"
          value={filters.templateId}
          onChange={(event) => onFiltersChange({ ...filters, templateId: event.target.value })}
        >
          <option value="all">All requirements</option>
          {currentRules(rules).map((rule) => (
            <option key={rule.template_id} value={rule.template_id}>{rule.template_name}</option>
          ))}
        </select>

        <div className="schedule-toolbar__states" aria-label="Schedule state filters">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className="schedule-filter"
              aria-pressed={filters.state === filter.value}
              onClick={() => onFiltersChange({ ...filters, state: filter.value })}
            >
              {filter.label}{filter.count ? ` (${stats[filter.count]})` : ''}
            </button>
          ))}
        </div>

        {hasFilters ? (
          <button type="button" className="schedule-toolbar__clear" onClick={clearFilters}>
            Clear filters
          </button>
        ) : null}
      </div>

      <div className="view-toggle" aria-label="Schedule presentation">
        <button
          type="button"
          className="view-toggle__button"
          aria-pressed={view === 'matrix'}
          onClick={() => onViewChange('matrix')}
        >
          <GridIcon size={16} /> Matrix
        </button>
        <button
          type="button"
          className="view-toggle__button"
          aria-pressed={view === 'list'}
          onClick={() => onViewChange('list')}
        >
          <ListIcon size={16} /> List
        </button>
      </div>
    </div>
  );
}
