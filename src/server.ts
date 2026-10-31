import path from "node:path";
import { createApp } from "./app";
import { AuthStore } from "./auth";
import { MarketplaceStore } from "./store";

const port = Number(process.env.MARKETPLACE_PORT ?? 4320);
const host = process.env.MARKETPLACE_HOST ?? "127.0.0.1";
const dataDir = path.resolve(process.env.MARKETPLACE_DATA_DIR ?? path.join(process.cwd(), "data"));
const adminToken = process.env.MARKETPLACE_ADMIN_TOKEN ?? "";
const adminUsername = process.env.MARKETPLACE_ADMIN_USERNAME ?? "";
const adminPassword = process.env.MARKETPLACE_ADMIN_PASSWORD ?? "";

const store = new MarketplaceStore(dataDir);
const accounts = new AuthStore(dataDir);
if (adminUsername && adminPassword) {
  try {
    accounts.ensureAdmin(adminUsername, adminPassword);
  } catch (error) {
    console.warn(
      `[marketplace] admin bootstrap skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
const app = createApp({ store, accounts, adminToken });

const server = app.listen(port, host, () => {
  console.log(`[marketplace] http://${host}:${port}`);
  console.log(`[marketplace] data: ${dataDir}`);
  if (!adminToken && !(adminUsername && adminPassword)) {
    console.warn(
      "[marketplace] uploads disabled: set MARKETPLACE_ADMIN_TOKEN or MARKETPLACE_ADMIN_USERNAME/PASSWORD",
    );
  }
});

const shutdown = (): void => {
  server.close(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
