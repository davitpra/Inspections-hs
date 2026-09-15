import { useState } from 'react';
import { INCIDENT_WITNESS_MAX, type PersonOption } from '@hs/contracts';

import { PersonSearch } from './PersonPicker';
import { personLabel } from './presentation';

/** Testigos del mismo roster, sin duplicados y con el límite del contrato. */
export function WitnessPicker({
  options,
  value,
  onChange,
}: {
  options: readonly PersonOption[];
  value: string[];
  onChange: (value: string[]) => void;
}): React.JSX.Element {
  const [knownPeople, setKnownPeople] = useState<Record<string, PersonOption>>({});

  return (
    <div className="witness-picker">
      {value.length > 0 ? (
        <ul>
          {value.map((personId) => {
            const person = options.find((option) => option.id === personId) ?? knownPeople[personId];

            return person ? (
              <li key={person.id}>
                <span>{personLabel(person)}</span>
                <button
                  type="button"
                  aria-label="Remove"
                  className="button--outline"
                  onClick={() => onChange(value.filter((id) => id !== person.id))}
                >
                  Remove
                </button>
              </li>
            ) : null;
          })}
        </ul>
      ) : null}
      {value.length < INCIDENT_WITNESS_MAX ? (
        <PersonSearch
          options={options}
          ariaLabel="Search witnesses"
          onSelect={(person) => {
            if (!value.includes(person.id) && value.length < INCIDENT_WITNESS_MAX) {
              setKnownPeople((current) => ({ ...current, [person.id]: person }));
              onChange([...value, person.id]);
            }
          }}
        />
      ) : null}
    </div>
  );
}
