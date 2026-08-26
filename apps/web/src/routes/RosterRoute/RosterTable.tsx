import { useId, useState } from 'react';
import type { PersonWithAccount } from '@hs/contracts';

import { SearchIcon, UploadIcon } from '../../components/icons';
import {
  accessCellClass,
  accessCellLabel,
  dialogFor,
  emailCellLabel,
  matchesSearch,
  personInitials,
  personName,
  roleCellClass,
  roleCellLabel,
  rowActions,
  type RosterDialog,
} from './presentation';

/**
 * La tarjeta del roster: el buscador, el contador y las filas son una sola unidad —qué
 * estoy mirando y cuánto de todo es— y el borde es lo que lo dice.
 *
 * La búsqueda vive acá y no en la consola: no la mira nadie más. Los números de la tira sí
 * se cuentan afuera, sobre el roster entero (`rosterCounts`).
 */
export function RosterTable({
  people,
  siteName,
  ready,
  mayInvite,
  mayImport,
  importTriggerRef,
  onImport,
  onAct,
}: {
  people: readonly PersonWithAccount[];
  siteName: string;
  ready: boolean;
  mayInvite: boolean;
  mayImport: boolean;
  importTriggerRef: React.RefObject<HTMLButtonElement | null>;
  onImport: () => void;
  onAct: (dialog: RosterDialog) => void;
}): React.JSX.Element {
  const searchId = useId();
  const [search, setSearch] = useState('');
  const visible = people.filter((person) => matchesSearch(person, search));

  return (
    <section className="card roster">
      <div className="roster__toolbar">
        <label className="roster__search" htmlFor={searchId}>
          <SearchIcon />
          <span className="roster__sr">Search</span>
          <input
            id={searchId}
            type="search"
            value={search}
            placeholder="Search by name or employee number"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        {mayImport ? (
          <button
            ref={importTriggerRef}
            type="button"
            className="button--outline roster__import"
            onClick={onImport}
          >
            <UploadIcon /> Import roster
          </button>
        ) : null}

        {/* Solo con el roster cargado: "0 of 0 people" mientras carga es un dato falso. */}
        {ready ? (
          <span className="roster__count">
            {visible.length} of {people.length} people
          </span>
        ) : null}
      </div>

      <div className="roster__body">
        {/*
          "Esta planta no tiene a nadie" y "la búsqueda no encontró nada" son problemas
          distintos: el primero es un roster sin importar, el segundo es un tipeo.
        */}
        {ready && people.length === 0 ? (
          <p className="note">No one is on the roster of {siteName}.</p>
        ) : null}
        {ready && people.length > 0 && visible.length === 0 ? (
          <p className="note">No one matches “{search}”.</p>
        ) : null}

        {/*
          Una tabla y no una lista: el roster es la única pantalla donde se comparan filas
          entre sí —qué número tiene cada quien, qué rol— y comparar necesita columnas
          alineadas con su encabezado. El `<caption>` le dice a un lector de pantalla de qué
          planta es la tabla que va a recorrer.

          La fila va inline y no en su propio archivo: sin estado, sin hooks y sin mutación,
          no llega al umbral que `CLAUDE.md` pide para separarla.
        */}
        {visible.length > 0 ? (
          <div className="roster__scroll">
            <table className="table roster__table">
              <caption className="roster__sr">Roster of {siteName}</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Employee #</th>
                  <th scope="col">Role</th>
                  <th scope="col">Email</th>
                  <th scope="col">Access / Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((person) => (
                  <tr key={person.id}>
                    <th scope="row" aria-label={personName(person)}>
                      <span className="roster__person">
                        <span className="roster__avatar" aria-hidden="true">
                          {personInitials(person)}
                        </span>
                        <span>{personName(person)}</span>
                      </span>
                    </th>
                    <td className="roster__number">{person.employee_number}</td>
                    {/* La píldora ubica el rol en la escala del resto de la app sin
                        reemplazar la palabra — ver `roleCellLabel`, "Worker" incluido. */}
                    <td>
                      <span className={roleCellClass(person)}>{roleCellLabel(person)}</span>
                    </td>
                    {/* El guión y no el vacío: en una tabla donde la mayoría de las filas no
                        tiene cuenta, la columna en blanco se lee como una columna rota. */}
                    <td className="roster__email">{emailCellLabel(person) || '—'}</td>
                    <td>
                      <span className={accessCellClass(person)}>
                        <span className="roster__access-dot" aria-hidden="true" />
                        {accessCellLabel(person)}
                      </span>
                    </td>
                    {/* El acto tiene columna propia: el rol se compara hacia abajo, el botón
                        es un acto, y mezclados el ancho cambiaba fila por fila. Qué ofrece
                        cada una lo decide `rowActions`. */}
                    <td>
                      <div className="table__actions">
                        {rowActions(person, mayInvite).map((action) => (
                          <button
                            key={action.kind}
                            type="button"
                            className={action.className}
                            aria-label={action.label}
                            onClick={() => onAct(dialogFor(person, action))}
                          >
                            {action.text}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}
