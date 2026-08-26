import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import {
  transitionsFrom,
  type ActionTransition,
  type EvidenceInput,
} from "@hs/contracts";

import { getAction, transitionAction, uploadEvidence } from "../../api/actions";
import { queryKeys } from "../../api/query-keys";
import { useAppSession } from "../../app/session-context";
import { StateBadge } from "../../components/StateBadge";
import { canAttempt } from "../../permissions/actions";
import { STATE_LABELS, transitionLabel } from "../../presentation/actions";
import { formatDay } from "../../presentation/dates";
import { EvidencePicker } from "./EvidencePicker";

/**
 * El detalle de una acción correctiva: su historia y lo que se puede hacer con ella.
 *
 * **Los botones salen de `TRANSITIONS`, no de un `if` escrito acá.** Es la misma tabla
 * que el servicio consulta y que la guarda de 0011 reproduce en SQL: si la UI la
 * reimplementara, el día que la máquina cambie habría dos verdades y una pantalla que
 * ofrece lo que el servidor rechaza.
 *
 * Lo que la UI **no** decide y por eso no comprueba: que quien verifica no sea quien
 * ejecutó. Esa regla necesita saber quién declaró el trabajo hecho, y el servidor ya lo
 * sabe; adelantarla acá sería copiar media regla y confiar en que las dos mitades no se
 * separen. El botón se ofrece y el error del servidor se muestra.
 */
export function ActionRoute(): React.JSX.Element {
  const { id } = useParams({ from: "/actions/$id" });
  const { account } = useAppSession();
  const queryClient = useQueryClient();

  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<
    { kind: EvidenceInput["kind"]; file: File }[]
  >([]);
  const [error, setError] = useState<string | null>(null);

  const action = useQuery({
    queryKey: queryKeys.action(id),
    queryFn: () => getAction(id),
    retry: false,
  });

  const move = useMutation({
    mutationFn: async (transition: ActionTransition) => {
      // Las fotos suben primero y por su propio camino (ADR-006): la transición viaja
      // con object keys, nunca con bytes.
      const evidence: EvidenceInput[] = [];

      for (const item of files) {
        evidence.push({
          kind: item.kind,
          object_key: await uploadEvidence(id, item.file),
        });
      }

      return transitionAction(id, {
        to: transition.to,
        note: note.trim() === "" ? undefined : note.trim(),
        reason: reason.trim() === "" ? undefined : reason.trim(),
        evidence,
      });
    },
    onSuccess: () => {
      setReason("");
      setNote("");
      setFiles([]);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.action(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.actions() });
    },
    onError: (caught: Error) => setError(caught.message),
  });

  if (action.isError)
    return <p className="notice">This action needs a connection.</p>;
  if (!action.data) return <p>Loading…</p>;

  const current = action.data;
  const available = transitionsFrom(current.state).filter((transition) =>
    canAttempt(transition, current, account),
  );

  return (
    <>
      <Link to="/actions" className="back-link">
        Back to corrective actions
      </Link>

      <header className="card action-detail__head">
        <div className="card__head">
          <h1>{current.description}</h1>
          <StateBadge state={current.state} />
        </div>
        <p className="action-detail__meta">
          Due {formatDay(current.due_at)} — severity {current.severity}
          {current.overdue && current.state !== "closed" ? (
            <span className="badge badge--overdue">Overdue</span>
          ) : null}
        </p>
      </header>

      {current.escalations.length > 0 ? (
        <p className="notice notice--warn">
          Escalated to{" "}
          {current.escalations
            .map(
              (escalation) =>
                `${escalation.level} (${escalation.days_overdue} days late)`,
            )
            .join(", ")}
        </p>
      ) : null}

      <section>
        <h2>History</h2>
        {/* El stream, en orden. Es el registro: no hay estado que mostrar aparte de esto. */}
        <ol className="list">
          {current.events.map((event) => (
            <li key={event.id} className="list__row">
              <span>
                {STATE_LABELS[event.to_state]} — {formatDay(event.occurred_at)}
              </span>
              {event.reason ? <p>Reason: {event.reason}</p> : null}
              {event.note ? <p>{event.note}</p> : null}
              {event.evidence.length > 0 ? (
                <p>
                  {event.evidence.filter((item) => item.kind === "before").length}{" "}
                  before,{" "}
                  {event.evidence.filter((item) => item.kind === "after").length}{" "}
                  after
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      {current.state === "closed" ? (
        // `closed` es terminal: no hay botón de reabrir, y su ausencia es la decisión
        // (design D14). Si el trabajo se deshizo, lo que hay es un hallazgo nuevo.
        <p className="notice">
          This action is closed. Work that comes undone is reported as a new
          finding.
        </p>
      ) : (
        <section className="card">
          <h2>What now</h2>

          {available.some((transition) =>
            transition.requires.includes("after_evidence"),
          ) ? (
            <EvidencePicker files={files} onChange={setFiles} />
          ) : null}

          {available.some((transition) =>
            transition.requires.includes("reason"),
          ) ? (
            <label className="action-detail__field">
              Reason
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          ) : null}

          <label className="action-detail__field">
            Note (optional)
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>

          {available.length > 0 ? (
            <div className="action-detail__actions">
              {available.map((transition, index) => (
                <button
                  key={transition.to}
                  type="button"
                  className={index === 0 ? "button--primary" : "button--outline"}
                  disabled={move.isPending}
                  onClick={() => move.mutate(transition)}
                >
                  {transitionLabel(current.state, transition.to)}
                </button>
              ))}
            </div>
          ) : (
            <p className="notice">
              Nothing for you to do here: someone else has to move this one
              along.
            </p>
          )}
        </section>
      )}
      {error ? <p className="notice notice--warn">{error}</p> : null}
    </>
  );
}
