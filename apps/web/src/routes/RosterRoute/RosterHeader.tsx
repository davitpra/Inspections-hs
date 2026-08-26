import type { Site } from '@hs/contracts';

import { PersonIcon, PlusIcon } from '../../components/icons';
import { SitePicker } from '../../components/SitePicker';

export function RosterHeader({
  sites,
  siteId,
  siteName,
  noActiveSite,
  mayAddPerson,
  addTriggerRef,
  onSiteChange,
  onAddPerson,
}: {
  sites: readonly Site[];
  siteId: string;
  siteName: (id: string) => string;
  noActiveSite: boolean;
  mayAddPerson: boolean;
  addTriggerRef: React.RefObject<HTMLButtonElement | null>;
  onSiteChange: (siteId: string) => void;
  onAddPerson: () => void;
}): React.JSX.Element {
  return (
    <header className="scheduling__top roster-header">
      <div className="scheduling__header">
        <div className="scheduling__title">
          <span className="scheduling__icon">
            <PersonIcon size={22} />
          </span>
          <h1>Roster</h1>
        </div>
        <p className="scheduling__subtitle">
          Everyone who works at this plant, and who of them can sign in to the JHSC console.
        </p>
      </div>

      {noActiveSite ? null : (
        <div className="scheduling__header-actions roster-header__actions">
          <SitePicker
            sites={sites}
            value={siteId}
            onChange={onSiteChange}
            siteName={siteName}
          />
          {mayAddPerson ? (
            <button
              ref={addTriggerRef}
              type="button"
              className="button--primary scheduling__header-add"
              onClick={onAddPerson}
            >
              <PlusIcon /> Add person
            </button>
          ) : null}
        </div>
      )}
    </header>
  );
}
