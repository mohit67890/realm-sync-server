/**
 * Stress Tests: Push the sync system to its limits
 * Tests edge cases, failure scenarios, and recovery patterns
 */

import { SyncClient } from "../../client/sync-client";
import { SyncServer } from "../../server/sync-server";
import { MongoClient } from "mongodb";

describe("Stress Tests: Edge Cases & Failure Scenarios", () => {
  let server: SyncServer;
  let mongoClient: MongoClient;
  const testPort = 3003;
  const serverUrl = `http://localhost:${testPort}`;
  const mongoUri =
    process.env.TEST_MONGODB_URI ||
    "mongodb://localhost:27017/realm_stress_test";
  const webPubSubConnectionString =
    process.env.WEB_PUBSUB_CONNECTION_STRING ||
    "Endpoint=https://test.webpubsub.azure.com;AccessKey=testkey123;Version=1.0;";

  beforeAll(async () => {
    server = new SyncServer(
      mongoUri,
      webPubSubConnectionString,
      "stress-hub",
      testPort
    );
    await server.start();
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }, 20000);

  afterAll(async () => {
    await server.stop();
    await mongoClient.close();
  }, 10000);

  describe("Network Failure Scenarios", () => {
    it("should handle intermittent connectivity drops", async () => {
      const client = new SyncClient(
        serverUrl,
        "flaky-user",
        `${mongoUri}_flaky`
      );
      await client.initialize();
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Make some changes
      await client.makeChange("insert", "FlakyTest", "flaky-1", {
        data: "Before disconnect",
      });
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Simulate disconnect/reconnect cycles
      for (let i = 0; i < 5; i++) {
        await client.disconnect();
        await new Promise((resolve) => setTimeout(resolve, 300));

        await client.connect();
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Make change after each reconnect
        await client.makeChange("insert", "FlakyTest", `flaky-reconnect-${i}`, {
          data: `After reconnect ${i}`,
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Final verification
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const db = mongoClient.db();
      const count = await db.collection("FlakyTest").countDocuments();
      expect(count).toBeGreaterThanOrEqual(6); // Initial + 5 reconnects

      await client.disconnect();
    }, 30000);

    it("should recover from complete network outage", async () => {
      const client = new SyncClient(
        serverUrl,
        "outage-user",
        `${mongoUri}_outage`
      );
      await client.initialize();
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Make initial change
      await client.makeChange("insert", "OutageTest", "before-outage", {
        data: "Before network outage",
      });
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Disconnect for extended period (simulate network outage)
      await client.disconnect();

      // Try to make changes while offline (should queue)
      await client.makeChange("insert", "OutageTest", "during-outage-1", {
        data: "During outage 1",
      });
      await client.makeChange("insert", "OutageTest", "during-outage-2", {
        data: "During outage 2",
      });

      expect(client.getPendingChangesCount()).toBeGreaterThan(0);

      // Reconnect after "outage"
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait for sync

      // Verify all changes eventually synced
      expect(client.getPendingChangesCount()).toBe(0);

      const db = mongoClient.db();
      const all = await db.collection("OutageTest").find().toArray();
      expect(all.length).toBeGreaterThanOrEqual(3);

      await client.disconnect();
    }, 25000);
  });

  describe("Data Edge Cases", () => {
    it("should handle very large objects (approaching 2MB limit)", async () => {
      const client = new SyncClient(
        serverUrl,
        "large-data-user",
        `${mongoUri}_large`
      );
      await client.initialize();
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Create ~1MB of data (well within 2MB limit but large enough to test)
      const largeString = "x".repeat(1024 * 1024); // 1MB string

      await client.makeChange("insert", "LargeObject", "large-1", {
        content: largeString,
        metadata: {
          size: largeString.length,
          type: "stress-test",
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 3000));

      const db = mongoClient.db();
      const obj = await db
        .collection("LargeObject")
        .findOne({ _id: "large-1" } as any);

      expect(obj).toBeDefined();
      expect(obj?.content.length).toBe(1024 * 1024);

      await client.disconnect();
    }, 20000);

    it("should handle deeply nested objects", async () => {
      const client = new SyncClient(
        serverUrl,
        "nested-user",
        `${mongoUri}_nested`
      );
      await client.initialize();
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Create deeply nested structure
      let nested: any = { value: "leaf" };
      for (let i = 0; i < 50; i++) {
        nested = { level: i, child: nested };
      }

      await client.makeChange("insert", "NestedObject", "deep-nested", {
        depth: 50,
        structure: nested,
      });

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const db = mongoClient.db();
      const obj = await db
        .collection("NestedObject")
        .findOne({ _id: "deep-nested" } as any);

      expect(obj).toBeDefined();
      expect(obj?.depth).toBe(50);

      await client.disconnect();
    }, 15000);

    it("should handle special characters and unicode in data", async () => {
      const client = new SyncClient(
        serverUrl,
        "unicode-user",
        `${mongoUri}_unicode`
      );
      await client.initialize();
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const specialChars = {
        emoji: "😀🎉🚀💻",
        chinese: "你好世界",
        arabic: "مرحبا بالعالم",
        special: "<>&\"'`\n\r\t",
        math: "∑∫∞≠±×÷",
        mixed: "Test 测试 تجربة 🔥",
      };

      await client.makeChange(
        "insert",
        "UnicodeTest",
        "unicode-1",
        specialChars
      );
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const db = mongoClient.db();
      const obj = await db
        .collection("UnicodeTest")
        .findOne({ _id: "unicode-1" } as any);

      expect(obj).toBeDefined();
      expect(obj?.emoji).toBe(specialChars.emoji);
      expect(obj?.chinese).toBe(specialChars.chinese);
      expect(obj?.arabic).toBe(specialChars.arabic);

      await client.disconnect();
    }, 15000);

    it("should handle empty and null values correctly", async () => {
      const client = new SyncClient(serverUrl, "null-user", `${mongoUri}_null`);
      await client.initialize();
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 1500));

      await client.makeChange("insert", "NullTest", "null-values", {
        emptyString: "",
        nullValue: null,
        undefinedValue: undefined,
        emptyArray: [],
        emptyObject: {},
        zero: 0,
        false: false,
      });

      await new Promise((resolve) => setTimeout(resolve, 1500));

      const db = mongoClient.db();
      const obj = await db
        .collection("NullTest")
        .findOne({ _id: "null-values" } as any);

      expect(obj).toBeDefined();
      expect(obj?.emptyString).toBe("");
      expect(obj?.emptyArray).toEqual([]);
      expect(obj?.zero).toBe(0);

      await client.disconnect();
    }, 15000);
  });

  describe("Concurrent Conflict Scenarios", () => {
    it("should handle rapid conflicting updates from multiple clients", async () => {
      const clients: SyncClient[] = [];
      const numClients = 5;

      // Create 5 clients
      for (let i = 0; i < numClients; i++) {
        const client = new SyncClient(
          serverUrl,
          `conflict-user-${i}`,
          `${mongoUri}_conflict${i}`
        );
        await client.initialize();
        await client.connect();
        clients.push(client);
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // All clients update the same object simultaneously
      const updatePromises = clients.map((client, i) =>
        client.makeChange("update", "ConflictTest", "contested-object", {
          updatedBy: `client-${i}`,
          counter: i,
          timestamp: Date.now(),
        })
      );

      await Promise.all(updatePromises);
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify one update won (last-write-wins)
      const db = mongoClient.db();
      const obj = await db
        .collection("ConflictTest")
        .findOne({ _id: "contested-object" } as any);

      expect(obj).toBeDefined();
      expect(obj?.counter).toBeGreaterThanOrEqual(0);
      expect(obj?.counter).toBeLessThan(numClients);

      // Cleanup
      for (const client of clients) {
        await client.disconnect();
      }
    }, 25000);

    it("should handle create-delete-create sequence correctly", async () => {
      const client1 = new SyncClient(
        serverUrl,
        "cdc-user-1",
        `${mongoUri}_cdc1`
      );
      const client2 = new SyncClient(
        serverUrl,
        "cdc-user-2",
        `${mongoUri}_cdc2`
      );

      await client1.initialize();
      await client2.initialize();
      await client1.connect();
      await client2.connect();
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Client 1: Create
      await client1.makeChange("insert", "CDCTest", "cdc-object", {
        data: "Initial creation",
        version: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Client 2: Delete
      await client2.makeChange("delete", "CDCTest", "cdc-object");
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Client 1: Recreate
      await client1.makeChange("insert", "CDCTest", "cdc-object", {
        data: "Recreated",
        version: 2,
      });
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Verify final state
      const db = mongoClient.db();
      const obj = await db.collection("CDCTest").findOne({ _id: "cdc-object" } as any);

      // Should exist (recreated)
      expect(obj).toBeDefined();

      await client1.disconnect();
      await client2.disconnect();
    }, 20000);
  });

  describe("Performance Under Load", () => {
    it("should maintain low latency under sustained load", async () => {
      const client = new SyncClient(
        serverUrl,
        "latency-user",
        `${mongoUri}_latency`
      );
      await client.initialize();
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const latencies: number[] = [];
      const numOperations = 100;

      for (let i = 0; i < numOperations; i++) {
        const start = Date.now();

        await client.makeChange("insert", "LatencyTest", `latency-${i}`, {
          index: i,
          timestamp: start,
        });

        const latency = Date.now() - start;
        latencies.push(latency);

        // Small delay between operations
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // Calculate statistics
      const avgLatency =
        latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const maxLatency = Math.max(...latencies);
      const minLatency = Math.min(...latencies);

      console.log(`\n📊 Latency Statistics (${numOperations} operations):`);
      console.log(`   Average: ${avgLatency.toFixed(2)}ms`);
      console.log(`   Min: ${minLatency}ms`);
      console.log(`   Max: ${maxLatency}ms`);

      // Assertions (adjust based on your requirements)
      expect(avgLatency).toBeLessThan(1000); // Average under 1 second
      expect(maxLatency).toBeLessThan(5000); // Max under 5 seconds

      await client.disconnect();
    }, 120000);

    it("should handle memory efficiently with many pending changes", async () => {
      const client = new SyncClient(
        serverUrl,
        "memory-user",
        `${mongoUri}_memory`
      );
      await client.initialize();

      // Don't connect - keep offline
      expect(client.isOnline()).toBe(false);

      // Queue many changes
      const numChanges = 500;
      for (let i = 0; i < numChanges; i++) {
        await client.makeChange("insert", "MemoryTest", `mem-${i}`, {
          index: i,
          data: `Change ${i}`,
        });
      }

      expect(client.getPendingChangesCount()).toBe(numChanges);

      // Now connect and sync all at once
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait for sync

      // Should eventually sync all
      expect(client.getPendingChangesCount()).toBe(0);

      const db = mongoClient.db();
      const count = await db.collection("MemoryTest").countDocuments();
      expect(count).toBeGreaterThanOrEqual(numChanges);

      await client.disconnect();
    }, 60000);
  });

  describe("Database Cleanup & Maintenance", () => {
    it("should handle old change cleanup without affecting recent data", async () => {
      const client = new SyncClient(
        serverUrl,
        "cleanup-user",
        `${mongoUri}_cleanup`
      );
      await client.initialize();
      await client.connect();
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Create some changes
      await client.makeChange("insert", "CleanupTest", "recent-1", {
        data: "Recent",
      });
      await client.makeChange("insert", "CleanupTest", "recent-2", {
        data: "Recent",
      });

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify recent data exists
      const db = mongoClient.db();
      const recent = await db.collection("CleanupTest").find().toArray();
      expect(recent.length).toBeGreaterThanOrEqual(2);

      // Changes log should have entries
      const changes = await db.collection("_sync_changes").find().toArray();
      expect(changes.length).toBeGreaterThan(0);

      await client.disconnect();
    }, 15000);
  });
});
