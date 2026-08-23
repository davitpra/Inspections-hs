import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { listSites } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { listPeople } from '../../api/roster';
import { useAppSession } from '../../app/session-context';
import { SitePicker } from '../../components/SitePicker';
import { canAdministerRoster, canInviteFromRoster } from '../../permissions/session';
import { resolveSiteId } from '../../presentation/sites';
import { InviteDialog } from './InviteDialog';
import { ReissueDialog } from './ReissueDialog';
import { RemoveAccessDialog } from './RemoveAccessDialog';
import {
  canInvite,
  canReissueInvitation,
  canRemoveJhscAccess,
  inviteButtonLabel,
  emailCellLabel,
  matchesSearch,
  personLabel,
  personName,
  reissueButtonLabel,
  removeButtonLabel,
  removeButtonText,
  roleCellLabel,
  sortRoster,
} from './presentation';

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

  if (!canAdministerRoster(account)) {
    // Y sin disparar ninguna consulta: pedir algo que el servidor va a negar solo sirve
    // para llenar el log de 403.
    return (
      <>
        <h1>Roster</h1>
        <p className="notice">Only the H&amp;S coordinator can administer the roster.</p>
      </>
    );
  }

  return <RosterConsole siteScope={account.siteScope} canInviteFromRoster={canInviteFromRoster(account)} />;
}

