import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';

import { listScheduled, listSchedules, listSites, listTemplates } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { InfoIcon } from '../../components/icons';
import { YearNavigator } from '../../components/YearNavigator';
import { canAdministerScheduling } from '../../permissions/session';
import { currentCivilYear } from '../../presentation/dates';
import { earliestEligibleYear, frequencyNote, type YearEntry } from '../../presentation/scheduling';
import { AssignInspectorDialog } from './AssignInspectorDialog';
import { OpenPeriodDialog } from './OpenPeriodDialog';
import { RequirementPeriodRow } from './RequirementPeriodRow';
import { entryKey, periodLabel, requirementYear } from './presentation';

export function ScheduleRequirementRoute(): React.JSX.Element {
  const { scheduleId } = useParams({ from: '/scheduling/$scheduleId' });
  const { account } = useAppSession();
  const schedules = useQuery({ queryKey: queryKeys.inspectionSchedules(), queryFn: listSchedules, retry: false });
  const scheduled = useQuery({ queryKey: queryKeys.scheduledInspections(), queryFn: listScheduled, retry: false });
  const sites = useQuery({ queryKey: queryKeys.sites(), queryFn: listSites, retry: false });
  const canAdminister = canAdministerScheduling(account);
  const rule = schedules.data?.find((candidate) => candidate.id === scheduleId);
  const templates = useQuery({
    queryKey: queryKeys.templates(),
    queryFn: listTemplates,
    enabled: canAdminister && rule !== undefined,
    retry: false,
  });
  const [year, setYear] = useState(() => currentCivilYear());
  /*
    Qué se está por escribir, colgado de la RUTA y no de la fila: al abrirse un período la
    entrada pasa de `unopened` a `opened` y con eso cambia su `key`, así que la fila que
    disparó la acción deja de existir mientras el diálogo todavía tiene que poder mostrar
    el error (misma razón que `SchedulingRoute/RequirementConfirmDialog`).
  */
  const [acting, setActing] = useState<{ entry: YearEntry; kind: 'open' | 'assign' } | null>(null);

  const changeYear = (nextYear: string) => {
    setYear(nextYear);
    setActing(null);
  };

  if (schedules.isLoading || scheduled.isLoading || sites.isLoading) {
    return <p className="status-card">Loading requirement plan…</p>;
  }

  if (schedules.isError || scheduled.isError || sites.isError) {
    return <p className="status-card status-card--error"><InfoIcon size={20} /> This view needs a connection. The requirement plan could not be loaded.</p>;
  }

  if (!rule) {
    return (
      <div className="status-card">
        <h1>Requirement not found</h1>
        <p>This requirement is not visible to your account.</p>
        <Link className="back-link" to="/scheduling">Back to scheduling</Link>
      </div>
    );
  }

  const periods = (scheduled.data ?? []).filter((period) => period.site_id === rule.site_id && period.template_id === rule.template_id);
  const entries = requirementYear(rule, periods, year);
  const siteName = sites.data?.find((site) => site.id === rule.site_id)?.name ?? 'Site not visible';
  const earliestYear = earliestEligibleYear([rule], periods, year);
  const publishedVersion = templates.data?.find((template) => template.id === rule.template_id)?.latest_version ?? null;

  return (
    <>
      <header className="annual-plan__header">
        <Link className="back-link" to="/scheduling">Back to scheduling</Link>
        <h1>{rule.template_name}</h1>
        <p className="annual-plan__meta">{siteName} · {frequencyNote(rule)}</p>
        <p className="notice-card annual-plan__cadence-note">The cadence cannot be changed here. To change it, deactivate this requirement and create another.</p>
      </header>
      <section className="annual-plan" aria-labelledby="annual-plan-heading">
        <div className="annual-plan__head">
          <div>
            <h2 id="annual-plan-heading">Annual plan</h2>
            <p className="note">Each period owed by this requirement, with its inspector.</p>
          </div>
          <YearNavigator year={year} earliestYear={earliestYear} onYearChange={changeYear} />
        </div>
        {entries.length === 0 ? (
          <div className="schedule-empty"><strong>No periods owed in this year.</strong><span>This requirement owes no period in {year}.</span></div>
        ) : (
          <div className="annual-plan__table-wrap">
            <table className="table annual-plan__table" aria-label={`Annual plan for ${rule.template_name}`}>
              <thead>
                <tr>
                  <th scope="col">Period</th>
                  <th scope="col">Status</th>
                  <th scope="col">Inspector</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <RequirementPeriodRow
                    key={entryKey(entry)}
                    entry={entry}
                    year={year}
                    canAdminister={canAdminister}
                    publishedVersion={publishedVersion}
                    onAct={(kind) => setActing({ entry, kind })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canAdminister && templates.isError ? <p className="notice notice--warn" role="alert">Published template version could not be loaded. Opening periods is unavailable.</p> : null}
        <p className="annual-plan__foot">Opening a period freezes the published template version. Assignment is a separate confirmed action.</p>
      </section>

      {acting?.kind === 'open' && acting.entry.kind === 'unopened' ? (
        <OpenPeriodDialog
          key={entryKey(acting.entry)}
          period={acting.entry.period}
          label={periodLabel(acting.entry, year)}
          publishedVersion={publishedVersion}
          onClose={() => setActing(null)}
        />
      ) : null}
      {acting?.kind === 'assign' && acting.entry.kind === 'opened' ? (
        <AssignInspectorDialog
          key={entryKey(acting.entry)}
          inspection={acting.entry.inspection}
          siteId={rule.site_id}
          label={periodLabel(acting.entry, year)}
          onClose={() => setActing(null)}
        />
      ) : null}
    </>
  );
}
