/**
 * HTTP listen options for the API process (local + Docker Compose).
 * Fail closed on invalid HOST/PORT so misconfigured containers do not silently bind wrong.
 */

export type ListenConfig = {
  port: number;
  hostname: string;
};

const DEFAULT_PORT = 8787;
/** Loopback default keeps local `pnpm start` host-only; Compose sets HOST=0.0.0.0. */
const DEFAULT_HOST = "127.0.0.1";

/**
 * Parse PORT + HOST from env (or defaults).
 * @throws Error when PORT is non-positive / non-finite, or HOST is empty after trim.
 */
export function resolveListenConfig(
  env: NodeJS.ProcessEnv = process.env,
): ListenConfig {
  const portRaw = env.PORT ?? String(DEFAULT_PORT);
  const port = Number(portRaw);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("PORT must be a positive number");
  }

  const hostname = (env.HOST ?? DEFAULT_HOST).trim();
  if (!hostname) {
    throw new Error("HOST must be a non-empty hostname or IP");
  }

  return { port, hostname };
}