function RosterConsole({
  siteScope,
  canInviteFromRoster: mayInvite,
}: {
  siteScope: readonly string[];
  canInviteFromRoster: boolean;
}): React.JSX.Element {
  const searchId = useId();

  const [chosenSite, setChosenSite] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  /**
   * La persona que está siendo invitada, ACÁ y no en la fila que lo originó: invitar
   * invalida el roster, el refetch devuelve a esa persona con cuenta y su celda deja de
   * renderizar el botón. El modal —y el token que llega a guardar— sobrevive porque la
   * consola lo monta fuera de la tabla. Ver `InviteDialog.tsx`.
   */
  const [inviting, setInviting] = useState<{ id: string; label: string } | null>(null);

  /**
   * La cuenta a la que se le está reemitiendo el link (`reissue-invitation-link-from-roster`
   * design D4): mismo criterio que `inviting`, y por la misma razón — reemitir invalida
   * el roster y el modal tiene que sobrevivir al refetch de la fila que lo abrió.
   */
  const [reissuing, setReissuing] = useState<{ userId: string; label: string } | null>(null);

  /**
   * La cuenta a la que se le está quitando el acceso (`remove-jhsc-access-from-roster`):
   * mismo criterio que las dos de arriba. Quitar deja la fila sin ese botón, así que el
   * modal tiene que sobrevivir al refetch de la fila que lo originó.
   *
   * `canSignIn` viaja con el estado y no se vuelve a leer de la fila: es lo que decide qué
   * pregunta hace el diálogo, y si se leyera del roster ya invalidado la confirmación
   * podría cambiar de texto debajo del cursor.
   */
  const [removing, setRemoving] = useState<{
    userId: string;
    label: string;
    canSignIn: boolean;
  } | null>(null);

  const sites = useQuery({ queryKey: queryKeys.sites(), queryFn: listSites, retry: false });

  // La baja no saca la planta de `user_site_scope`, así que `siteScope[0]` puede ser una
  // planta cerrada; `resolveSiteId` abre en una activa, igual que la consola de programación.
  const siteId = resolveSiteId(sites.data ?? [], siteScope, chosenSite);
  const noActiveSite = sites.isSuccess && siteId === '';

  const roster = useQuery({
    queryKey: queryKeys.roster(siteId),
    queryFn: () => listPeople(siteId),
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

      {/*
        Sin ninguna planta activa no hay roster que pedir —la consulta ya está apagada por
        `enabled`—, y el selector degradado diría «Site:» y nada más.
      */}
      {noActiveSite ? (
        <p className="notice">No active sites.</p>
      ) : (
        <SitePicker
          sites={sites.data ?? []}
          value={siteId}
          onChange={setChosenSite}
          siteName={siteName}
        />
      )}

      <div className="filters">
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
        <p>No one is on the roster of {siteName(siteId)}.</p>
      ) : null}
      {roster.isSuccess && all.length > 0 && visible.length === 0 ? (
        <p>No one matches “{search}”.</p>
      ) : null}

      {/*
        Una tabla y no una lista: el roster es la única pantalla donde se comparan filas
        entre sí —qué número tiene cada quien, qué rol— y comparar necesita columnas
        alineadas con su encabezado. El `<caption>` no es adorno: es lo que le dice a un
        lector de pantalla de qué planta es la tabla que va a recorrer.

        La fila va inline y no en su propio archivo: sin estado, sin hooks y sin mutación,
        no llega al umbral que `CLAUDE.md` pide para separarla.
      */}
      {visible.length > 0 ? (
        <table className="table">
          <caption className="table__caption">Roster of {siteName(siteId)}</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Employee #</th>
              <th scope="col">Role</th>
              <th scope="col">Email</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((person) => (
              <tr key={person.id}>
                <th scope="row">{personName(person)}</th>
                <td>{person.employee_number}</td>
                {/*
                  "Worker" cuando no hay cuenta: la ausencia de acceso se nombra, no se deja
                  en blanco. No es un rol de `ROLES` — ver `roleCellLabel`.
                */}
                <td>{roleCellLabel(person)}</td>
                {/*
                  El correo al que se invitó a esta persona, y solo el de quien tiene
                  cuenta: el roster del CSV no trae correos. Va pegado a Role porque las dos
                  columnas responden a la misma pregunta —qué acceso tiene esta fila— y
                  antes de Actions porque es dato, no acto.

                  El guión y no el vacío: en una tabla donde la mayoría de las filas no tiene
                  cuenta, la columna en blanco se lee como una columna rota. Acá no hace falta
                  nombrar la ausencia como sí lo hace `roleCellLabel` con "Worker" —la celda
                  Role de esa misma fila ya lo dijo—, solo mostrar que el lugar existe y está
                  vacío a propósito.
                */}
                <td>{emailCellLabel(person) || '—'}</td>
                <td>
                  {/*
                    La acción tiene columna propia, separada del rol: el rol es un dato que
                    se compara hacia abajo —quién tiene acceso hoy— y el botón es un acto.
                    Mezclados en una celda, la columna cambiaba de ancho fila por fila y el
                    ojo perdía la lectura vertical del rol, que es para lo que la tabla
                    existe.

                    Cada fila ofrece SOLO el acto que su estado admite:

                    - sin acceso y activa → invitar. Cuenta acá tanto quien nunca tuvo
                      cuenta como aquel a quien se le quitó: las dos filas se dibujan
                      igual, porque son la misma pregunta;
                    - con cuenta que todavía no puede entrar → reemitir el link, y
                      cancelar la invitación;
                    - con cuenta que ya entra → quitar del JHSC.

                    Nada para quien no tiene acceso y está dado de baja — invitar a esa
                    fila es exactamente lo que 4.5 no ofrece. Esa celda queda vacía, y
                    vacía está bien: la columna existe porque OTRAS filas tienen un acto.
                  */}
                  <div className="table__actions">
                    {mayInvite && canInvite(person) ? (
                      <button
                        type="button"
                        aria-label={inviteButtonLabel(person)}
                        onClick={() =>
                          setInviting({ id: person.id, label: personLabel(person) })
                        }
                      >
                        Invite to JHSC
                      </button>
                    ) : null}
                    {mayInvite && canReissueInvitation(person) ? (
                      <button
                        type="button"
                        aria-label={reissueButtonLabel(person)}
                        onClick={() =>
                          setReissuing({ userId: person.account!.id, label: personLabel(person) })
                        }
                      >
                        New link
                      </button>
                    ) : null}
                    {mayInvite && canRemoveJhscAccess(person) ? (
                      <button
                        type="button"
                        aria-label={removeButtonLabel(person)}
                        onClick={() =>
                          setRemoving({
                            userId: person.account!.id,
                            label: personLabel(person),
                            canSignIn: person.account!.can_sign_in,
                          })
                        }
                      >
                        {removeButtonText(person)}
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {/*
        Montaje condicional: cada apertura crea el modal de nuevo, así que `showModal()`
        corre una sola vez por invitación y el email/token nacen limpios cada vez.
      */}
      {inviting ? (
        <InviteDialog
          personId={inviting.id}
          personLabel={inviting.label}
          siteId={siteId}
          onClose={() => setInviting(null)}
        />
      ) : null}

      {reissuing ? (
        <ReissueDialog
          userId={reissuing.userId}
          personLabel={reissuing.label}
          siteId={siteId}
          onClose={() => setReissuing(null)}
        />
      ) : null}

      {removing ? (
        <RemoveAccessDialog
          userId={removing.userId}
          personLabel={removing.label}
          canSignIn={removing.canSignIn}
          siteId={siteId}
          onClose={() => setRemoving(null)}
        />
      ) : null}

    </>
  );
}
