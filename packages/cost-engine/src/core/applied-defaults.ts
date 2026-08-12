/**
 * Recording which defaults an estimate actually leaned on.
 *
 * A default that nobody sees is a guess presented as a fact. The UI used to
 * hardcode four assumptions in one widget, which meant two things: a customer
 * could not tell which numbers they had supplied and which the tool invented,
 * and every new engine default was invisible until somebody remembered to edit
 * that widget. The second is drift; the first is an honesty problem.
 *
 * So the engine reports it instead. `DefaultsTracker` wraps the moment a
 * default is substituted, and the result travels out with the estimate, which
 * lets the UI render whatever the engine currently defaults without knowing the
 * list in advance.
 *
 * Two kinds, because they deserve different treatment:
 *
 * - `convention` — a billing convention that is the same for everyone (730
 *   hours in a month). Being wrong about it is not possible in the normal
 *   sense; it is definitional.
 * - `assumption` — a guess about *this customer's* estate (10 accounts, 4 scans
 *   a month, 4 MB objects). Being wrong about it changes the quote, so it has
 *   to be visible and easy to override.
 */

export type DefaultKind = "convention" | "assumption";

/** One default the engine substituted because the caller supplied nothing. */
export interface AppliedDefault {
  /** Request field the value stood in for, e.g. `volume.accountCount`. */
  field: string;
  /** Human label for display. */
  label: string;
  /** The value that was used. */
  value: number | string | boolean;
  kind: DefaultKind;
  /** Why this number and not another — shown to the customer. */
  rationale: string;
}

/**
 * Metadata for every default the engine can apply.
 *
 * Keyed by request field so a call site names the field it is filling rather
 * than restating the prose. Adding a default here and using it through
 * `DefaultsTracker` is all that is needed for it to appear in the UI.
 */
export const DEFAULT_METADATA: Record<
  string,
  { label: string; kind: DefaultKind; rationale: string }
> = {
  monthHours: {
    label: "Hours per month",
    kind: "convention",
    rationale:
      "Cloud providers bill a month as 730 hours (365×24/12), so this is definitional rather than an estimate.",
  },
  "volume.accountCount": {
    label: "Accounts in scope",
    kind: "assumption",
    rationale:
      "Audit volume scales with the number of accounts. 10 is the reference estate the elasticities are calibrated against — override it with your real count.",
  },
  "volume.scansPerMonth": {
    label: "Scans per month",
    kind: "assumption",
    rationale:
      "How often a capability re-scans. Disk scanning assumes roughly weekly; other scans assume monthly.",
  },
  "volume.pctScanned": {
    label: "Percent of estate scanned",
    kind: "assumption",
    rationale:
      "Share of the data estate one DSPM cycle covers. Scanning everything every cycle would cost proportionally more.",
  },
  "volume.avgObjectSizeMB": {
    label: "Average object size",
    kind: "assumption",
    rationale:
      "Object stores bill scanning per API call, so this converts your estate size into billable operations. Smaller objects mean more calls for the same bytes — this is a property of your data, not of the cloud.",
  },
  snapshotLifetimeHours: {
    label: "Snapshot lifetime",
    kind: "assumption",
    rationale:
      "How long a disk snapshot exists before the scanner deletes it. Snapshot storage bills per GB-month, so a short-lived snapshot is prorated rather than charged for a full month.",
  },
  "volume.avgPackageGB": {
    label: "Average package size",
    kind: "assumption",
    rationale:
      "Tracked for reporting only — serverless scanning bills per invocation, so this never multiplies a rate.",
  },
  "volume.avgImageGB": {
    label: "Average image size",
    kind: "assumption",
    rationale:
      "Cross-region registry scanning bills egress on the images it pulls, so this converts your image count into transferred gigabytes. Only applied when cross-region pull is on; a property of your registry, not the cloud, so override it with your real average.",
  },
};

/**
 * Collects defaults as they are applied during one estimate.
 *
 * @example
 * const defaults = new DefaultsTracker();
 * const accounts = defaults.resolve("volume.accountCount", req.volume?.accountCount, 10);
 * // → 10, and the substitution is recorded for the response
 */
export class DefaultsTracker {
  readonly #applied: AppliedDefault[] = [];

  /**
   * Return `provided` when the caller supplied it, otherwise `fallback` —
   * recording the substitution so it can be reported.
   *
   * An explicit value is never recorded, including an explicit zero: the point
   * is to show what the customer did *not* choose.
   *
   * @throws when the field has no metadata, so a default can never reach a
   *         customer without an explanation attached
   */
  resolve<T extends number | string | boolean>(
    field: string,
    provided: T | undefined,
    fallback: T,
  ): T {
    if (provided !== undefined) return provided;

    const meta = DEFAULT_METADATA[field];
    if (!meta) {
      throw new Error(
        `applied default '${field}' has no entry in DEFAULT_METADATA — add one so the customer can see why this number was chosen`,
      );
    }
    // Same field can be resolved by several capabilities in one estimate.
    if (!this.#applied.some((a) => a.field === field)) {
      this.#applied.push({
        field,
        label: meta.label,
        value: fallback,
        kind: meta.kind,
        rationale: meta.rationale,
      });
    }
    return fallback;
  }

  /** Everything substituted, conventions first so guesses stand out. */
  list(): AppliedDefault[] {
    const order: DefaultKind[] = ["convention", "assumption"];
    return [...this.#applied].sort(
      (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind),
    );
  }

  /** Only the guesses about this customer's estate. */
  assumptions(): AppliedDefault[] {
    return this.list().filter((a) => a.kind === "assumption");
  }
}
