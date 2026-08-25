import React from "react";
import type { SlashSkill } from "../../services/slash-skills";
import type { InstalledSkill } from "../../services/user-skills";

export const SENSITIVITY_SLASH = "业财敏感性";
export const SETTLEMENT_SLASH = "结算对账";

const SCENARIOS: Array<{ extra: string; label: string }> = [
  { extra: "退款率+4pp", label: "退款率 +4pp" },
  { extra: "汇率-0.2", label: "汇率 −0.2" },
  { extra: "佣金+2pp", label: "佣金 +2pp" },
];

export function hasFinanceSensitivity(
  skills: Array<SlashSkill | InstalledSkill>
): boolean {
  return skills.some(function (s) {
    return s.slash === SENSITIVITY_SLASH || s.id === "finance-sensitivity";
  });
}

export function hasSettlementRecon(
  skills: Array<SlashSkill | InstalledSkill>
): boolean {
  return skills.some(function (s) {
    return s.slash === SETTLEMENT_SLASH || s.id === "settlement-bank-recon";
  });
}

interface Props {
  skills: Array<SlashSkill | InstalledSkill>;
  disabled?: boolean;
  onRun: (text: string) => void;
}

/** One-click silent skill runs (sends slash + extra into chat). */
export default function FinancePackQuickActions({
  skills,
  disabled,
  onRun,
}: Props): JSX.Element | null {
  const sens = hasFinanceSensitivity(skills);
  const settle = hasSettlementRecon(skills);
  if (!sens && !settle) return null;

  return (
    <div className="finance-quick" role="group" aria-label="业财快捷">
      {sens
        ? SCENARIOS.map(function (s) {
            return (
              <button
                key={s.extra}
                type="button"
                className="finance-quick-btn"
                disabled={disabled}
                title={"/" + SENSITIVITY_SLASH + " " + s.extra}
                onClick={() => onRun("/" + SENSITIVITY_SLASH + " " + s.extra)}
              >
                {s.label}
              </button>
            );
          })
        : null}
      {settle ? (
        <>
          <button
            type="button"
            className="finance-quick-btn"
            disabled={disabled}
            title={"/" + SETTLEMENT_SLASH}
            onClick={() => onRun("/" + SETTLEMENT_SLASH)}
          >
            结算对账 ±3天
          </button>
          <button
            type="button"
            className="finance-quick-btn"
            disabled={disabled}
            title={"/" + SETTLEMENT_SLASH + " 按 settlement_id 精确匹配"}
            onClick={() => onRun("/" + SETTLEMENT_SLASH + " 按 settlement_id 精确匹配")}
          >
            结算对账 · id
          </button>
        </>
      ) : null}
    </div>
  );
}
