import type { Session } from "@hs/contracts";
import { useEffect, useRef } from "react";

import { ActionTransitionForm } from "../../components/ActionTransitionForm";
import { enclosingReportItem } from "../../components/ReportItem";
import type { FindingNextStep as NextStep } from "./presentation";

/**
 * El único camino principal, y con dos formas de ejecutarlo. Crear una acción sigue siendo
 * un diálogo —asignar una persona, describir el trabajo y comprometer una fecha es un acto
 * aparte—; avanzar una que ya existe se hace SIN salir de la ficha y SIN nada que abrir:
 * `ActionTransitionForm` se dibuja acá mismo, debajo de la copia del paso.
 *
 * **A la vista y no plegado.** Un diálogo tapaba justo el contexto —la pregunta, lo
 * prescrito, lo observado— que justifica la decisión, y un disclosure costaba dos
 * pulsaciones para el único acto principal que la pantalla ofrece: una para revelar el
 * formulario y otra para enviarlo, con un botón que además repetía el nombre que ya está en
 * el encabezado del bloque. Los botones del formulario son los únicos controles del paso, y
 * por eso `awaiting_verification` puede ofrecer sus dos salidas sin competir con un tercero.
 */
export function FindingNextStep({
  step,
  session,
  onAttempt,
}: {
  step: NextStep;
  session: Session | null;
  onAttempt?: React.MouseEventHandler<HTMLButtonElement>;
}): React.JSX.Element {
  const sectionRef = useRef<HTMLElement>(null);
  const itemRef = useRef<HTMLElement | null>(null);

  // La ficha que contiene este bloque, capturada una vez al montar: sigue en el documento
  // aunque este componente se desmonte porque el paso desapareció (la acción se cerró y no
  // queda nada que ofrecer), y es a donde vuelve el foco.
  useEffect(() => {
    if (sectionRef.current) itemRef.current = enclosingReportItem(sectionRef.current);
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

  return (
    <section className="finding__next-step" aria-label="Next step" ref={sectionRef}>
      <div className="finding__next-step-head">
        <div className="finding__next-step-copy">
          <p className="finding__next-step-eyebrow">Next step</p>
          <h3>{step.label}</h3>
          <p>{step.requirement}</p>
          <p className="finding__next-step-owner">
            {step.control ? 'Responsible' : 'Waiting on'}: <strong>{step.waitingOn}</strong>
          </p>
        </div>
        {step.control?.kind === "create" && onAttempt ? (
          <button type="button" className="button--primary finding__next-step-button" onClick={onAttempt}>
            {step.label}
          </button>
        ) : null}
      </div>

      {step.control?.kind === "progress" ? (
        <div className="finding__next-step-form">
          <ActionTransitionForm
            action={step.control.action}
            session={session}
            onDone={returnFocus}
          />
        </div>
      ) : null}
    </section>
  );
}
