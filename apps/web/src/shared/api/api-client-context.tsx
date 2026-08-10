/**
 * React context for the typed openapi-fetch client (injectable for tests).
 * Lives in shared so pages/features can consume without upward FSD imports.
 */
import { createContext, useContext, type ReactNode } from "react";
import { createCostApiClient, type CostApiClient } from "./client.ts";

const ApiClientContext = createContext<CostApiClient | null>(null);

export function ApiClientProvider({
  client,
  children,
}: {
  client?: CostApiClient;
  children: ReactNode;
}) {
  const value = client ?? createCostApiClient();
  return (
    <ApiClientContext.Provider value={value}>
      {children}
    </ApiClientContext.Provider>
  );
}

export function useApiClient(): CostApiClient {
  const ctx = useContext(ApiClientContext);
  if (!ctx) {
    throw new Error("useApiClient requires ApiClientProvider");
  }
  return ctx;
}
