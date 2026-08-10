/**
 * Parse numeric form fields — empty → preset (never silent zero); invalid → fail closed.
 * Empty input is NOT coerced to 0 — it falls back to `preset` so a blank field never
 * silently zeroes out a cost driver. Non-numeric or negative input fails closed
 * (`ok: false`) instead of being clamped, so the caller can block the estimate run.
 * @param raw Raw form field text.
 * @param preset Value to use when `raw` is blank.
 * @param fieldName Used only in the error message.
 */
export function parseNonNegativeOrPreset(
  raw: string,
  preset: number,
  fieldName: string,
): { ok: true; value: number } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: true, value: preset };
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    return { ok: false, error: `${fieldName}: invalid number (fail closed)` };
  }
  if (n < 0) {
    return {
      ok: false,
      error: `${fieldName}: must be ≥ 0 (fail closed)`,
    };
  }
  return { ok: true, value: n };
}
