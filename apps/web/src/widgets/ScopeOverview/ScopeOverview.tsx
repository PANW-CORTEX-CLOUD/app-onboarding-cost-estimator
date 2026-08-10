/**
 * Step 1 — what do you want Cortex to do, and can it actually be billed?
 *
 * This is the screen that decides everything downstream: each capability shows
 * whether the connector Terraform deploys it, and which questions turning it on
 * will make the next step ask. Choosing "as deployed" then restricts the
 * estimate to what `terraform apply` will really create, so the total is
 * comparable to the customer's first invoice instead of a wish list.
 */
import type { EstimateCapabilities } from "../../entities/estimate/types.ts";
import type { CloudProvider } from "../../shared/model/cloud-provider.ts";
import {
  capabilityHint,
  capabilityLabel,
} from "../../shared/model/capability-labels.ts";
import {
  capabilityDeployability,
  costDriversForCapability,
  costDriversForSelection,
  deployabilityHint,
  deployabilityLabel,
  type TfDeployability,
  type TfMode,
} from "../../shared/model/tf-grounding.ts";
import { CAPABILITY_KEYS } from "../CapabilityToggles/CapabilityToggles.tsx";

export type ScopeOverviewProps = {
  provider: CloudProvider;
  value: EstimateCapabilities;
  onChange: (next: EstimateCapabilities) => void;
  tfMode: TfMode;
  onTfModeChange: (next: TfMode) => void;
  disabled?: boolean;
};

const BADGE_CLASS: Record<TfDeployability, string> = {
  deployed: "scope-badge scope-badge--deployed",
  "not-deployed": "scope-badge scope-badge--off",
  "no-connector-tf": "scope-badge scope-badge--modeled",
};

export function ScopeOverview({
  provider,
  value,
  onChange,
  tfMode,
  onTfModeChange,
  disabled = false,
}: ScopeOverviewProps) {
  const selected = CAPABILITY_KEYS.filter((k) => Boolean(value[k]));
  const billable = selected.filter(
    (k) => capabilityDeployability(provider, k) === "deployed",
  );
  const modelled = selected.filter(
    (k) => capabilityDeployability(provider, k) === "no-connector-tf",
  );
  const switchedOff = selected.filter(
    (k) => capabilityDeployability(provider, k) === "not-deployed",
  );
  const questions = costDriversForSelection(selected);
  const droppedByMode = tfMode === "as-deployed" ? [...modelled, ...switchedOff] : [];

  return (
    <div data-testid="scope-overview" className="scope-overview">
      <p className="section-lede">
        Pick what you want Cortex to do. Each choice is labelled with whether
        your connector Terraform actually deploys it, and with the questions it
        will add to the next step.
      </p>

      <fieldset data-testid="scope-overview-caps" disabled={disabled}>
        <legend className="sr-only">Functionality to estimate</legend>
        <ul className="scope-overview-list">
          {CAPABILITY_KEYS.map((key) => {
            const kind = capabilityDeployability(provider, key);
            const drivers = costDriversForCapability(key);
            return (
              <li key={key} className="scope-overview-item">
                <label data-selected={value[key] ? "true" : undefined}>
                  <input
                    type="checkbox"
                    checked={Boolean(value[key])}
                    data-testid={`scope-cap-${key}`}
                    onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
                  />
                  <span className="scope-overview-text">
                    <span className="scope-overview-title">
                      {capabilityLabel(key)}
                      <span
                        className={BADGE_CLASS[kind]}
                        data-testid={`scope-badge-${key}`}
                      >
                        {deployabilityLabel(kind)}
                      </span>
                    </span>
                    {capabilityHint(key) ? (
                      <span className="field-hint">{capabilityHint(key)}</span>
                    ) : null}
                    <span className="field-hint">
                      {deployabilityHint(provider, kind)}
                    </span>
                    <span
                      className="field-hint"
                      data-testid={`scope-drivers-${key}`}
                    >
                      {drivers.length
                        ? `Will ask about: ${drivers.join(", ")}`
                        : "Asks nothing — no billable meter"}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <fieldset className="scope-mode" data-testid="scope-mode" disabled={disabled}>
        <legend>How should we price it?</legend>
        <label data-selected={tfMode === "as-deployed" ? "true" : undefined}>
          <input
            type="radio"
            name="tf-mode"
            value="as-deployed"
            checked={tfMode === "as-deployed"}
            data-testid="tf-mode-as-deployed"
            onChange={() => onTfModeChange("as-deployed")}
          />
          <span className="scope-overview-text">
            <span className="scope-overview-title">As deployed</span>
            <span className="field-hint">
              Price only what the connector Terraform creates. This is the
              number to compare against the first invoice.
            </span>
          </span>
        </label>
        <label data-selected={tfMode === "what-if" ? "true" : undefined}>
          <input
            type="radio"
            name="tf-mode"
            value="what-if"
            checked={tfMode === "what-if"}
            data-testid="tf-mode-what-if"
            onChange={() => onTfModeChange("what-if")}
          />
          <span className="scope-overview-text">
            <span className="scope-overview-title">What-if</span>
            <span className="field-hint">
              Also price capabilities with no connector Terraform, labelled as
              modelled. Use for planning, not for budgeting.
            </span>
          </span>
        </label>
      </fieldset>

      <div className="scope-summary" data-testid="scope-summary">
        {selected.length === 0 ? (
          <p data-testid="scope-summary-empty">
            Nothing selected yet — pick at least one capability to get a cost.
          </p>
        ) : (
          <>
            <p data-testid="scope-summary-counts">
              {selected.length} selected · {billable.length} billed from your
              Terraform · {modelled.length} modelled without Terraform
              {switchedOff.length ? ` · ${switchedOff.length} switched off in the Terraform` : ""}
            </p>
            {droppedByMode.length ? (
              <p
                className="scope-summary-warn"
                data-testid="scope-summary-dropped"
              >
                As-deployed mode will leave out{" "}
                {droppedByMode.map((k) => capabilityLabel(k)).join(", ")} —{" "}
                {droppedByMode.length === 1 ? "it is" : "they are"} not created
                by the Terraform. Switch to what-if to price{" "}
                {droppedByMode.length === 1 ? "it" : "them"} anyway.
              </p>
            ) : null}
            <p data-testid="scope-summary-questions">
              {questions.length
                ? `Next step will ask about: ${questions.join(", ")}.`
                : "Next step has nothing to ask — this selection has no cost drivers."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
