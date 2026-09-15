import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  BODY_PARTS,
  INCIDENT_CLASSIFICATIONS,
  NARRATIVE_LANGUAGES,
  ON_SITE_TREATMENTS,
  reportIncidentRequestSchema,
  type ReportIncidentRequest,
  type Session,
} from '@hs/contracts';

import { listCatalogLocations } from '../../api/catalog';
import { listSites } from '../../api/inspections';
import { listIncidentRoster, reportIncident } from '../../api/incidents';
import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { SitePicker } from '../../components/SitePicker';
import { canReportIncident } from '../../permissions/incidents';
import { resolveSiteId } from '../../presentation/sites';
import {
  BODY_PART_LABELS,
  CLASSIFICATION_LABELS,
  TREATMENT_LABELS,
} from '../../presentation/incidents';
import { LocationPicker } from './LocationPicker';
import { PersonPicker } from './PersonPicker';
import { WitnessPicker } from './WitnessPicker';
import { subjectOptions, witnessOptions } from './presentation';

/**
 * Cargar un incidente en tercera persona (§3 R4).
 *
 * **Nueve campos cortos y ningún cuadro de texto libre único**, que es exactamente el
 * objetivo del cambio. Los selectores de persona muestran número de empleado y nombre,
 * y nada más: §4 exige elegir sin ver el perfil.
 *
 * **Esto es online.** No hay outbox: un accidente se carga desde una oficina o un teléfono
 * con señal, y un reporte esperando sincronización sería invisible mientras corren los plazos.
 */
export function ReportIncidentRoute(): React.JSX.Element {
  const { account } = useAppSession();

  if (!canReportIncident(account)) {
    return (
      <>
        <h1>Report an incident</h1>
        <p className="notice">Only coordinators and management can report incidents.</p>
      </>
    );
  }

  return <ReportIncidentForm account={account} />;
}

