import * as dotenv from "dotenv";
dotenv.config();

import { SyncServer } from "./sync-server";
import {
  AuthManager,
  AuthStrategy,
  createJWTProviderFromEnv,
  createFirebaseProviderFromEnv,
} from "../shared/auth-index";

// Validate required environment variables
const required = [
  "MONGODB_URI",
  "WEB_PUBSUB_CONNECTION_STRING",
  "WEB_PUBSUB_HUB_NAME",
];
// AUTH_JWT_SECRET is optional for now (backwards compatible) but recommended.
if (!process.env.AUTH_JWT_SECRET) {
  console.warn(
    "⚠️ AUTH_JWT_SECRET not set – falling back to insecure userId join (set this for production)."
  );
}
for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

let server: SyncServer | undefined;

async function main() {
  // Configure provider-based authentication
  const authManager = new AuthManager({
    strategy: AuthStrategy.FIRST_SUCCESS,
    allowAnonymous: process.env.NODE_ENV !== "production",
    requireAuthInProduction: true,
    env: process.env.NODE_ENV,
  });
  authManager.registerProvider(createJWTProviderFromEnv());
  authManager.registerProvider(createFirebaseProviderFromEnv());
  await authManager.initialize();

  server = new SyncServer(
    process.env.MONGODB_URI!,
    process.env.WEB_PUBSUB_CONNECTION_STRING!,
    process.env.WEB_PUBSUB_HUB_NAME!,
    parseInt(process.env.PORT || "3000"),
    authManager
  );

  await server.start();
}

main().catch((err) => {
  console.error("Server start failed:", err);
  process.exit(1);
});

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down gracefully...");
  if (server) await server.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Shutting down gracefully...");
  if (server) await server.stop();
  process.exit(0);
});
