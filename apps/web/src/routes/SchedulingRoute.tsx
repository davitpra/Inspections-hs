import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { InspectionSchedule, ScheduledInspection } from '@hs/contracts';

import {
  assignInspector,
  cancelScheduledInspection,
  createSchedule,
  listInspectorCandidates,
  listScheduled,
  listSchedules,
  listSites,
  listTemplates,
  updateSchedule,
} from '../api/inspections';
import { useAppSession } from '../app/session-context';
import {
  candidateLabel,
  inspectorLabel,
  isUnassigned,
  periodLabel,
  statusClass,
  STATUS_LABELS,
  unassignedNotice,
} from './scheduling-presentation';

/**
 * §4 — La consola de programación: qué debe esta planta y quién lo está haciendo.
 *
 * POR QUÉ ESTA PANTALLA EXISTE. La obligación mensual la abre un trabajo automático, y
 * cuando la regla no tiene inspector por defecto —que es como la deja el seed, a
 * propósito— la inspección nace con `inspector_id` nulo. `GET /me/pending-inspections`
 * filtra por inspector, así que esa inspección **no está en la lista de nadie**. El
 * coordinador recibe la notificación de que el período se abrió y, hasta acá, no tenía
 * dónde asignarla. Ese era el único eslabón de R1 que se resolvía con curl.
 *
 * UNA PANTALLA Y NO DOS. Las reglas y los períodos que esas reglas abrieron son la misma
 * pregunta; separarlas obligaría a llevar un UUID de una pantalla a la otra.
 *
 * **Administrar es del coordinador.** Los controles no aparecen para nadie más; el
 * servidor los rechaza igual, y esa duplicación es deliberada: la comprobación del
 * cliente evita ofrecer algo que va a fallar, y la del servidor es la que manda. Leer, en
 * cambio, queda abierto — un miembro del JHSC viendo la programación de su planta es
 * legítimo, y RLS ya recorta lo que puede ver.
 */
export function SchedulingRoute(): React.JSX.Element {
  const { account } = useAppSession();

  const sites = useQuery({ queryKey: ['sites'], queryFn: listSites, retry: false });
  const [chosenSite, setChosenSite] = useState<string | null>(null);

  const siteId = chosenSite ?? account?.siteScope[0] ?? '';

  const schedules = useQuery({
    queryKey: ['inspection-schedules'],
    queryFn: listSchedules,
    retry: false,
  });

  const scheduled = useQuery({
    queryKey: ['scheduled-inspections'],
    queryFn: listScheduled,
    retry: false,
  });

  const canAdminister = account?.role === 'hs_coordinator';

  const siteName = (id: string): string =>
    sites.data?.find((site) => site.id === id)?.name ?? id;

  const rules = (schedules.data ?? []).filter((rule) => rule.site_id === siteId);
  const periods = (scheduled.data ?? []).filter((entry) => entry.site_id === siteId);
  const notice = unassignedNotice(periods);

  return (
    <>
      <h1>Scheduling</h1>

      <SitePicker
        sites={sites.data ?? []}
        value={siteId}
        onChange={setChosenSite}
        siteName={siteName}
      />

      {schedules.isError || scheduled.isError ? (
        <p className="notice">This view needs a connection.</p>
      ) : null}
      {schedules.isLoading || scheduled.isLoading ? <p>Loading…</p> : null}

      {notice ? <p className="notice notice--warn">{notice}</p> : null}

      <RulesSection
        rules={rules}
        siteId={siteId}
        canAdminister={canAdminister}
        ready={schedules.isSuccess}
      />

      <PeriodsSection periods={periods} siteId={siteId} canAdminister={canAdminister} />
    </>
  );
}

/**
 * El selector de planta. Con un solo sitio en el alcance degrada a texto: un `<select>`
 * de una opción es un control que no controla nada.
 */
