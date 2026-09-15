import { useState } from 'react';
import type { PersonOption } from '@hs/contracts';

import { matchPeople, personLabel } from './presentation';

const SEARCH_RESULT_LIMIT = 20;

/**
 * Búsqueda de personas para el reporte, limitada a `PersonOption` y sin perfiles.
 *
 * **No se conecta a `GET /people`**: esa ruta alimenta la consola del roster y devuelve el
 * perfil completo. §4 exige elegir la persona sin verla; este selector usa la ruta reducida
 * del incidente y solo muestra número de empleado y nombre.
 *
 * Vive en la carpeta de esta ruta y no en `src/components/`: compartirlo expondría esta
 * superficie a una pantalla que no debería mostrar perfiles. `WitnessPicker` lo reutiliza
 * porque busca exactamente las mismas opciones, no porque sean controles de dominio general.
 */
export function PersonSearch({
  options,
  onSelect,
  ariaLabel,
}: {
  options: readonly PersonOption[];
  onSelect: (person: PersonOption) => void;
  ariaLabel: string;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const matches = matchPeople(options, query, SEARCH_RESULT_LIMIT + 1);
  const visibleMatches = matches.slice(0, SEARCH_RESULT_LIMIT);

  return (
    <div className="person-picker">
      <input
        type="search"
        aria-label={ariaLabel}
        placeholder="Employee number or name"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {matches.length > SEARCH_RESULT_LIMIT ? (
        <p className="note">Keep typing to narrow</p>
      ) : null}
      {query.trim() !== '' && visibleMatches.length === 0 ? (
        <p className="note">No people found.</p>
      ) : null}
      {visibleMatches.length > 0 ? (
        <div className="person-picker__results">
          {visibleMatches.map((person) => (
            <button
              type="button"
              aria-label={personLabel(person)}
              className="button--outline"
              key={person.id}
              onClick={() => {
                onSelect(person);
                setQuery('');
              }}
            >
              {personLabel(person)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** El selector de persona afectada. Las props contienen opciones, no identificadores escritos. */
export function PersonPicker({
  options,
  value,
  onChange,
}: {
  options: readonly PersonOption[];
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const selected = options.find((person) => person.id === value);

  if (selected) {
    return (
      <div className="person-picker__selected">
        <span>{personLabel(selected)}</span>
        <button
          type="button"
          aria-label="Change"
          className="button--outline"
          onClick={() => onChange('')}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <PersonSearch
      options={options}
      ariaLabel="Search affected person"
      onSelect={(person) => onChange(person.id)}
    />
  );
}
