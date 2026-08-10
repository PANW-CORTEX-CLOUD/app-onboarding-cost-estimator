import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolveApiProxyTarget } from "./src/vite-api-proxy.ts";

const apiProxyTarget = resolveApiProxyTarget(process.env);

export default defineConfig({
  plugins: [react()],
  root: ".",
  server: {
    port: 5173,
    // Compose publishes 5173; bind all interfaces so host can reach the container.
    host: process.env.VITE_DEV_HOST === "0.0.0.0" ? "0.0.0.0" : undefined,
    proxy: {
      // Browser openapi-fetch baseUrl `/v1` → API (local or Compose service DNS).
      "/v1": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
