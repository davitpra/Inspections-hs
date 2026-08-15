import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';

import { getForm7 } from '../../api/incidents';
import { queryKeys } from '../../api/query-keys';
import { valueOf } from './presentation';

/**
 * Los valores del incidente mapeados a los campos del Form 7 del WSIB.
 *
 * **Solo lectura, con copiar-al-portapapeles, y sin PDF** (riesgo H, cerrado en v1.2).
 * Generar el formulario oficial crearía una obligación de mantenimiento permanente sobre
 * un formato que no controlamos y el riesgo de producir un documento desactualizado con
 * apariencia de oficial. El coordinador entra al portal del WSIB de todas formas: lo que
 * esta pantalla le ahorra es transcribir de memoria.
 *
 * **Los campos que el sistema no almacena se muestran etiquetados como tales, no
 * vacíos.** Vacío se lee como "no hubo"; "no almacenado" dice la verdad —hay que
 * buscarlo en otro lado— y deja constancia de que la ausencia es una decisión de alcance
 * y no un olvido (riesgo G-bis).
 *
 * El mapeo sale del `form_version` de ESTE incidente, así que uno viejo se renderiza con
 * el conjunto de campos que tenía.
 */
export function Form7Route(): React.JSX.Element {
  const { id } = useParams({ from: '/incidents/$id/form7' });
  const [copied, setCopied] = useState<string | null>(null);

  const form7 = useQuery({
    queryKey: queryKeys.form7(id),
    queryFn: () => getForm7(id),
    retry: false,
  });

  if (form7.isError) return <p className="notice">This screen needs a connection.</p>;
  if (!form7.data) return <p>Loading…</p>;

  const { incident, mapping } = form7.data;

  const copy = async (label: string, text: string): Promise<void> => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
  };

  const everything = mapping
    .filter((field) => !field.notStored)
    .map((field) => `${field.label}: ${valueOf(incident, field)}`)
    .join('\n');

  return (
    <>
      <h1>WSIB Form 7 — fields</h1>

      <p className="notice">
        This is a read-only view of what the platform holds, laid out the way the Form 7 asks
        for it. Nothing is filed from here: you file the form in the WSIB portal. Form version{' '}
        {incident.form_version}.
      </p>

      <button type="button" onClick={() => void copy('all', everything)}>
        Copy everything the system holds
      </button>

      <dl>
        {mapping.map((field) => (
          <div key={field.label}>
            <dt>{field.label}</dt>
            <dd>
              {field.notStored ? (
                <>
                  <em>Not held by this system.</em>
                  {field.note ? <p>{field.note}</p> : null}
                </>
              ) : (
                <>
                  <span>{valueOf(incident, field)}</span>
                  <button
                    type="button"
                    onClick={() => void copy(field.label, valueOf(incident, field))}
                  >
                    Copy
                  </button>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>

      {copied ? <p>Copied {copied === 'all' ? 'all fields' : copied}.</p> : null}
    </>
  );
}
