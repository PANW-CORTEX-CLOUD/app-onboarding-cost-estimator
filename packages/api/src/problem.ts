/**
 * RFC 7807 Problem Details helpers (package 15 AC).
 */
export type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
};

export function problem(
  status: number,
  title: string,
  detail?: string,
  type = "about:blank",
): ProblemDetails {
  return { type, title, status, detail };
}
