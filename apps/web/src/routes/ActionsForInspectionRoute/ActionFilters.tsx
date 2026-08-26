import type {
  ActionSiteFilter,
  ActionSourceFilter,
  ActionStatusFilter,
  FilterOption,
} from './presentation';

const STATUS_OPTIONS: readonly FilterOption<ActionStatusFilter>[] = [
  { value: 'active', label: 'Active' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'awaiting_verification', label: 'Awaiting verification' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All statuses' },
];

export function ActionFilters({
  status,
  source,
  site,
  sources,
  sites,
  onStatus,
  onSource,
  onSite,
}: {
  status: ActionStatusFilter;
  source: ActionSourceFilter;
  site: ActionSiteFilter;
  sources: readonly FilterOption<ActionSourceFilter>[];
  sites: readonly FilterOption<string>[];
  onStatus: (value: ActionStatusFilter) => void;
  onSource: (value: ActionSourceFilter) => void;
  onSite: (value: ActionSiteFilter) => void;
}): React.JSX.Element {
  return (
    <div className="filters actions-filters" aria-label="Corrective action filters">
      <label>
        Status
        <select value={status} onChange={(event) => onStatus(event.target.value as ActionStatusFilter)}>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Source
        <select value={source} onChange={(event) => onSource(event.target.value as ActionSourceFilter)}>
          {sources.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {sites.length > 1 ? (
        <label>
          Site
          <select value={site} onChange={(event) => onSite(event.target.value)}>
            <option value="all">All sites</option>
            {sites.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
