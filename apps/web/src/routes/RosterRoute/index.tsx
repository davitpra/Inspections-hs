import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { listSites } from '../../api/inspections';
import { listPeople, type RosterStatus } from '../../api/roster';
import { useAppSession } from '../../app/session-context';
import { SitePicker } from '../../components/SitePicker';
import { matchesSearch, personLabel, sortRoster, statusClass, statusLabel } from './presentation';

/**
 * §6 — La consola del roster: quién trabaja en esta planta.
 *
 * POR QUÉ ESTA PANTALLA EXISTE. El roster es la única entidad de primera clase del sistema
 * que no se podía mirar. Existía en la base desde la etapa 2 —200+ personas—, entraba por
 * `pnpm roster:import`, y la única lectura expuesta era el paquete de campo: cuatro
 * columnas colgadas de una inspección. Para saber si alguien estaba cargado, en qué planta,
 * o si seguía activo, había que abrir `psql`.
 *
 * **SOLO LECTURA, Y ES TODO EL ALCANCE.** No se corrige un nombre, no se transfiere de
 * planta y no se da de baja: el roster lo mantiene la importación del CSV de ADP, que es su
 * fuente de verdad. Esta pantalla lo muestra.
 *
 * **ESTO NO ES EL SELECTOR DE SUJETO, Y LA DISTINCIÓN ES LA QUE SOSTIENE LA PANTALLA.** §4
 * dice que el supervisor elige a una persona *sin poder ver su perfil*, y eso ata al
 * selector —cuatro columnas, `GET /scheduled-inspections/:id/roster`—, no a la
 * administración que §6 le pide al coordinador. Por eso acá el rol se comprueba en la
 * lectura, al revés que la consola de programación, que deja mirar a cualquiera: esta ruta
 * SÍ devuelve el perfil. Si alguien conecta el `PersonPicker` de los incidentes a
 * `GET /people`, rompe lo único que las mantiene separadas.
 *
 * ONLINE y fuera del precacheo: un roster servido desde caché es un roster viejo que no
 * dice que lo es (ADR-001).
 */
export function RosterRoute(): React.JSX.Element {
  const { account } = useAppSession();

  if (account?.role !== 'hs_coordinator') {
    // Y sin disparar ninguna consulta: pedir algo que el servidor va a negar solo sirve
    // para llenar el log de 403.
    return (
      <>
        <h1>Roster</h1>
        <p className="notice">Only the H&amp;S coordinator can administer the roster.</p>
      </>
    );
  }

  return <RosterConsole siteScope={account.siteScope} />;
}

function RosterConsole({ siteScope }: { siteScope: readonly string[] }): React.JSX.Element {
  const searchId = useId();
  const statusId = useId();

  const [chosenSite, setChosenSite] = useState<string | null>(null);
  const [status, setStatus] = useState<RosterStatus>('active');
  const [search, setSearch] = useState('');

  const sites = useQuery({ queryKey: ['sites'], queryFn: listSites, retry: false });

  const siteId = chosenSite ?? siteScope[0] ?? '';

  const roster = useQuery({
    queryKey: ['roster', siteId, status],
    queryFn: () => listPeople(siteId, status),
    enabled: siteId !== '',
    retry: false,
  });

  const siteName = (id: string): string =>
    sites.data?.find((site) => site.id === id)?.name ?? id;

  const all = sortRoster(roster.data ?? []);
  const visible = all.filter((person) => matchesSearch(person, search));

  return (
    <>
      <h1>Roster</h1>

      {/*
        Dónde se corrige lo que esta pantalla muestra. Sin esta línea, el coordinador ve un
        apellido mal escrito y no tiene forma de saber por dónde se arregla.
      */}
      <p className="note">
        The roster is maintained by CSV import. Names, sites and active status all come from
        the file.
      </p>

      <SitePicker
        sites={sites.data ?? []}
        value={siteId}
        onChange={setChosenSite}
        siteName={siteName}
      />

      <div className="filters">
        <label htmlFor={statusId}>Status</label>
        <select
          id={statusId}
          value={status}
          onChange={(event) => setStatus(event.target.value as RosterStatus)}
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>

        <label htmlFor={searchId}>Search</label>
        <input
          id={searchId}
          type="search"
          value={search}
          placeholder="Name or employee number"
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {roster.isError ? <p className="notice">This view needs a connection.</p> : null}
      {roster.isLoading ? <p>Loading…</p> : null}

      {/*
        "Esta planta no tiene a nadie" y "la búsqueda no encontró nada" son problemas
        distintos: el primero es un roster sin importar, el segundo es un tipeo.
      */}
      {roster.isSuccess && all.length === 0 ? (
        <p>No one is on the roster of {siteName(siteId)} with this status.</p>
      ) : null}
      {roster.isSuccess && all.length > 0 && visible.length === 0 ? (
        <p>No one matches “{search}”.</p>
      ) : null}

      {/*
        La fila va inline y no en su propio archivo: sin estado, sin hooks y sin mutación,
        no llega al umbral que `CLAUDE.md` pide para separarla.
      */}
      <ul className="list">
        {visible.map((person) => (
          <li key={person.id} className="list__row">
            <span>{personLabel(person)}</span>
            <span className={statusClass(person)}>{statusLabel(person)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
