/**
 * Contextual volume inputs when capabilities are enabled (package 26).
 */
import type { EstimateCapabilities } from "../../entities/estimate/types.ts";

export type CapabilityVolumeFieldsProps = {
  caps: EstimateCapabilities;
  dataEstateGB: number;
  pctScanned: number;
  scansPerMonth: number;
  vmCount: number;
  avgUsedDiskGB: number;
  imageCount: number;
  avgImageGB: number;
  packageCount: number;
  egressGB: number;
  onChange: (patch: Partial<CapabilityVolumeFieldsProps>) => void;
};

export function CapabilityVolumeFields({
  caps,
  dataEstateGB,
  pctScanned,
  scansPerMonth,
  vmCount,
  avgUsedDiskGB,
  imageCount,
  avgImageGB,
  packageCount,
  egressGB,
  onChange,
}: CapabilityVolumeFieldsProps) {
  if (
    !caps.dspm &&
    !caps.adsCloud &&
    !caps.adsOutpost &&
    !caps.registry &&
    !caps.serverless &&
    !caps.egress
  ) {
    return null;
  }

  return (
    <div data-testid="capability-volume-fields">
      <h3>Inputs for enabled capabilities</h3>
      <p className="section-lede">
        These appear only for capabilities you turned on. Missing volume often
        yields a $0 row with a warning — we never invent spend.
      </p>
      {caps.dspm ? (
        <>
          <label>
            Data estate size (GB)
            <input
              type="number"
              min={0}
              data-testid="input-estate-main"
              value={dataEstateGB}
              onChange={(e) =>
                onChange({ dataEstateGB: Number(e.target.value) || 0 })
              }
            />
            <span className="field-hint">
              Required for DSPM (&gt; 0). Total data in scope.
            </span>
          </label>
          <label>
            Percent of estate scanned
            <input
              type="number"
              min={0}
              data-testid="input-pct-scanned"
              value={pctScanned}
              onChange={(e) =>
                onChange({ pctScanned: Number(e.target.value) || 0 })
              }
            />
            <span className="field-hint">e.g. 10 = scan 10% each cycle</span>
          </label>
        </>
      ) : null}
      {(caps.adsCloud || caps.adsOutpost || caps.dspm || caps.registry) ? (
        <label>
          Scans per month
          <input
            type="number"
            min={0}
            data-testid="input-scans-per-month"
            value={scansPerMonth}
            onChange={(e) =>
              onChange({ scansPerMonth: Number(e.target.value) || 0 })
            }
          />
          <span className="field-hint">How often workloads re-scan</span>
        </label>
      ) : null}
      {(caps.adsCloud || caps.adsOutpost) ? (
        <>
          <label>
            Virtual machines to scan
            <input
              type="number"
              min={0}
              data-testid="input-vm-count"
              value={vmCount}
              onChange={(e) =>
                onChange({ vmCount: Number(e.target.value) || 0 })
              }
            />
          </label>
          <label>
            Average used disk per VM (GB)
            <input
              type="number"
              min={0}
              data-testid="input-avg-disk-gb"
              value={avgUsedDiskGB}
              onChange={(e) =>
                onChange({ avgUsedDiskGB: Number(e.target.value) || 0 })
              }
            />
            <span className="field-hint">
              Snapshot / scan volume ≈ VMs × disk × scans
            </span>
          </label>
        </>
      ) : null}
      {caps.registry ? (
        <>
          <label>
            Container images
            <input
              type="number"
              min={0}
              data-testid="input-image-count"
              value={imageCount}
              onChange={(e) =>
                onChange({ imageCount: Number(e.target.value) || 0 })
              }
            />
          </label>
          <label>
            Average image size (GB)
            <input
              type="number"
              min={0}
              data-testid="input-avg-image-gb"
              value={avgImageGB}
              onChange={(e) =>
                onChange({ avgImageGB: Number(e.target.value) || 0 })
              }
            />
          </label>
        </>
      ) : null}
      {caps.serverless ? (
        <label>
          Serverless packages
          <input
            type="number"
            min={0}
            data-testid="input-package-count"
            value={packageCount}
            onChange={(e) =>
              onChange({ packageCount: Number(e.target.value) || 0 })
            }
          />
        </label>
      ) : null}
      {caps.egress ? (
        <label>
          Outbound data transfer (GB / month)
          <input
            type="number"
            min={0}
            data-testid="input-egress-gb"
            value={egressGB}
            onChange={(e) =>
              onChange({ egressGB: Number(e.target.value) || 0 })
            }
          />
        </label>
      ) : null}
    </div>
  );
}
