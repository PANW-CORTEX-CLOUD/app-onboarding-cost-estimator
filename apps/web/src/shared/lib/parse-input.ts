/**
 * Parse numeric form fields — empty → preset (never silent zero); invalid → fail closed.
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
