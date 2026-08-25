import { Link } from '@tanstack/react-router';

import { CheckIcon, InfoIcon, ListIcon } from '../../components/icons';

/**
 * La pantalla para las rutas que el shell de captura NO cubre.
 *
 * Spec: "A route the shell does not cover degrades to an offline screen" — se nombra
 * qué necesita conexión y **no se descarta ningún borrador**. Esa segunda mitad es la
 * que importa: el reflejo de "limpiar el estado local cuando algo no carga" es
 * exactamente lo que perdería el recorrido de tres horas que está guardado al lado.
 *
 * Por eso el estilo tampoco es el de un error. Se dibuja con las mismas tarjetas que el
 * resto de la consola —encabezado, `.card`, `.checklist`, `.notice-card`— y el único
 * acento de color es el verde de "tu trabajo está acá". Un cartel rojo en la planta
 * invita a cerrar la aplicación y volver a abrirla, que es la única maniobra capaz de
 * perder lo que esta pantalla promete conservar.
 */
export function OfflineRoute(): React.JSX.Element {
  return (
    <>
      <header className="scheduling__top">
        <div className="scheduling__header">
          <div className="scheduling__title">
            <span className="scheduling__icon">
              <InfoIcon size={22} />
            </span>
            <h1>This screen needs a connection</h1>
          </div>
          <p className="scheduling__subtitle">
            You can keep working. Everything on this device is still here.
          </p>
        </div>
      </header>

      {/*
        Lo que tranquiliza va PRIMERO y con el peso de un aviso, no al pie como una nota:
        quien llega acá llega asustado por su trabajo, no con curiosidad por la
        arquitectura del producto.
      */}
      <div className="notice-card">
        <div className="notice-card__body">
          <span className="notice-card__icon">
            <CheckIcon size={28} />
          </span>
          <div>
            <p className="notice-card__title">Nothing was lost</p>
            <p className="notice-card__text">
              Your drafts, photos and anything waiting to be sent are untouched and still on
              this device.
            </p>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>What is served by the server</h3>
        <ul className="checklist">
          <li>
             <ListIcon size={16} /> Recurring findings and operational records.
          </li>
          <li>
            <ListIcon size={16} /> Template administration.
          </li>
          <li>
            <ListIcon size={16} /> Account and roster settings.
          </li>
        </ul>
      </div>

      {/*
        Las dos salidas que SÍ funcionan sin red, a lo ancho y con el piso de 48px del
        botón base (ADR-010): esta pantalla se lee con guantes puestos.
      */}
      <div className="offline__actions">
        <Link to="/" className="choices__button button--outline">
          Back to inspections
        </Link>
        <Link to="/outbox" className="choices__button button--outline">
          Waiting to be sent
        </Link>
      </div>
    </>
  );
}
