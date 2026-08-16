import type { InspectionSchedule } from "@hs/contracts";

import { InfoIcon } from "../../components/icons";
import { currentRules } from "./presentation";
import { NewRuleForm } from "./NewRuleForm";
import { RuleRow } from "./RuleRow";

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
  const visible = currentRules(rules);

  return (
    <section className="card rules-card">
      <details open>
        <summary>
          <strong>Recurrence rules</strong> <InfoIcon />{" "}
          <span className="note">({visible.length})</span>
        </summary>

        {ready && visible.length === 0 ? (
          <p>
            This site owes no monthly inspection. Without a rule, no period
            is ever opened.
          </p>
        ) : null}

        <ul className="list">
          {visible.map((rule) => (
            <RuleRow
              key={rule.template_id}
              rule={rule}
              siteId={siteId}
              canAdminister={canAdminister}
            />
          ))}
        </ul>

        {canAdminister ? <NewRuleForm siteId={siteId} rules={rules} /> : null}
      </details>
    </section>
  );
}