function SitePicker({
  sites,
  value,
  onChange,
  siteName,
}: {
  sites: readonly { id: string; name: string; deactivated_at: string | null }[];
  value: string;
  onChange: (siteId: string) => void;
  siteName: (id: string) => string;
}): React.JSX.Element {
  if (sites.length <= 1) {
    return <p className="note">Site: {siteName(value)}</p>;
  }

  return (
    <div className="filters">
      <label htmlFor="scheduling-site">Site</label>
      <select
        id="scheduling-site"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name}
            {site.deactivated_at === null ? '' : ' (closed)'}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Las reglas: qué debe esta planta todos los meses. */
function RulesSection({
  rules,
  siteId,
  canAdminister,
  ready,
}: {
  rules: readonly InspectionSchedule[];
  siteId: string;
  canAdminister: boolean;
  ready: boolean;
}): React.JSX.Element {
  return (
    <section>
      <h2>Recurrence rules</h2>

      {ready && rules.length === 0 ? (
        <p>This site owes no monthly inspection. Without a rule, no period is ever opened.</p>
      ) : null}

      <ul className="list">
        {rules.map((rule) => (
          <RuleRow key={rule.id} rule={rule} canAdminister={canAdminister} />
        ))}
      </ul>

      {canAdminister ? <NewRuleForm siteId={siteId} rules={rules} /> : null}
    </section>
  );
}

function RuleRow({
  rule,
  canAdminister,
}: {
  rule: InspectionSchedule;
  canAdminister: boolean;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const deactivate = useMutation({
    mutationFn: () => updateSchedule(rule.id, { deactivated: true }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['inspection-schedules'] });
    },
    onError: (caught: Error) => setError(caught.message),
  });

  const active = rule.deactivated_at === null;

  return (
    <li className="list__row">
      <span>{rule.template_name}</span>

      <span className="note">
        Default inspector: {rule.default_inspector_name ?? 'none'}
      </span>

      {active ? null : <span className="badge badge--closed">Deactivated</span>}

      {canAdminister && active ? (
        <button
          type="button"
          onClick={() => {
            // La confirmación dice QUÉ DEJA DE PASAR. «¿Estás seguro?» no informa nada:
            // desactivar corta la apertura de períodos futuros y hace que el reporte de
            // cobertura deje de contarlos como debidos.
            const confirmed = window.confirm(
              `Deactivate this rule? No further monthly period will be opened for ` +
                `${rule.template_name}, and future months will stop counting as owed. ` +
                `Periods already opened are unaffected.`,
            );

            if (confirmed) deactivate.mutate();
          }}
          disabled={deactivate.isPending}
        >
          {deactivate.isPending ? 'Deactivating…' : 'Deactivate'}
        </button>
      ) : null}

      {error ? <p className="notice">{error}</p> : null}
    </li>
  );
}

/**
 * Alta de una regla.
 *
 * El selector EXCLUYE las plantillas que ya tienen regla activa en este sitio. Es la
 * mitad cliente de la unicidad: el servidor responde `schedule_already_active` igual, y
 * no ofrecerlo evita que el coordinador provoque ese error haciendo lo único que la
 * pantalla le ofrece.
 */
