import type { Site } from "@hs/contracts";
import { useId } from "react";

import { ScopePicker } from "./ScopePicker";

/**
 * Lo que la plantilla ES antes de tener una sola pregunta: cómo se llama y dónde se usa.
 *
 * Los dos campos van juntos y arriba de todo porque el segundo condiciona todo lo que
 * sigue: el alcance decide qué ubicaciones puede nombrar cada sección. Dejarlo abajo, o en
 * un panel aparte, haría que el autor escriba media plantilla antes de descubrir que la
 * ubicación que quería no estaba disponible.
 *
 * LA CLAVE VA ACÁ Y DE SOLO LECTURA. El autor no la elige —la deriva el servidor del nombre
 * al crear— y no la puede cambiar. Se muestra igual: renombrar NO la mueve, así que una
 * plantilla renombrada queda con una clave que ya no se le parece, y el día que alguien lea
 * un seed tiene que poder entender por qué.
 *
 * EN UNA REVISIÓN, EL NOMBRE TAMPOCO SE EDITA. `template.name` no lo puede actualizar nadie
 * —`hs_app` no tiene UPDATE sobre `template`—, así que un campo editable acá sería un campo
 * que se guarda, se muestra, y la publicación ignora. Se muestra como la clave, por la misma
 * razón: esconderlo dejaría al autor sin saber qué está corrigiendo.
 */
export function TemplateIdentity({
  name,
  templateKey,
  revising,
  sites,
  siteIds,
  onName,
  onScope,
}: {
  name: string;
  templateKey: string;
  /** El borrador corrige una plantilla publicada: su nombre y su clave ya están decididos. */
  revising: boolean;
  sites: readonly Site[];
  siteIds: readonly string[];
  onName: (name: string) => void;
  onScope: (siteIds: string[]) => void;
}): React.JSX.Element {
  const controlId = useId();

  return (
    <section className="card builder__identity">
      <div className="builder__identity-grid">
        <div className="builder__field">
          <label className="field-label" htmlFor={`${controlId}-name`}>
            Template name
          </label>
          <input
            id={`${controlId}-name`}
            type="text"
            value={name}
            placeholder="Daily equipment inspection"
            readOnly={revising}
            onChange={(event) => onName(event.target.value)}
          />
          <p className="note">
            {revising
              ? 'The name of a published template cannot be changed by revising it.'
              : "Give your template a clear name so it's easy to find."}{" "}
            Key <code>{templateKey}</code>
          </p>
        </div>

        <ScopePicker sites={sites} value={siteIds} onChange={onScope} />
      </div>
    </section>
  );
}
