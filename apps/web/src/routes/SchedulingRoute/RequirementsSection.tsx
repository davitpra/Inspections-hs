import { useState } from 'react';
import type { InspectionSchedule } from '@hs/contracts';

import { currentRules } from './presentation';
import { RequirementDialog } from './RequirementDialog';
import { RequirementRow } from './RequirementRow';

export function RequirementsSection({
  rules,
  siteId,
  canAdminister,
  ready,
}: {
  rules: readonly InspectionSchedule[];
  siteId: string;
  canAdminister: boolean;
  ready: boolean;
}): React.JSX.Element {
  const [adding, setAdding] = useState(false);
  const visible = currentRules(rules);

  return (
    <section className="requirements-section" aria-labelledby="requirements-heading">
      <div className="requirements-section__head">
        <div><h2 id="requirements-heading">Inspection requirements <span className="note">({visible.length})</span></h2><p className="note">Each requirement creates the periods this site owes.</p></div>
        {canAdminister ? <button type="button" className="button--primary requirements-section__add" onClick={() => setAdding(true)}>Add requirement</button> : null}
      </div>
      {ready && visible.length === 0 ? <p className="schedule-empty">No inspection requirements are configured for this site.</p> : null}
      {visible.length > 0 ? <ul className="requirements-list">{visible.map((rule) => <RequirementRow key={rule.template_id} rule={rule} siteId={siteId} canAdminister={canAdminister} />)}</ul> : null}
      {adding ? <RequirementDialog siteId={siteId} rules={rules} onClose={() => setAdding(false)} /> : null}
    </section>
  );
}
