/**
 * Web app entry — FSD layers under apps/web/src (packages 17–19).
 * Depends on generated OpenAPI client types + openapi-fetch only —
 * never packages/api source or cost-engine providers.
 */
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing #root element");
}
createRoot(root).render(<App />);
