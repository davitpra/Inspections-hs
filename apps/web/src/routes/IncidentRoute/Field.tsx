import { hadField } from '../../presentation/incidents';

/**
 * Un campo, o la constancia de que **no existía en la versión de este incidente**.
 *
 * Es la pregunta cerrada 10 llevada a la pantalla: sin esto, "vacío porque no aplicaba" y
 * "vacío porque el campo no existía" se ven idénticos, y en un registro inmutable esa
 * diferencia no se puede reconstruir después.
 */
export function Field({
  incident,
  name,
  label,
  children,
}: {
  incident: { fields_of_version: readonly string[] };
  name: string;
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {hadField(incident as never, name) ? (
          children
        ) : (
          <em>This field did not exist when the incident was written.</em>
        )}
      </dd>
    </>
  );
}
