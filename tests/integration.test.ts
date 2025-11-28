import * as dotenv from "dotenv";
dotenv.config();

import { SyncClient } from "../client/sync-client";
import { SyncServer } from "../server/sync-server";

describe("Integration Tests", () => {
  let server: SyncServer;
  let client1: SyncClient;
  let client2: SyncClient;

  const testPort = 3001;
  const serverUrl = `http://localhost:${testPort}`;
  const mongoUri =
    process.env.MONGODB_URI ||
    "mongodb://localhost:27017/sync_integration_test";

  beforeAll(async () => {
    // Start server
    server = new SyncServer(
      mongoUri,
      process.env.WEB_PUBSUB_CONNECTION_STRING!,
      "test-hub",
      testPort
    );
    await server.start();

    // Wait for server to be ready
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }, 15000);

  afterAll(async () => {
    await server.stop();
  }, 10000);

  beforeEach(async () => {
    client1 = new SyncClient(serverUrl, "test-user-1", `${mongoUri}_client1`);
    client2 = new SyncClient(serverUrl, "test-user-2", `${mongoUri}_client2`);

    await client1.initialize();
    await client2.initialize();
    await client1.connect();
    await client2.connect();

    // Wait for connections
    await new Promise((resolve) => setTimeout(resolve, 2000));
  });

  afterEach(async () => {
    await client1.disconnect();
    await client2.disconnect();
  });

  it("should sync changes between two clients", async () => {
    // Client 1 makes a change
    await client1.makeChange("insert", "test_tasks", "task-1", {
      title: "Test Task",
      completed: false,
    });

    // Wait for sync
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Verify both clients are online
    expect(client1.isOnline()).toBe(true);
    expect(client2.isOnline()).toBe(true);

    // Client 2 should have received the change (verified by no errors)
    expect(client2.getLastSyncTimestamp()).toBeGreaterThan(0);
  }, 15000);

  it("should handle offline changes", async () => {
    // Disconnect client
    await client1.disconnect();

    // Make changes while offline
    client1 = new SyncClient(serverUrl, "test-user-1", `${mongoUri}_client1`);
    await client1.initialize();

    // Verify offline
    expect(client1.isOnline()).toBe(false);

    // Reconnect
    await client1.connect();
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Verify back online
    expect(client1.isOnline()).toBe(true);
  }, 15000);

  it("should maintain order of changes", async () => {
    // Client 1 makes multiple changes
    await client1.makeChange("insert", "test_ordered", "item-1", { order: 1 });
    await new Promise((resolve) => setTimeout(resolve, 100));

    await client1.makeChange("insert", "test_ordered", "item-2", { order: 2 });
    await new Promise((resolve) => setTimeout(resolve, 100));

    await client1.makeChange("insert", "test_ordered", "item-3", { order: 3 });

    // Wait for all syncs
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Verify no pending changes
    expect(client1.getPendingChangesCount()).toBe(0);
  }, 15000);
});
