import type { AddressInfo } from "net";
import type { Server } from "http";
import type { Router } from "express";

/**
 * Boots the real app (trust proxy, clientIp middleware, helmet…) with the
 * given routers mounted and returns its base URL. Must be called after the
 * test has set any env vars the routers read at import time.
 */
export async function startApp(
  mounts: Array<[string, Router]>,
): Promise<{ url: string; server: Server }> {
  process.env.JWT_SECRET ??= "test-secret";
  // The app logs every request (console + morgan) to stdout, which corrupts
  // the node:test runner's child-process protocol when output is heavy.
  console.log = () => {};
  console.warn = () => {};
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require("../app") as typeof import("../app");
  for (const [path, router] of mounts) app.use(path, router);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}
