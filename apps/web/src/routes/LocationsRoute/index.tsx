import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { OrganizationLocation } from '@hs/contracts';
import { listCatalogLocations, listOrganizationLocations } from '../../api/catalog';
import { listSites } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { InfoIcon, PinIcon, PlusIcon } from '../../components/icons';
import { canAdministerCatalog } from '../../permissions/session';
import { MappingTable } from './MappingTable';
import { MappingToolbar } from './MappingToolbar';
import { NewLocationForm } from './NewLocationForm';
import { NewSiteForm } from './NewSiteForm';
import { Orphans } from './Orphans';
import { RetireLocationDialog } from './RetireLocationDialog';
import { visibleLocations, type CoverageFilter, type SortDirection } from './presentation';

/**
 * §6 — El catálogo de ubicaciones: qué lugares nombran las plantillas y cuál de ellos existe
 * en cada planta.
 *
 * UNA FILA POR UBICACIÓN COMPARTIDA Y UNA COLUMNA POR PLANTA, Y ESA ES LA DECISIÓN DE LA
 * PANTALLA. La pregunta que el coordinador tiene no es «¿qué es este lugar?» —eso ya lo
 * sabe— sino «¿cada lugar que mis plantillas nombran existe en cada planta?». Su respuesta
 * útil es una AUSENCIA: una compartida sin fila física en una planta hace que la sección de
 * la plantilla no resuelva y que el hallazgo nazca sin ubicación. Recorriendo las físicas ese
 * hueco no es nada que se pueda dibujar, porque es una fila que no está; y con un selector de
 * planta —como en la primera versión— hay que cambiar de planta y volver a contar para verlo.
 *
 * POR ESO ACÁ NO HAY `SitePicker`, y es la única consola del coordinador que no lo tiene. Las
 * columnas salen del alcance de la cuenta: dos es lo que hay hoy, no una regla escrita.
 *
 * DOS POBLACIONES, Y CONVIENE NO CONFUNDIRLAS:
 *
 *   - **compartida** (`organization_location`) — el concepto, sin planta. Es lo que la
 *     sección de una plantilla guarda, y por eso una plantilla vale para las dos plantas.
 *   - **física** (`location`) — la fila de una planta, con `site_id` y con RLS. Es lo que
 *     un hallazgo referencia. El tick de cada celda la crea y la mapea; ver `PlantTick`.
 *
 * ONLINE y fuera del precacheo, como el resto de las consolas del coordinador.
 */
export function LocationsRoute(): React.JSX.Element {
  const { account } = useAppSession();

  if (!canAdministerCatalog(account)) {
    // Sin disparar ninguna consulta: pedir algo que el servidor va a negar solo llena el
    // log de 403. Mismo criterio que `RosterRoute` y `TemplatesRoute`.
    return (
      <>
        <h1>Locations</h1>
        <p className="notice">Only the H&amp;S coordinator can administer locations.</p>
      </>
    );
  }

  return <LocationCatalog siteScope={account.siteScope} />;
}

function LocationCatalog({ siteScope }: { siteScope: readonly string[] }): React.JSX.Element {
  const [filter, setFilter] = useState<CoverageFilter>('all');
  const [direction, setDirection] = useState<SortDirection>('asc');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [addingSite, setAddingSite] = useState(false);
  const [retiring, setRetiring] = useState<OrganizationLocation | null>(null);

  const sites = useQuery({ queryKey: queryKeys.sites(), queryFn: listSites, retry: false });
  const shared = useQuery({
    queryKey: queryKeys.organizationLocations(),
    queryFn: listOrganizationLocations,
    retry: false,
  });
  const locations = useQuery({
    queryKey: queryKeys.catalogLocations(),
    queryFn: listCatalogLocations,
    retry: false,
  });

  // Las columnas, en orden. `siteScope` manda: `listSites` puede devolver plantas que esta
  // cuenta no administra.
  const columns = (sites.data ?? [])
    .filter((site) => siteScope.includes(site.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const allShared = shared.data ?? [];
  const allLocations = locations.data ?? [];
  const siteIds = columns.map((site) => site.id);
  const rows = visibleLocations(allShared, allLocations, { filter, query, siteIds, direction });

  return (
    <>
      <header className="scheduling__top">
        <div className="scheduling__header">
          <div className="scheduling__title">
            <span className="scheduling__icon">
              <PinIcon size={22} />
            </span>
            <h1>Locations</h1>
          </div>
          <p className="scheduling__subtitle">
            Define each place you inspect once, then tick the plants where it exists.
          </p>
        </div>

        <button
          type="button"
          className="button--outline mapping__add-site"
          aria-expanded={addingSite}
          onClick={() => setAddingSite((open) => !open)}
        >
          <PlusIcon /> Add site
        </button>
        <button
          type="button"
          className="button--primary mapping__add"
          aria-expanded={adding}
          onClick={() => setAdding((open) => !open)}
        >
          <PlusIcon /> Add location
        </button>
      </header>

      {/*
        Lo que el tick no puede decir por sí solo: que una compartida marcada en las dos
        plantas es UN nombre con un lugar distinto en cada una, no un lugar compartido.
      */}
      <div className="notice-card">
        <div className="notice-card__body">
          <span className="notice-card__icon">
            <InfoIcon size={20} />
          </span>
          <p className="notice-card__text">
            A location ticked for every plant is one name with a separate physical place at each
            site, so a template written for both can pair them. A template section can only name
            a location where the plant it runs in has ticked it.
          </p>
        </div>
      </div>

      {addingSite ? <NewSiteForm /> : null}

      {adding ? (
        <>
          <NewLocationForm scope="shared" sites={columns} />
          <NewLocationForm scope="plant" sites={columns} />
        </>
      ) : null}

      {shared.isError || locations.isError ? (
        <p className="status-card status-card--error">
          <InfoIcon size={20} /> This view needs a connection.
        </p>
      ) : null}
      {shared.isLoading || locations.isLoading ? (
        <p className="status-card">
          <PinIcon size={20} /> Loading…
        </p>
      ) : null}

      {shared.isSuccess && locations.isSuccess ? (
        <section className="card mapping">
          <MappingToolbar
            sites={columns}
            filter={filter}
            onFilter={setFilter}
            query={query}
            onQuery={setQuery}
            showing={rows.length}
            total={allShared.length}
          />

          <MappingTable
            sites={columns}
            shared={allShared}
            rows={rows}
            locations={allLocations}
            direction={direction}
            onDirection={setDirection}
            onRetire={setRetiring}
          />
        </section>
      ) : null}

      {/*
        El hueco simétrico, ahora por planta. Una física sin compartida no rompe ninguna
        plantilla, pero es un lugar que ninguna plantilla puede nombrar, y sin esta lista no
        hay forma de saber que está ahí. Es además donde caen las que se destildan.
      */}
      {shared.isSuccess && locations.isSuccess ? (
        <Orphans sites={columns} locations={allLocations} />
      ) : null}

      {retiring ? <RetireLocationDialog location={retiring} onClose={() => setRetiring(null)} /> : null}
    </>
  );
}
