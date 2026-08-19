import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { listCatalogLocations, listOrganizationLocations } from '../../api/catalog';
import { listSites } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { SitePicker } from '../../components/SitePicker';
import { InfoIcon, PinIcon } from '../../components/icons';
import { canAdministerCatalog } from '../../permissions/session';
import { MappingRow } from './MappingRow';
import { NewLocationForm } from './NewLocationForm';
import { mappingProgress, progressLabel, sortShared, unmappedLocations } from './presentation';

/**
 * §6 — El catálogo de ubicaciones: qué lugares nombran las plantillas y cuál es cada uno
 * en cada planta.
 *
 * ESTÁ ORDENADA POR UBICACIÓN COMPARTIDA, Y ESA ES LA DECISIÓN DE LA PANTALLA. La pregunta
 * que el coordinador tiene no es «¿qué es este lugar?» —eso ya lo sabe— sino «¿cada lugar
 * que mis plantillas nombran existe acá?». Su respuesta útil es una AUSENCIA: una
 * compartida sin fila física en esta planta hace que la sección de la plantilla no
 * resuelva y que el hallazgo nazca sin ubicación. Recorriendo las físicas, ese hueco no es
 * nada que se pueda dibujar, porque es una fila que no está.
 *
 * DOS POBLACIONES, Y CONVIENE NO CONFUNDIRLAS:
 *
 *   - **compartida** (`organization_location`) — el concepto, sin planta. Es lo que la
 *     sección de una plantilla guarda, y por eso una plantilla vale para las dos plantas.
 *   - **física** (`location`) — la fila de una planta, con `site_id` y con RLS. Es lo que
 *     un hallazgo referencia.
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
  const [chosenSite, setChosenSite] = useState<string | null>(null);

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

  const siteId = chosenSite ?? siteScope[0] ?? '';
  const siteName = (id: string): string => sites.data?.find((site) => site.id === id)?.name ?? id;

  const sharedLocations = sortShared(shared.data ?? []);
  const allLocations = locations.data ?? [];
  const progress = mappingProgress(sharedLocations, allLocations, siteId);
  const orphans = unmappedLocations(allLocations, siteId);

  return (
    <>
      {/*
        El selector de planta arriba, como en `/scheduling`, `/roster` y `/compliance`. La
        primera versión de esta pantalla era la única consola sin él: mezclaba las dos
        plantas en una sola pila y repetía «St. Thomas:» en cada etiqueta.
      */}
      <header className="scheduling__top">
        <div className="scheduling__header">
          <div className="scheduling__title">
            <span className="scheduling__icon">
              <PinIcon size={22} />
            </span>
            <h1>Locations</h1>
          </div>
          <p className="scheduling__subtitle">
            Templates name shared locations. Point each one at a real place in this plant, or
            an inspection here will not know where its findings are.
          </p>
        </div>

        <div className="site-card">
          <span className="site-card__icon">
            <PinIcon />
          </span>
          <SitePicker
            sites={sites.data ?? []}
            value={siteId}
            onChange={setChosenSite}
            siteName={siteName}
          />
        </div>
      </header>

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
        <section className="card">
          <div className="card__head">
            <h3>Shared locations in {siteName(siteId)}</h3>
            {/*
              El único número que importa. Sin él hay que contar 11 filas a ojo para saber
              si falta algo.
            */}
            <span
              className={
                progress.mapped === progress.total
                  ? 'status-pill status-pill--ready'
                  : 'status-pill status-pill--not-ready'
              }
            >
              {progressLabel(progress)}
            </span>
          </div>

          {sharedLocations.length === 0 ? (
            <p className="note">
              No shared locations yet. Add one below, then point a place in each plant at it.
            </p>
          ) : (
            <ul className="list list--mapping">
              {sharedLocations.map((each) => (
                <MappingRow
                  key={each.id}
                  shared={each}
                  locations={allLocations}
                  siteId={siteId}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/*
        El hueco simétrico. Una física sin compartida no rompe ninguna plantilla, pero es un
        lugar que ninguna plantilla puede nombrar, y sin esta lista no hay forma de saber
        que está ahí.
      */}
      {orphans.length > 0 ? (
        <section className="card">
          <div className="card__head">
            <h3>Not used by any shared location</h3>
          </div>
          <p className="note">
            These places exist in {siteName(siteId)} and no template can name them. A finding
            can still be recorded against one by hand.
          </p>
          <ul className="list">
            {orphans.map((location) => (
              <li key={location.id} className="list__row">
                <span>{location.name}</span>
                <span className="list__aside">{location.code}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <NewLocationForm scope="shared" siteId={siteId} siteName={siteName(siteId)} />
      <NewLocationForm scope="plant" siteId={siteId} siteName={siteName(siteId)} />
    </>
  );
}
