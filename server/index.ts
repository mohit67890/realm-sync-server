import * as dotenv from "dotenv";
dotenv.config();

import { SyncServer } from "./sync-server";

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

const server = new SyncServer(
  process.env.MONGODB_URI!,
  process.env.WEB_PUBSUB_CONNECTION_STRING!,
  process.env.WEB_PUBSUB_HUB_NAME!,
  parseInt(process.env.PORT || "3000")
);

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down gracefully...");
  await server.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Shutting down gracefully...");
  await server.stop();
  process.exit(0);
});

// Start the server
server.start().catch((error) => {
  console.error("❌ Failed to start server:", error);
  process.exit(1);
});
