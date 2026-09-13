import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { listSites } from "../../api/inspections";
import { queryKeys } from "../../api/query-keys";
import { listPeople } from "../../api/roster";
import { useAppSession } from "../../app/session-context";
import {
  CheckIcon,
  ClockIcon,
  InfoIcon,
  PersonIcon,
} from "../../components/icons";
import { StatsBar } from "../../components/StatsBar";
import {
  canAddPersonToRoster,
  canAdministerRoster,
  canImportRoster,
  canInviteFromRoster,
  canDemote,
  canPromote,
} from "../../permissions/session";
import { resolveSiteId } from "../../presentation/sites";
import { AddPersonDialog } from "./AddPersonDialog";
import { ImportDialog } from "./ImportDialog";
import { rosterCounts, sortRoster, type RosterDialog } from "./presentation";
import { RosterDialogs } from "./RosterDialogs";
import { RosterHeader } from "./RosterHeader";
import { RosterTable } from "./RosterTable";

/**
 * §6 — La consola del roster: quién trabaja en esta planta.
 *
 * **ESTO NO ES EL SELECTOR DE SUJETO, Y LA DISTINCIÓN ES LA QUE SOSTIENE LA PANTALLA.** §4
 * dice que el reporte de incidentes elige a una persona *sin mostrar su perfil*, y eso ata al
 * selector —cuatro columnas, `GET /scheduled-inspections/:id/roster`—, no a la
 * administración que §6 le pide al coordinador. Por eso acá el rol se comprueba en la
 * LECTURA, al revés que la consola de programación, que deja mirar a cualquiera: esta ruta
 * SÍ devuelve el perfil. Si alguien conecta el `PersonPicker` de los incidentes a
 * `GET /people`, rompe lo único que las mantiene separadas.
 *
 * Nombres y números se corrigen desde la fila; la planta se corrige desde el CSV. La pantalla
 * ofrece esa importación completa, el alta de UNA persona y la baja lógica estrecha de un worker
 * sin cuenta. El CSV sigue mandando: una fila posterior con el mismo número puede actualizar o
 * reactivar a la persona.
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
        <h1>People &amp; Access</h1>
        <p className="notice">
           Only coordinators and management can manage people and access.
        </p>
      </>
    );
  }

  return (
    <RosterConsole
      siteScope={account.siteScope}
      canInviteFromRoster={canInviteFromRoster(account)}
      canImportRoster={canImportRoster(account)}
      canAddPersonToRoster={canAddPersonToRoster(account)}
      canPromote={canPromote(account)}
      canDemote={canDemote(account)}
    />
  );
}

/**
 * La misma pila de piezas que programación y ubicaciones —`.scheduling__top`, `.stats-bar`,
 * `.card`, `.status-card`—: son la misma pantalla vista tres veces, elegir planta, entender
 * de un vistazo qué falta, y actuar sobre una fila.
 */
function RosterConsole({
  siteScope,
  canInviteFromRoster: mayInvite,
  canImportRoster: mayImport,
  canAddPersonToRoster: mayAddPerson,
  canPromote: mayPromote,
  canDemote: mayDemote,
}: {
  siteScope: readonly string[];
  canInviteFromRoster: boolean;
  canImportRoster: boolean;
  canAddPersonToRoster: boolean;
  canPromote: boolean;
  canDemote: boolean;
}): React.JSX.Element {
  const importTriggerRef = useRef<HTMLButtonElement>(null);
  const addTriggerRef = useRef<HTMLButtonElement>(null);
  const [chosenSite, setChosenSite] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [dialog, setDialog] = useState<RosterDialog | null>(null);

  const sites = useQuery({
    queryKey: queryKeys.sites(),
    queryFn: listSites,
    retry: false,
  });

  // La baja no saca la planta de `user_site_scope`, así que `siteScope[0]` puede ser una
  // planta cerrada; `resolveSiteId` abre en una activa, igual que la consola de programación.
  const siteId = resolveSiteId(sites.data ?? [], siteScope, chosenSite);
  const noActiveSite = sites.isSuccess && siteId === "";

  const roster = useQuery({
    queryKey: queryKeys.roster(siteId),
    queryFn: () => listPeople(siteId),
    enabled: siteId !== "",
    retry: false,
  });

  const siteName = (id: string): string =>
    sites.data?.find((site) => site.id === id)?.name ?? id;

  const all = sortRoster(roster.data ?? []);
  const counts = rosterCounts(all);

  return (
    <>
      <RosterHeader
        sites={sites.data ?? []}
        siteId={siteId}
        siteName={siteName}
        noActiveSite={noActiveSite}
        mayAddPerson={mayAddPerson}
        addTriggerRef={addTriggerRef}
        onSiteChange={setChosenSite}
        onAddPerson={() => setAdding(true)}
      />

      {roster.isError ? (
        <p className="status-card status-card--error">
          <InfoIcon size={20} /> This view needs a connection.
        </p>
      ) : null}
      {roster.isLoading ? (
        <p className="status-card">
          <PersonIcon size={20} /> Loading…
        </p>
      ) : null}
      {noActiveSite ? (
        <p className="status-card">
          <InfoIcon size={20} /> No active sites.
        </p>
      ) : null}

      {/* Sobre el roster ENTERO, no sobre lo que filtró la búsqueda: son el estado de la
          planta. Lo que la búsqueda recortó lo dice el contador de la tabla. */}
      {roster.isSuccess && all.length > 0 ? (
        <StatsBar
          items={[
            {
              icon: <PersonIcon size={20} />,
              number: counts.total,
              label: "People at this site",
            },
            {
              icon: <CheckIcon size={20} />,
              number: counts.withAccess,
              label: "With app access",
            },
            {
              icon: <ClockIcon size={20} />,
              number: counts.invited,
              label: "Invited",
            },
          ]}
        />
      ) : null}

      <RosterTable
        people={all}
        siteName={siteName(siteId)}
        ready={roster.isSuccess}
        mayInvite={mayInvite}
        mayImport={mayImport}
        mayPromote={mayPromote}
        mayDemote={mayDemote}
        importTriggerRef={importTriggerRef}
        onImport={() => setImporting(true)}
        onAct={setDialog}
      />

      {dialog ? (
        <RosterDialogs
          dialog={dialog}
          siteId={siteId}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {importing ? (
        <ImportDialog
          onClose={() => setImporting(false)}
          returnFocusTo={importTriggerRef}
        />
      ) : null}

      {adding ? (
        <AddPersonDialog
          siteId={siteId}
          siteName={siteName(siteId)}
          onClose={() => setAdding(false)}
          returnFocusTo={addTriggerRef}
        />
      ) : null}
    </>
  );
}
