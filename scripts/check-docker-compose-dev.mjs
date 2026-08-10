#!/usr/bin/env node
/**
 * Assert docker-compose.dev.yml is a real buildable stack (not stock image-only)
 * with container networking: HOST=0.0.0.0 and API_PROXY_TARGET→api service.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const errors = [];

const dockerfile = path.join(ROOT, "Dockerfile.dev");
const composePath = path.join(ROOT, "docker-compose.dev.yml");

if (!fs.existsSync(dockerfile)) {
  errors.push("Missing Dockerfile.dev");
}

const compose = fs.readFileSync(composePath, "utf8");

for (const needle of [
  "dockerfile: Dockerfile.dev",
  "HOST: \"0.0.0.0\"",
  "API_PROXY_TARGET: \"http://api:8787\"",
  "image: cloud-connector-dev:local",
]) {
  if (!compose.includes(needle)) {
    errors.push(`docker-compose.dev.yml missing required snippet: ${needle}`);
  }
}

if (/image:\s*node:22/.test(compose)) {
  errors.push(
    "docker-compose.dev.yml must build Dockerfile.dev (not raw node:22 image)",
  );
}

if (errors.length) {
  console.error("DOCKER COMPOSE DEV CHECK FAILED:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log("DOCKER COMPOSE DEV CHECK: OK");
process.exit(0);