function NewRuleForm({
  siteId,
  rules,
}: {
  siteId: string;
  rules: readonly InspectionSchedule[];
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const controlId = useId();
  const [templateId, setTemplateId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const templates = useQuery({ queryKey: ['templates'], queryFn: listTemplates, retry: false });

  const taken = new Set(
    rules.filter((rule) => rule.deactivated_at === null).map((rule) => rule.template_id),
  );
  const available = (templates.data ?? []).filter((template) => !taken.has(template.id));

  const create = useMutation({
    mutationFn: () => createSchedule({ site_id: siteId, template_id: templateId }),
    onSuccess: () => {
      setTemplateId('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['inspection-schedules'] });
    },
    onError: (caught: Error) => setError(caught.message),
  });

  if (templates.isSuccess && available.length === 0) {
    return <p className="note">Every published template already has an active rule here.</p>;
  }

  return (
    <div className="filters">
      <label htmlFor={`${controlId}-template`}>New rule</label>
      <select
        id={`${controlId}-template`}
        value={templateId}
        onChange={(event) => setTemplateId(event.target.value)}
      >
        <option value="">Choose a template…</option>
        {available.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name} (v{template.latest_version})
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => create.mutate()}
        disabled={templateId === '' || create.isPending}
      >
        {create.isPending ? 'Creating…' : 'Create rule'}
      </button>

      {error ? <p className="notice">{error}</p> : null}
    </div>
  );
}

/** Los períodos abiertos por esas reglas, con su estado y su dueño. */
function PeriodsSection({
  periods,
  siteId,
  canAdminister,
}: {
  periods: readonly ScheduledInspection[];
  siteId: string;
  canAdminister: boolean;
}): React.JSX.Element {
  return (
    <section>
      <h2>Scheduled inspections</h2>

      <ul className="list">
        {periods.map((inspection) => (
          <PeriodRow
            key={inspection.id}
            inspection={inspection}
            siteId={siteId}
            canAdminister={canAdminister}
          />
        ))}
      </ul>
    </section>
  );
}

function PeriodRow({
  inspection,
  siteId,
  canAdminister,
}: {
  inspection: ScheduledInspection;
  siteId: string;
  canAdminister: boolean;
}): React.JSX.Element {
  return (
    <li className={statusClass(inspection.status)}>
      <span className="period__month">{periodLabel(inspection.period_start)}</span>
      <span className="period__status">{STATUS_LABELS[inspection.status]}</span>
      <span>{inspection.template_name}</span>

      <span className={isUnassigned(inspection) ? 'badge badge--missing' : undefined}>
        {inspectorLabel(inspection)}
      </span>

      {inspection.cancellation_reason ? (
        <span className="period__note">Cancelled: {inspection.cancellation_reason}</span>
      ) : null}

      {canAdminister && inspection.cancelled_at === null ? (
        <PeriodControls inspection={inspection} siteId={siteId} />
      ) : null}
    </li>
  );
}

/**
 * Asignar y cancelar.
 *
 * SIN ACTUALIZACIÓN OPTIMISTA, a propósito. Si el servidor rechaza la asignación —la
 * cuenta perdió el alcance entre que se cargó la lista y se hizo click—, la fila tiene
 * que seguir mostrando al inspector anterior y el motivo tiene que verse. Pintar el
 * cambio y deshacerlo después es peor que esperar.
 */
function PeriodControls({
  inspection,
  siteId,
}: {
  inspection: ScheduledInspection;
  siteId: string;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const controlId = useId();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const candidates = useQuery({
    queryKey: ['inspector-candidates', siteId],
    queryFn: () => listInspectorCandidates(siteId),
    enabled: siteId !== '',
    retry: false,
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['scheduled-inspections'] });
    void queryClient.invalidateQueries({ queryKey: ['pending-inspections'] });
  };

  const assign = useMutation({
    mutationFn: (inspectorId: string) => assignInspector(inspection.id, inspectorId),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (caught: Error) => setError(caught.message),
  });

  const cancel = useMutation({
    mutationFn: () => cancelScheduledInspection(inspection.id, reason),
    onSuccess: () => {
      setReason('');
      setError(null);
      invalidate();
    },
    onError: (caught: Error) => setError(caught.message),
  });

  return (
    <>
      {/*
        `htmlFor`/`id` y no un `<label>` que envuelve al control: envolviéndolo, el texto
        accesible de la etiqueta pasa a incluir el de todas las opciones.
      */}
      <label htmlFor={`${controlId}-assign`}>Assign</label>
      <select
        id={`${controlId}-assign`}
        value=""
        disabled={assign.isPending}
        onChange={(event) => {
          if (event.target.value !== '') assign.mutate(event.target.value);
        }}
      >
        <option value="">Choose an inspector…</option>
        {(candidates.data ?? []).map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidateLabel(candidate)}
          </option>
        ))}
      </select>

      <label htmlFor={`${controlId}-reason`}>Cancel with a reason</label>
      <textarea
        id={`${controlId}-reason`}
        value={reason}
        maxLength={500}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Why this period will not be inspected"
      />

      <button
        type="button"
        onClick={() => cancel.mutate()}
        disabled={reason.trim() === '' || cancel.isPending}
      >
        {cancel.isPending ? 'Cancelling…' : 'Cancel this period'}
      </button>

      <span className="note">Cancelling cannot be undone. The period is scheduled again instead.</span>

      {error ? <p className="notice">{error}</p> : null}
    </>
  );
}
