/**
 * Scope & accounts inputs — account count / MAU (volume entity fields only).
 */
import { AffectsChips } from "../AffectsChips/AffectsChips.tsx";
import type { AffectsChip } from "../../shared/lib/affects-chips.ts";

export type ScopeAccountsProps = {
  accountCount: number;
  monthlyActiveUsers: number;
  onAccountCount: (n: number) => void;
  onMau: (n: number) => void;
  affectsAccountCount?: AffectsChip[];
  auditChipsActive?: boolean;
  onAuditChipClick?: () => void;
};

export function ScopeAccounts({
  accountCount,
  monthlyActiveUsers,
  onAccountCount,
  onMau,
  affectsAccountCount = [],
  auditChipsActive = false,
  onAuditChipClick,
}: ScopeAccountsProps) {
  return (
    <div data-testid="scope-accounts">
      <p className="section-lede">
        Estate size drives default stream volume unless you lock ingress below.
      </p>
      <label>
        Cloud accounts / subscriptions
        <input
          type="number"
          min={0}
          value={accountCount}
          data-testid="input-account-count"
          onChange={(e) => onAccountCount(Number(e.target.value) || 0)}
        />
        <span className="field-hint">
          Number of accounts or subscriptions in scope
        </span>
        <AffectsChips
          chips={affectsAccountCount}
          testId="affects-account-count"
          active={auditChipsActive}
          onChipClick={onAuditChipClick}
        />
      </label>
      <label>
        Monthly active users (MAU)
        <input
          type="number"
          min={0}
          value={monthlyActiveUsers}
          data-testid="input-mau"
          onChange={(e) => onMau(Number(e.target.value) || 0)}
        />
        <span className="field-hint">
          Scales audit volume slightly for larger end-user populations
        </span>
      </label>
    </div>
  );
}
