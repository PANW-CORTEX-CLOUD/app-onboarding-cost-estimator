/**
 * App shell — wires API client provider + estimator page (FSD app layer).
 */
import type { ReactNode } from "react";
import { ApiClientProvider } from "../shared/api/api-client-context.tsx";
import type { CostApiClient } from "../shared/api/client.ts";
import { EstimatorPage } from "../pages/estimator/EstimatorPage.tsx";

export function App({ client }: { client?: CostApiClient }): ReactNode {
  return (
    <ApiClientProvider client={client}>
      <EstimatorPage />
    </ApiClientProvider>
  );
}