function ReportIncidentForm({ account }: { account: Session }): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [chosenSite, setChosenSite] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<ReportIncidentRequest>>({
    classification: 'first_aid',
    body_part: 'not_applicable',
    on_site_treatment: 'none',
    narrative_language: 'en',
    witness_person_ids: [],
  });
  const [error, setError] = useState<string | null>(null);

  const sites = useQuery({ queryKey: queryKeys.sites(), queryFn: listSites, retry: false });
  const locations = useQuery({
    queryKey: queryKeys.catalogLocations(),
    queryFn: listCatalogLocations,
    retry: false,
  });
  const siteId = resolveSiteId(sites.data ?? [], account.siteScope, chosenSite);
  const roster = useQuery({
    queryKey: queryKeys.incidentRoster(siteId),
    queryFn: () => listIncidentRoster(siteId),
    enabled: siteId !== '',
    retry: false,
  });

  const submit = useMutation({
    mutationFn: async () => reportIncident(reportIncidentRequestSchema.parse(form)),
    onSuccess: (incident) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.incidents() });
      void navigate({ to: '/incidents/$id', params: { id: incident.id } });
    },
    onError: (caught: Error) => setError(caught.message),
  });

  const set = <K extends keyof ReportIncidentRequest>(
    key: K,
    value: ReportIncidentRequest[K],
  ): void => setForm((previous) => ({ ...previous, [key]: value }));

  const sitesInScope = (sites.data ?? []).filter((site) => account.siteScope.includes(site.id));
  const siteName = (id: string): string =>
    sites.data?.find((site) => site.id === id)?.name ?? 'Site not visible';
  const changeSite = (nextSiteId: string): void => {
    setChosenSite(nextSiteId);
    setForm((previous) => ({
      ...previous,
      location_id: undefined,
      subject_person_id: undefined,
      witness_person_ids: [],
    }));
  };

  const queryMessages = (
    query: { isLoading: boolean; isError: boolean },
    loading: string,
    failed: string,
  ): React.JSX.Element | null => {
    if (query.isLoading) return <p className="status-card">{loading}</p>;
    if (query.isError) return <p className="status-card status-card--error">{failed}</p>;
    return null;
  };

  const sitesMessage = queryMessages(sites, 'Loading sites…', 'Sites could not be loaded.');
  const locationsMessage = queryMessages(
    locations,
    'Loading locations…',
    'Locations could not be loaded.',
  );
  const rosterMessage =
    siteId === ''
      ? null
      : queryMessages(roster, 'Loading people…', 'People could not be loaded.');

  if (sitesMessage || locationsMessage || rosterMessage || !sites.isSuccess || !locations.isSuccess) {
    return (
      <>
        <h1>Report an incident</h1>
        {sitesMessage}
        {locationsMessage}
        {rosterMessage}
      </>
    );
  }

  const ready = siteId !== '' && roster.isSuccess;

  return (
    <>
      <h1>Report an incident</h1>

      <p className="notice">
        You are reporting about somebody else. Pick the affected person from the list — you
        will not see their profile, and they do not need an account. Do not record a diagnosis,
        a medical report or any work restriction: this system stores the category of the event
        and nothing about the injury itself.
      </p>

      {sitesInScope.length > 0 ? (
        <SitePicker
          sites={sitesInScope}
          value={siteId}
          onChange={changeSite}
          siteName={siteName}
        />
      ) : (
        <p className="notice">No active site is available for this account.</p>
      )}

      {ready ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            submit.mutate();
          }}
        >
          <label>
            Where
            {/* GET /locations works because the null → reported roles are administrative;
                if that transition changes, this query must move to a route those roles can use. */}
            <LocationPicker
              locations={locations.data}
              siteId={siteId}
              value={form.location_id ?? ''}
              onChange={(value) => set('location_id', value)}
            />
          </label>

          <label>
            Affected person
            <PersonPicker
              options={subjectOptions(roster.data, account.personId)}
              value={form.subject_person_id ?? ''}
              onChange={(value) =>
                setForm((previous) => ({
                  ...previous,
                  subject_person_id: value,
                  witness_person_ids: (previous.witness_person_ids ?? []).filter(
                    (personId) => personId !== value,
                  ),
                }))
              }
            />
          </label>

          <label>
            Witnesses
            <WitnessPicker
              options={witnessOptions(
                roster.data,
                form.subject_person_id ?? '',
                form.witness_person_ids ?? [],
              )}
              value={form.witness_person_ids ?? []}
              onChange={(value) => set('witness_person_ids', value)}
            />
          </label>

          <label>
            Classification
            <select
              value={form.classification}
              onChange={(event) =>
                set('classification', event.target.value as ReportIncidentRequest['classification'])
              }
            >
              {INCIDENT_CLASSIFICATIONS.map((classification) => (
                <option key={classification} value={classification}>
                  {CLASSIFICATION_LABELS[classification]}
                </option>
              ))}
            </select>
          </label>

          <label>
            When it happened
            <input
              type="datetime-local"
              onChange={(event) => set('occurred_at', new Date(event.target.value).toISOString())}
            />
          </label>

          <label>
            What was the person doing
            <input
              value={form.task_performed ?? ''}
              onChange={(event) => set('task_performed', event.target.value)}
            />
          </label>

          <label>
            Equipment or material involved
            <input
              value={form.equipment_involved ?? ''}
              onChange={(event) => set('equipment_involved', event.target.value)}
            />
          </label>

          <label>
            What happened
            <input
              value={form.what_happened ?? ''}
              onChange={(event) => set('what_happened', event.target.value)}
            />
          </label>

          <label>
            Part of the body affected
            <select
              value={form.body_part}
              onChange={(event) =>
                set('body_part', event.target.value as ReportIncidentRequest['body_part'])
              }
            >
              {BODY_PARTS.map((part) => (
                <option key={part} value={part}>
                  {BODY_PART_LABELS[part]}
                </option>
              ))}
            </select>
          </label>

          <label>
            Treatment at the workplace
            <select
              value={form.on_site_treatment}
              onChange={(event) =>
                set(
                  'on_site_treatment',
                  event.target.value as ReportIncidentRequest['on_site_treatment'],
                )
              }
            >
              {ON_SITE_TREATMENTS.map((treatment) => (
                <option key={treatment} value={treatment}>
                  {TREATMENT_LABELS[treatment]}
                </option>
              ))}
            </select>
          </label>

          <label>
            What was done straight away
            <input
              value={form.immediate_action ?? ''}
              onChange={(event) => set('immediate_action', event.target.value)}
            />
          </label>

          <label>
            Language you wrote in
            <select
              value={form.narrative_language}
              onChange={(event) =>
                set(
                  'narrative_language',
                  event.target.value as ReportIncidentRequest['narrative_language'],
                )
              }
            >
              {NARRATIVE_LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {language === 'en' ? 'English' : 'Spanish'}
                </option>
              ))}
            </select>
          </label>

          <button type="submit" disabled={submit.isPending}>
            Report
          </button>
        </form>
      ) : null}

      {error ? <p className="notice">{error}</p> : null}
    </>
  );
}
