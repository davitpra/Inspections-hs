import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { PERIOD_MONTHS_LABELS, type InspectionSchedule } from "@hs/contracts";

import { listInspectorCandidates, updateSchedule } from "../../api/inspections";
import { queryKeys } from "../../api/query-keys";
import { CalendarIcon, PersonIcon } from "../../components/icons";
import { candidateLabel, frequencyNote } from '../../presentation/scheduling';

export function RuleRow({
  rule,
  siteId,
  canAdminister,
}: {
  rule: InspectionSchedule;
  siteId: string;
  canAdminister: boolean;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const controlId = useId();
  const [error, setError] = useState<string | null>(null);

  const candidates = useQuery({
    queryKey: queryKeys.inspectorCandidates(siteId),
    queryFn: () => listInspectorCandidates(siteId),
    enabled: canAdminister && siteId !== "",
    retry: false,
  });

  const toggle = useMutation({
    mutationFn: (nextDeactivated: boolean) =>
      updateSchedule(rule.id, { deactivated: nextDeactivated }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.inspectionSchedules(),
      });
    },
    onError: (caught: Error) => setError(caught.message),
  });

  const setDefaultInspector = useMutation({
    mutationFn: (inspectorId: string) =>
      updateSchedule(rule.id, { default_inspector_id: inspectorId === "" ? null : inspectorId }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.inspectionSchedules(),
      });
    },
    onError: (caught: Error) => setError(caught.message),
  });

  const active = rule.deactivated_at === null;

  // El inspector por defecto actual puede haber perdido el alcance de la planta y ya no
  // aparecer entre los candidatos; si no se agrega acá, el `<select>` cae en "None" y
  // esconde que la regla todavía apunta a esa persona.
  const currentNotOffered =
    rule.default_inspector_id !== null &&
    !(candidates.data ?? []).some((candidate) => candidate.id === rule.default_inspector_id);

  return (
    <li className="rule-card">
      <span className="rule-card__icon">
        <CalendarIcon />
      </span>

      <span className="rule-card__name">
        {rule.template_name}
        {active ? null : <span className="badge badge--closed"> Deactivated</span>}
      </span>

      {/*
        La frecuencia se MUESTRA y no se edita, y el texto tiene que decir por qué: el
        motor rechaza el UPDATE con HS001, así que sin esta línea el coordinador buscaría
        un control que no existe y concluiría que falta implementarlo.
      */}
      <span className="rule-card__field">
        <span className="field-label">Frequency</span>
        <span>
          {PERIOD_MONTHS_LABELS[rule.frequency_months]}
          <span className="note"> — {frequencyNote(rule)}</span>
        </span>
      </span>

      {canAdminister ? (
        <span className="rule-card__field">
          <label htmlFor={`${controlId}-default-inspector`} className="field-label">
            Default inspector
          </label>
          <div className="field-select">
            <span className="field-select__icon">
              <PersonIcon />
            </span>
            <select
              id={`${controlId}-default-inspector`}
              value={rule.default_inspector_id ?? ""}
              disabled={setDefaultInspector.isPending}
              onChange={(event) => setDefaultInspector.mutate(event.target.value)}
            >
              <option value="">None</option>
              {currentNotOffered ? (
                <option value={rule.default_inspector_id ?? ""}>
                  {rule.default_inspector_name ?? "Assigned (name not visible from this site)"}
                </option>
              ) : null}
              {(candidates.data ?? []).map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidateLabel(candidate)}
                </option>
              ))}
            </select>
          </div>
        </span>
      ) : (
        <span className="note">
          Default inspector: {rule.default_inspector_name ?? "none"}
        </span>
      )}

      {canAdminister ? (
        <button
          type="button"
          className="button--danger"
          onClick={() => {
            if (!active) {
              toggle.mutate(false);
              return;
            }

            // La confirmación dice QUÉ DEJA DE PASAR. «¿Estás seguro?» no informa nada:
            // desactivar corta la apertura de períodos futuros y hace que el reporte de
            // cobertura deje de contarlos como debidos.
            const confirmed = window.confirm(
              `Deactivate this rule? No further period will be opened for ` +
                `${rule.template_name}, and future periods will stop counting as owed. ` +
                `Periods already opened are unaffected.`,
            );

            if (confirmed) toggle.mutate(true);
          }}
          disabled={toggle.isPending}
        >
          {active
            ? toggle.isPending
              ? "Deactivating…"
              : "Deactivate"
            : toggle.isPending
              ? "Reactivating…"
              : "Reactivate"}
        </button>
      ) : null}

      {error ? <p className="notice">{error}</p> : null}
    </li>
  );
}
