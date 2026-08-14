import type { InspectionSchedule } from '@hs/contracts';

import { NewRuleForm } from './NewRuleForm';
import { RuleRow } from './RuleRow';

/** Las reglas: qué debe esta planta todos los meses. */
export function RulesSection({
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
  return (
    <section>
      <h2>Recurrence rules</h2>

      {ready && rules.length === 0 ? (
        <p>This site owes no monthly inspection. Without a rule, no period is ever opened.</p>
      ) : null}

      <ul className="list">
        {rules.map((rule) => (
          <RuleRow key={rule.id} rule={rule} canAdminister={canAdminister} />
        ))}
      </ul>

      {canAdminister ? <NewRuleForm siteId={siteId} rules={rules} /> : null}
    </section>
  );
}
