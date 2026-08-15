import { useState } from 'react';
import type { InspectionSchedule, ScheduledInspection } from '@hs/contracts';

import { CalendarIcon, GridIcon, ListIcon } from './icons';
import { earliestEligibleYear, projectYear, yearStats } from './presentation';
import { PeriodRow } from './PeriodRow';
import { UnopenedPeriodRow } from './UnopenedPeriodRow';

/**
 * Los períodos que la planta debe para un año, con su estado y su dueño donde ya existen.
 *
 * UN AÑO A LA VEZ, navegable sin tope hacia adelante — la obligación es mensual, así que
 * se conoce para cualquier año futuro. Hacia atrás no se puede ir más allá de lo que
 * `earliestEligibleYear` encuentra: no tiene sentido hojear un año en el que ninguna regla
 * debía nada.
 *
 * Doce meses por regla vigente, no la lista `DESC` que entrega el servidor: es
 * `projectYear` quien decide, mes a mes, si hay que mostrar la fila real o la casilla
 * `unopened` — ver `presentation.ts`.
 */
export function PeriodsSection({
  rules,
  periods,
  siteId,
  canAdminister,
  year,
  onYearChange,
}: {
  rules: readonly InspectionSchedule[];
  periods: readonly ScheduledInspection[];
  siteId: string;
  canAdminister: boolean;
  year: string;
  onYearChange: (year: string) => void;
}): React.JSX.Element {
  const entries = projectYear(rules, periods, year);
  const earliestYear = earliestEligibleYear(rules, periods, year);
  const canGoBack = year > earliestYear;
  const stats = yearStats(entries);

  const [view, setView] = useState<'grid' | 'list'>('grid');

  return (
    <section>
      <h2>Scheduled inspections</h2>

      <div className="calendar-toolbar">
        <div className="year-nav">
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

        <div className="view-toggle">
          <button
            type="button"
            className="view-toggle__button"
            aria-pressed={view === 'grid'}
            onClick={() => setView('grid')}
          >
            <GridIcon size={16} /> Grid view
          </button>
          <button
            type="button"
            className="view-toggle__button"
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
          >
            <ListIcon size={16} /> List view
          </button>
        </div>
      </div>

      <ul className={view === 'grid' ? 'grid grid--scheduling' : 'grid--list'}>
        {entries.map((entry) =>
          entry.kind === 'opened' ? (
            <PeriodRow
              key={entry.inspection.id}
              inspection={entry.inspection}
              siteId={siteId}
              canAdminister={canAdminister}
            />
          ) : (
            <UnopenedPeriodRow
              key={`${entry.period.template_id}|${entry.period.period_start}`}
              period={entry.period}
              siteId={siteId}
              canAdminister={canAdminister}
            />
          ),
        )}
      </ul>

      <div className="stats-bar">
        <div className="stats-bar__item">
          <span className="stats-bar__icon">
            <CalendarIcon size={22} />
          </span>
          <span>
            <span className="stats-bar__number">{stats.total}</span>
            <span className="stats-bar__label">Total months</span>
          </span>
        </div>
        <div className="stats-bar__item">
          <span className="stats-bar__icon">
            <CalendarIcon size={22} />
          </span>
          <span>
            <span className="stats-bar__number">{stats.assigned}</span>
            <span className="stats-bar__label">Assigned</span>
          </span>
        </div>
        <div className="stats-bar__item">
          <span className="stats-bar__icon">
            <CalendarIcon size={22} />
          </span>
          <span>
            <span className="stats-bar__number">{stats.unassigned}</span>
            <span className="stats-bar__label">Unassigned</span>
          </span>
        </div>
        <div className="stats-bar__item">
          <span className="stats-bar__icon">
            <CalendarIcon size={22} />
          </span>
          <span>
            <span className="stats-bar__number">{stats.notOpened}</span>
            <span className="stats-bar__label">Not opened yet</span>
          </span>
        </div>

        {/*
          Lo que el número de "Not opened yet" no dice: abrir no es adelantar trabajo, es
          congelar la versión de la plantilla (design.md — el `template_version_id` no se
          puede mover después). El pie del calendario es donde se mira ese número, así que
          es donde tiene que estar la consecuencia.
        */}
        <p className="stats-bar__tip">
          Tip: opening a month locks the template version and makes it available for
          inspection.
        </p>
      </div>
    </section>
  );
}
