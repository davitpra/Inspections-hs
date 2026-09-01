import type { Session } from "@hs/contracts";
import { useEffect, useRef, useState } from "react";

import { ActionTransitionForm } from "../../components/ActionTransitionForm";
import { enclosingReportItem } from "../../components/ReportItem";
import { EditAssignmentForm } from "./EditAssignmentForm";
import type { FindingNextStep as NextStep } from "./presentation";

/**
 * El único camino principal, y una sola forma de ejecutarlo: sus campos, debajo de la copia
 * que lo nombra. Crear el compromiso y avanzar una acción que ya existe se resuelven los dos
 * SIN salir de la ficha y SIN nada que abrir —el formulario de creación llega hecho desde el
 * ciclo, en `create`; el de una transición lo arma `ActionTransitionForm`—.
 *
 * **A la vista y no plegado.** Un diálogo tapaba justo el contexto —la pregunta, lo
 * prescrito, lo observado— que justifica la decisión, y un disclosure acá adentro costaba dos
 * pulsaciones para el único acto principal que la pantalla ofrece: una para revelar el
 * formulario y otra para enviarlo, con un botón que además repetía el nombre que ya está en
 * el encabezado del bloque. Los botones del formulario son los únicos controles del paso, y
 * por eso `awaiting_verification` puede ofrecer sus dos salidas sin competir con un tercero.
 *
 * **El ciclo que contiene a este bloque SÍ puede llegar plegado, y no es el mismo caso.** Se
 * pliega solo sobre un hallazgo que todavía no decidió nada, donde nada de esto está en
 * pantalla: el control que lo abre no repite ningún encabezado visible, lo estrena. Abierto,
 * este bloque vuelve a ser lo que dice el párrafo de arriba —los campos a la vista y un solo
 * envío—, y la cuenta de pulsaciones para el acto es la misma. El plegado vive en
 * `FindingLifecycle`; acá no hay nada que revelar.
 *
 * **Corregir la asignación sí está plegado, y esa asimetría es la regla.** El acto principal
 * de la etapa Assigned es empezar el trabajo; enmendar el compromiso es la excepción
 * (ADR-018), y a la vista competiría con él tres campos contra un botón. Mientras está
 * abierto hay algo escrito, y el ciclo se avisa —`onDraftChange`— para que elegir otra etapa
 * no se lleve el borrador puesto.
 *
 * Vive dentro del panel de la etapa vigente del ciclo, debajo del registro de esa misma
 * etapa: primero lo que ya se decidió, después lo que sigue.
 */
export function FindingNextStep({
  step,
  session,
  findingId,
  create,
  onDraftChange,
}: {
  step: NextStep;
  session: Session | null;
  findingId: string;
  /** El formulario que escribe el compromiso, cuando crear ES el paso; lo arma el ciclo. */
  create?: React.ReactNode;
  onDraftChange?: (drafting: boolean) => void;
}): React.JSX.Element {
  const sectionRef = useRef<HTMLElement>(null);
  const itemRef = useRef<HTMLElement | null>(null);
  const [amending, setAmending] = useState(false);

  // La ficha que contiene este bloque, capturada una vez al montar: sigue en el documento
  // aunque este componente se desmonte porque el paso desapareció (la acción se cerró y no
  // queda nada que ofrecer), y es a donde vuelve el foco.
  useEffect(() => {
    if (sectionRef.current)
      itemRef.current = enclosingReportItem(sectionRef.current);
  }, []);

  /*
    EL FOCO VUELVE A LA FICHA al terminar la transición, porque el botón que lo tenía no
    sobrevive: la transición ofrecida es otra —y su botón se dibuja con otra `key`— o el paso
    entero desaparece porque la acción se cerró. Sin esto el foco caería al `body`.

    Diferido: la lista de acciones invalidada por la propia mutación puede desmontar el botón
    antes de que el navegador pinte, y la ficha sigue ahí en ese momento.
  */
  const returnFocus = (): void => {
    window.setTimeout(() => itemRef.current?.focus(), 0);
  };

  const amend = (open: boolean): void => {
    setAmending(open);
    onDraftChange?.(open);
  };

  return (
    <section
      className="finding__next-step"
      aria-label="Next step"
      ref={sectionRef}
    >
      <div className="finding__next-step-copy">
        <p className="finding__next-step-eyebrow">Next step</p>
        <h3>{step.label}</h3>
        <p>{step.requirement}</p>
        <p className="finding__next-step-owner">
          {step.control ? "Responsible" : "Waiting on"}:{" "}
          <strong>{step.waitingOn}</strong>
        </p>
      </div>

      {/* El mismo hueco para las dos formas del paso: la que crea y la que avanza. */}
      {create ? <div className="finding__next-step-form">{create}</div> : null}

      {step.control?.kind === "progress" ? (
        <div className="finding__next-step-form">
          <ActionTransitionForm
            action={step.control.action}
            session={session}
            onDone={returnFocus}
          />
        </div>
      ) : null}

      {step.amend ? (
        <div className="finding__amend">
          <button
            type="button"
            className="button--outline finding__amend-toggle"
            aria-expanded={amending}
            onClick={() => amend(!amending)}
          >
            {amending ? "Cancel" : "Edit assignment"}
          </button>
          {amending ? (
            <EditAssignmentForm
              action={step.amend}
              findingId={findingId}
              onAmended={() => amend(false)}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
