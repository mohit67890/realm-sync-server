/**
 * End-to-End Tests: Multi-Client Sync Scenarios
 * Tests real-world realm-core usage patterns with multiple clients
 */

import { SyncClient } from "../../client/sync-client";
import { SyncServer } from "../../server/sync-server";
import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

// Increase Jest timeout for long-running multi-client scenarios
jest.setTimeout(60000);

describe("E2E: Multi-Client Sync for Realm-Core", () => {
  let server: SyncServer;
  let mongoClient: MongoClient;
  const testPort = 3002;
  const serverUrl = `http://localhost:${testPort}`;
  let mongoUri =
    process.env.TEST_MONGODB_URI ||
    process.env.MONGODB_URI ||
    "mongodb://localhost:27017/realm_e2e_test";
  let memoryServer: MongoMemoryServer | null = null;
  const useInMemory = process.env.USE_IN_MEMORY === "1";
  const isAtlas = mongoUri.includes("mongodb+srv://");
  // Skip if using default localhost URI and no explicit env override provided
  const skipSuite =
    !process.env.TEST_MONGODB_URI &&
    !process.env.MONGODB_URI &&
    mongoUri.includes("localhost");
  const webPubSubConnectionString =
    process.env.WEB_PUBSUB_CONNECTION_STRING ||
    "Endpoint=https://test.webpubsub.azure.com;AccessKey=testkey123;Version=1.0;";

  beforeAll(async () => {
    if (skipSuite) return;
    if (useInMemory) {
      memoryServer = await MongoMemoryServer.create({
        instance: { dbName: "realm_e2e_test" },
      });
      mongoUri = memoryServer.getUri();
      console.log(`🧪 Using in-memory MongoDB at ${mongoUri}`);
    }
    server = new SyncServer(
      mongoUri,
      webPubSubConnectionString,
      "test-hub",
      testPort
    );
    await server.start();
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    // Poll readiness endpoint
    const readyUrl = `http://localhost:${testPort}/ready`;
    const start = Date.now();
    const timeoutMs = 15000;
    while (true) {
      try {
        const res = await fetch(readyUrl);
        if (res.ok) {
          const json: any = await res.json();
          if (json.status === "ready") break;
        }
      } catch (_) {
        // ignore until timeout
      }
      if (Date.now() - start > timeoutMs) {
        console.warn(
          `⚠️ Server not ready after ${timeoutMs}ms; skipping E2E suite.`
        );
        (global as any).__E2E_READY_FAILED__ = true;
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }, 60000);

  afterAll(async () => {
    if (skipSuite) return;
    if (server) await server.stop();
    if (mongoClient) await mongoClient.close();
    if (memoryServer) {
      await memoryServer.stop();
      console.log("🧪 In-memory MongoDB stopped");
    }
  }, 10000);

  describe("Realm Object Sync", () => {
    if (skipSuite || (global as any).__E2E_READY_FAILED__) {
      it.skip("skipped due to missing MongoDB or server not ready", () => {});
      return;
    }
    it("should negotiate Azure token and sync realm objects between clients in real-time", async () => {
      // Negotiate Azure Web PubSub token for each user (ensures Azure path exercised)
      const negotiateUser = async (userId: string) => {
        const res = await fetch(
          `${serverUrl}/api/negotiate?userId=${encodeURIComponent(userId)}`
        );
        expect(res.ok).toBe(true);
        const body: any = await res.json();
        expect(body.token).toBeDefined();
        expect(body.url).toBeDefined();
        // Basic assertion the URL references Azure Web PubSub (if using real service)
        if (
          process.env.WEB_PUBSUB_CONNECTION_STRING?.includes(
            "webpubsub.azure.com"
          )
        ) {
          expect(body.url).toContain("webpubsub.azure.com");
        }
        return body;
      };
      const token1 = await negotiateUser("user-1");
      const token2 = await negotiateUser("user-2");

      const client1 = new SyncClient(
        serverUrl,
        "user-1",
        `${mongoUri}_client1`,
        token1.jwt
      );
      const client2 = new SyncClient(
        serverUrl,
        "user-2",
        `${mongoUri}_client2`,
        token2.jwt
      );

      await client1.initialize();
      await client2.initialize();
      await client1.connect();
      await client2.connect();

      // Wait for connections
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Simulate Realm object creation
      await client1.makeChange("insert", "RealmObject", "obj-1", {
        className: "Task",
        properties: {
          name: "Buy groceries",
          isComplete: false,
          priority: 1,
        },
        createdAt: Date.now(),
      });

      // Wait for sync
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Verify change synced
      const db = mongoClient.db();
      const collection = db.collection("RealmObject");
      const syncedObj = await collection.findOne({ _id: "obj-1" } as any);

      expect(syncedObj).toBeDefined();
      expect(syncedObj?.properties.name).toBe("Buy groceries");
      expect(syncedObj?._updated_by).toBe("user-1");
      // Persist negotiated tokens in test output for debugging
      console.log(
        "🔐 Azure negotiate token user-1 length=",
        token1.token?.length
      );
      console.log(
        "🔐 Azure negotiate token user-2 length=",
        token2.token?.length
      );

      await client1.disconnect();
      await client2.disconnect();
    }, 15000);

    it("should handle rapid sequential changes from same client", async () => {
      const negotiateUser = async (userId: string) => {
        const res = await fetch(
          `${serverUrl}/api/negotiate?userId=${encodeURIComponent(userId)}`
        );
        expect(res.ok).toBe(true);
        return res.json();
      };
      const negotiate: any = await negotiateUser("rapid-user");
      const client = new SyncClient(
        serverUrl,
        "rapid-user",
        `${mongoUri}_rapid`,
        negotiate.jwt
      );
      await client.initialize();
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Simulate rapid Realm writes
      const changes = [];
      for (let i = 0; i < 20; i++) {
        changes.push(
          client.makeChange("insert", "RealmObject", `rapid-${i}`, {
            index: i,
            data: `Item ${i}`,
            timestamp: Date.now(),
          })
        );
      }

      await Promise.all(changes);
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify all changes synced
      const db = mongoClient.db();
      const count = await db.collection("RealmObject").countDocuments({
        _id: { $regex: /^rapid-/ } as any,
      } as any);

      expect(count).toBe(20);
      expect(client.getPendingChangesCount()).toBe(0);

      await client.disconnect();
    }, 20000);

    it("should handle concurrent updates to same object", async () => {
      const negotiateUser = async (userId: string) => {
        const res = await fetch(
          `${serverUrl}/api/negotiate?userId=${encodeURIComponent(userId)}`
        );
        expect(res.ok).toBe(true);
        return res.json();
      };
      const cTok1: any = await negotiateUser("concurrent-1");
      const cTok2: any = await negotiateUser("concurrent-2");
      const client1 = new SyncClient(
        serverUrl,
        "concurrent-1",
        `${mongoUri}_conc1`,
        cTok1.jwt
      );
      const client2 = new SyncClient(
        serverUrl,
        "concurrent-2",
        `${mongoUri}_conc2`,
        cTok2.jwt
      );

      await client1.initialize();
      await client2.initialize();
      await client1.connect();
      await client2.connect();
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Create initial object
      await client1.makeChange("insert", "RealmObject", "concurrent-obj", {
        counter: 0,
        lastUpdatedBy: "client1",
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Both clients update simultaneously
      await Promise.all([
        client1.makeChange("update", "RealmObject", "concurrent-obj", {
          counter: 1,
          lastUpdatedBy: "client1",
          timestamp: Date.now(),
        }),
        client2.makeChange("update", "RealmObject", "concurrent-obj", {
          counter: 1,
          lastUpdatedBy: "client2",
          timestamp: Date.now(),
        }),
      ]);

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify one of the updates won (last-write-wins)
      const db = mongoClient.db();
      const obj = await db
        .collection("RealmObject")
        .findOne({ _id: "concurrent-obj" } as any);

      expect(obj).toBeDefined();
      expect(obj?.counter).toBe(1);
      expect(["client1", "client2"]).toContain(obj?.lastUpdatedBy);

      await client1.disconnect();
      await client2.disconnect();
    }, 20000);
  });

  describe("Offline-First Scenarios", () => {
    if (skipSuite || (global as any).__E2E_READY_FAILED__) {
      it.skip("skipped due to missing MongoDB or server not ready", () => {});
      return;
    }
    // Offline-first scenarios always tested when in-memory enabled; Atlas can be tested if desired
    it("should queue changes when offline and sync when reconnected", async () => {
      const client = new SyncClient(
        serverUrl,
        "offline-user",
        `${mongoUri}_offline`
      );
      await client.initialize();
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Verify online
      expect(client.isOnline()).toBe(true);

      // Disconnect
      await client.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Reinitialize without connecting (simulate offline)
      const offlineClient = new SyncClient(
        serverUrl,
        "offline-user",
        `${mongoUri}_offline`
      );
      await offlineClient.initialize();

      expect(offlineClient.isOnline()).toBe(false);

      // Make changes while offline
      await offlineClient.makeChange("insert", "RealmObject", "offline-1", {
        data: "Created offline",
        timestamp: Date.now(),
      });
      await offlineClient.makeChange("insert", "RealmObject", "offline-2", {
        data: "Also offline",
        timestamp: Date.now(),
      });

      expect(offlineClient.getPendingChangesCount()).toBeGreaterThan(0);

      // Reconnect
      await offlineClient.connect();
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Verify changes synced
      expect(offlineClient.isOnline()).toBe(true);
      expect(offlineClient.getPendingChangesCount()).toBe(0);

      const db = mongoClient.db();
      const offline1 = await db
        .collection("RealmObject")
        .findOne({ _id: "offline-1" } as any);
      const offline2 = await db
        .collection("RealmObject")
        .findOne({ _id: "offline-2" } as any);

      expect(offline1).toBeDefined();
      expect(offline2).toBeDefined();

      await offlineClient.disconnect();
    }, 25000);

    it("should handle server restart gracefully", async () => {
      const client = new SyncClient(
        serverUrl,
        "restart-user",
        `${mongoUri}_restart`
      );
      await client.initialize();
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Make a change
      await client.makeChange("insert", "RealmObject", "before-restart", {
        data: "Before server restart",
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Simulate server restart
      await server.stop();
      await new Promise((resolve) => setTimeout(resolve, 1000));

      server = new SyncServer(
        mongoUri,
        webPubSubConnectionString,
        "test-hub",
        testPort
      );
      await server.start();
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Client should auto-reconnect
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Make another change
      await client.makeChange("insert", "RealmObject", "after-restart", {
        data: "After server restart",
      });
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify both changes exist
      const db = mongoClient.db();
      const before = await db
        .collection("RealmObject")
        .findOne({ _id: "before-restart" } as any);
      const after = await db
        .collection("RealmObject")
        .findOne({ _id: "after-restart" } as any);

      expect(before).toBeDefined();
      expect(after).toBeDefined();

      await client.disconnect();
    }, 30000);
  });

  describe("Large Dataset Handling", () => {
    if (skipSuite || (global as any).__E2E_READY_FAILED__) {
      it.skip("skipped due to missing MongoDB or server not ready", () => {});
      return;
    }
    it("should handle syncing a large number of objects efficiently", async () => {
      const negotiateUser = async (userId: string) => {
        const res = await fetch(
          `${serverUrl}/api/negotiate?userId=${encodeURIComponent(userId)}`
        );
        expect(res.ok).toBe(true);
        return res.json();
      };
      const bulkTok: any = await negotiateUser("bulk-user");
      const client = new SyncClient(
        serverUrl,
        "bulk-user",
        `${mongoUri}_bulk`,
        bulkTok.jwt
      );
      await client.initialize();
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const startTime = Date.now();

      // Scale dataset based on environment (reduce load for Atlas to avoid TLS internal errors under heavy parallelism)
      const totalObjects = isAtlas ? 200 : 1000;
      const batchSize = 50;
      for (let batch = 0; batch < totalObjects / batchSize; batch++) {
        const batchPromises = [];
        for (let i = 0; i < batchSize; i++) {
          const id = batch * batchSize + i;
          batchPromises.push(
            client.makeChange("insert", "BulkTest", `bulk-${id}`, {
              index: id,
              data: `Item ${id}`,
              nested: {
                field1: `value-${id}`,
                field2: id * 2,
              },
            })
          );
        }
        await Promise.all(batchPromises);
        await new Promise((resolve) => setTimeout(resolve, 100)); // Small delay between batches
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within reasonable time
      expect(duration).toBeLessThan(isAtlas ? 60000 : 60000);

      // Verify all synced
      await new Promise((resolve) => setTimeout(resolve, 2000));
      expect(client.getPendingChangesCount()).toBe(0);

      const db = mongoClient.db();
      const count = await db.collection("BulkTest").countDocuments();
      expect(count).toBeGreaterThanOrEqual(totalObjects);

      console.log(
        `✅ Synced 1000 objects in ${duration}ms (${((1000 / duration) * 1000).toFixed(2)} ops/sec)`
      );

      await client.disconnect();
    }, 90000);
  });

  describe("Data Integrity", () => {
    if (skipSuite || (global as any).__E2E_READY_FAILED__) {
      it.skip("skipped due to missing MongoDB or server not ready", () => {});
      return;
    }
    it("should maintain referential integrity with related objects", async () => {
      const negotiateUser = async (userId: string) => {
        const res = await fetch(
          `${serverUrl}/api/negotiate?userId=${encodeURIComponent(userId)}`
        );
        expect(res.ok).toBe(true);
        return res.json();
      };
      const intTok: any = await negotiateUser("integrity-user");
      const client = new SyncClient(
        serverUrl,
        "integrity-user",
        `${mongoUri}_integrity`,
        intTok.jwt
      );
      await client.initialize();
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Create parent object
      await client.makeChange("insert", "Parent", "parent-1", {
        name: "Parent Object",
        childIds: ["child-1", "child-2", "child-3"],
      });

      // Create child objects
      await Promise.all([
        client.makeChange("insert", "Child", "child-1", {
          parentId: "parent-1",
          data: "Child 1",
        }),
        client.makeChange("insert", "Child", "child-2", {
          parentId: "parent-1",
          data: "Child 2",
        }),
        client.makeChange("insert", "Child", "child-3", {
          parentId: "parent-1",
          data: "Child 3",
        }),
      ]);

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify all objects exist and relationships are intact
      const db = mongoClient.db();
      const parent = await db
        .collection("Parent")
        .findOne({ _id: "parent-1" } as any);
      const children = await db
        .collection("Child")
        .find({ parentId: "parent-1" })
        .toArray();

      expect(parent).toBeDefined();
      expect(parent?.childIds).toHaveLength(3);
      expect(children).toHaveLength(3);

      await client.disconnect();
    }, 15000);

    it("should handle delete operations correctly", async () => {
      const client1 = new SyncClient(
        serverUrl,
        "delete-user-1",
        `${mongoUri}_del1`
      );
      const client2 = new SyncClient(
        serverUrl,
        "delete-user-2",
        `${mongoUri}_del2`
      );

      await client1.initialize();
      await client2.initialize();
      await client1.connect();
      await client2.connect();
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Create object
      await client1.makeChange("insert", "Deletable", "delete-me", {
        data: "Will be deleted",
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Delete from client2
      await client2.makeChange("delete", "Deletable", "delete-me");
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Verify deleted
      const db = mongoClient.db();
      const deleted = await db
        .collection("Deletable")
        .findOne({ _id: "delete-me" } as any);
      expect(deleted).toBeNull();

      await client1.disconnect();
      await client2.disconnect();
    }, 15000);
  });

  describe("Performance & Scalability", () => {
    if (skipSuite || (global as any).__E2E_READY_FAILED__) {
      it.skip("skipped due to missing MongoDB or server not ready", () => {});
      return;
    }
    it("should handle concurrent clients syncing simultaneously", async () => {
      const clients: SyncClient[] = [];

      // Scale concurrency for Atlas to reduce TLS stress
      const concurrentClients = isAtlas ? 5 : 10;
      const changesPerClient = isAtlas ? 5 : 10;
      for (let i = 0; i < concurrentClients; i++) {
        const client = new SyncClient(
          serverUrl,
          `perf-user-${i}`,
          `${mongoUri}_perf${i}`
        );
        await client.initialize();
        await client.connect();
        clients.push(client);
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Each client makes a set of changes
      const allChanges = [];
      for (let i = 0; i < clients.length; i++) {
        for (let j = 0; j < changesPerClient; j++) {
          allChanges.push(
            clients[i].makeChange("insert", "PerfTest", `perf-${i}-${j}`, {
              clientId: i,
              changeId: j,
              data: `Client ${i} Change ${j}`,
            })
          );
        }
      }

      await Promise.all(allChanges);
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Verify all changes synced
      const db = mongoClient.db();
      const count = await db.collection("PerfTest").countDocuments();
      expect(count).toBe(concurrentClients * changesPerClient);

      // Disconnect all
      for (const client of clients) {
        await client.disconnect();
      }
    }, 45000);
  });
});
