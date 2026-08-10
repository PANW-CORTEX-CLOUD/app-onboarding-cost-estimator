/**
 * Section shell — one job per section; optional loading skeleton + inline error.
 * Failures stay local (EDGE: no full-page blank on single-section failure).
 */
import type { ReactNode } from "react";

export type EstimatorSectionProps = {
  id: string;
  title: string;
  landmark?: "section" | "complementary";
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
};

export function EstimatorSection({
  id,
  title,
  landmark = "section",
  loading = false,
  error = null,
  children,
}: EstimatorSectionProps) {
  const Tag = landmark === "complementary" ? "aside" : "section";
  return (
    <Tag
      id={id}
      aria-labelledby={`${id}-heading`}
      data-testid={`section-${id}`}
      data-section={id}
    >
      <h2 id={`${id}-heading`}>{title}</h2>
      {loading ? (
        <p
          role="status"
          data-testid={`skeleton-${id}`}
          className="section-skeleton"
        >
          Loading…
        </p>
      ) : null}
      {error ? (
        <p role="alert" data-testid={`section-error-${id}`}>
          {error}
        </p>
      ) : null}
      {children}
    </Tag>
  );
}
