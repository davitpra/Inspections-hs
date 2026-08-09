import { Link } from '@tanstack/react-router';

/**
 * La pantalla para las rutas que el shell de captura NO cubre.
 *
 * Spec: "A route the shell does not cover degrades to an offline screen" — se nombra
 * qué necesita conexión y **no se descarta ningún borrador**. Esa segunda mitad es la
 * que importa: el reflejo de "limpiar el estado local cuando algo no carga" es
 * exactamente lo que perdería el recorrido de tres horas que está guardado al lado.
 */
export function OfflineRoute(): React.JSX.Element {
  return (
    <>
      <h1>This screen needs a connection</h1>

      <p>
        Reports, template administration and account settings are served by the server and are
        not available offline.
      </p>

      <p>
        Your drafts, photos and anything waiting to be sent are untouched and still on this
        device.
      </p>

      <p>
        <Link to="/">Back to inspections</Link> · <Link to="/outbox">Waiting to be sent</Link>
      </p>
    </>
  );
}
