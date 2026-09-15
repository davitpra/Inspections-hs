import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { createOrganizationLocation } from '../../api/catalog';
import { queryKeys } from '../../api/query-keys';
import { CloseIcon } from '../../components/icons';
import { canCreate, suggestCode } from './presentation';

/**
 * Dar de alta un lugar. Uno solo, y sin planta.
 *
 * HUBO UN SEGUNDO FORMULARIO —el alta de una física en una planta elegida— Y SE FUE. Crear
 * el lugar y declarar en qué plantas existe son dos actos, y el segundo ya tiene su gesto:
 * el tick de la tabla, que crea la física con el código de la compartida y la mapea. Con
 * los dos formularios abiertos, el alta «de planta» nacía sin mapear, así que la ubicación
 * recién creada no aparecía como fila sino en la lista de huérfanas de abajo, disponible en
 * una sola planta. Nadie pedía eso; era el precio de exponer la población física en un
 * alta.
 *
 * Queda entonces la regla de la pantalla, sin excepción: se define el lugar una vez y las
 * plantas donde existe se tildan. La vía manual sigue existiendo en la API
 * (`POST /sites/:siteId/locations`), que es la que usa el tick.
 *
 * **EL CÓDIGO SE DERIVA DEL NOMBRE Y NO SE PIDE.** Sigue existiendo y sigue importando —es
 * lo que guarda la sección de una plantilla (`organization_location_code` en
 * `forms/document/schema.ts`), lo que `PlantTick` usa para crear la física y lo que
 * `reusableLocation` usa para recuperar una huérfana— pero eso es una consecuencia del alta,
 * no una decisión que el coordinador tenga que tomar para dar de alta un lugar.
 *
 * No por eso se genera a escondidas, que sería lo de la `key` de una plantilla: el campo
 * aparece en cuanto la derivación deja de alcanzar —un código ya usado, o un nombre que no
 * produce ninguno— y desde ahí el autor manda (`codeTouched`). Es la única forma de que un
 * choque de códigos siga teniendo corrección; el código es legible justamente porque se
 * escribe en seeds y se lee en reportes (cabecera de `contracts/catalog.ts`).
 */
export function NewLocationForm({ onClose }: { onClose: () => void }): React.JSX.Element {
  const queryClient = useQueryClient();
  const controlId = useId();

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El código sale del nombre y no se muestra: lo que el coordinador nombra es un lugar, no
  // un identificador. El campo aparece SOLO cuando la derivación no alcanza —el servidor
  // rechazó ese código, o el nombre no produce ninguno—, que es cuando pasa a haber algo que
  // decidir. Sin esa salida, un código repetido sería un error sin corrección posible.
  const derived = suggestCode(name);
  const showCode = codeTouched || error !== null || (name.trim().length > 0 && derived === '');

  const create = useMutation({
    mutationFn: () => createOrganizationLocation({ code, name: name.trim() }),
    onSuccess: () => {
      // El alta terminó y el panel se cierra: la fila nueva es lo que queda a la vista.
      onClose();

      // Una fila nueva en la tabla, con todas sus celdas vacías. Ninguna física se crea acá,
      // así que el listado de `location` no cambió.
      void queryClient.invalidateQueries({ queryKey: queryKeys.organizationLocations() });
    },
    onError: (caught: Error) => setError(caught.message),
  });

  const onNameChange = (value: string): void => {
    setName(value);
    if (!codeTouched) setCode(suggestCode(value));
  };

  return (
    <div className="card">
      <div className="card__head">
        <h3>Add a location</h3>
        <button
          type="button"
          className="card__close"
          aria-label="Close add a location"
          onClick={onClose}
        >
          <CloseIcon size={20} />
        </button>
      </div>

      <p className="note">
        A place is defined once for the whole organization. It is added to the table below with
        no plant ticked; tick the plants where it exists and each of them gets its own physical
        place for it.
      </p>

      <div className="filters">
        <label htmlFor={`${controlId}-name`}>Name</label>
        <input
          id={`${controlId}-name`}
          type="text"
          value={name}
          placeholder="Loading dock"
          onChange={(event) => onNameChange(event.target.value)}
        />
      </div>

      {showCode ? (
        <>
          <div className="filters">
            <label htmlFor={`${controlId}-code`}>Code</label>
            <input
              id={`${controlId}-code`}
              type="text"
              value={code}
              placeholder="loading-dock"
              onChange={(event) => {
                setCodeTouched(true);
                setCode(event.target.value);
              }}
            />
          </div>

          <p className="note">
            This code is what a template section stores, so it stays fixed while the name can be
            corrected. Lowercase letters, digits, and “.” or “-” between segments.
          </p>
        </>
      ) : null}

      <div className="filters">
        <button
          type="button"
          className="button--primary"
          onClick={() => create.mutate()}
          disabled={!canCreate(name, code) || create.isPending}
        >
          {create.isPending ? 'Adding…' : 'Add'}
        </button>
      </div>

      {error ? <p className="notice">{error}</p> : null}
    </div>
  );
}
