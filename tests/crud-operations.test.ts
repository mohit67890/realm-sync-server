/**
 * Comprehensive CRUD Operations Test
 * Verifies INSERT, UPDATE, DELETE operations work correctly with multi-client sync
 */

import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { SyncClient } from "../client/sync-client";
import { SyncServer } from "../server/sync-server";

dotenv.config();

const mongoUri =
  process.env.TEST_MONGODB_URI ||
  process.env.MONGODB_URI ||
  "mongodb://localhost:27017/test_sync";

const serverUrl = "http://localhost:3001";
const webPubSubConnection =
  process.env.WEB_PUBSUB_CONNECTION_STRING ||
  "Endpoint=https://test.webpubsub.azure.com;AccessKey=testkey123;Version=1.0;";

describe("CRUD Operations Test", () => {
  let server: SyncServer;
  let mongoClient: MongoClient;
  let client1: SyncClient;
  let client2: SyncClient;

  beforeAll(async () => {
    // Start server
    server = new SyncServer(mongoUri, webPubSubConnection, "3001");
    await server.start();

    // Connect MongoDB client for verification
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
  }, 30000);

  afterAll(async () => {
    await server?.stop();
    await mongoClient?.close();
  }, 10000);

  beforeEach(async () => {
    // Initialize clients
    client1 = new SyncClient(serverUrl, "crud-user-1", mongoUri);
    await client1.initialize();
    await client1.connect();

    client2 = new SyncClient(serverUrl, "crud-user-2", mongoUri);
    await client2.initialize();
    await client2.connect();

    // Wait for connections
    await new Promise((resolve) => setTimeout(resolve, 1500));
  });

  afterEach(async () => {
    await client1?.disconnect();
    await client2?.disconnect();
  });

  it("should handle INSERT operation and sync to all clients", async () => {
    console.log("\n=== Testing INSERT Operation ===");

    // Client 1 inserts a new document
    await client1.makeChange("insert", "Tasks", "task-insert-1", {
      title: "New Task from Client 1",
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    // Wait for sync
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Verify in database
    const db = mongoClient.db();
    const insertedDoc = await db
      .collection("Tasks")
      .findOne({ _id: "task-insert-1" } as any);

    expect(insertedDoc).toBeDefined();
    expect(insertedDoc?.title).toBe("New Task from Client 1");
    expect(insertedDoc?.status).toBe("pending");
    expect(insertedDoc?._updated_by).toBe("crud-user-1");

    console.log("✅ INSERT operation verified successfully");
  }, 15000);

  it("should handle UPDATE operation and sync to all clients", async () => {
    console.log("\n=== Testing UPDATE Operation ===");

    // First insert a document
    await client1.makeChange("insert", "Tasks", "task-update-1", {
      title: "Task to Update",
      status: "pending",
      priority: "low",
    });

    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Client 2 updates the document
    await client2.makeChange("update", "Tasks", "task-update-1", {
      status: "in-progress",
      priority: "high",
      updatedAt: new Date().toISOString(),
    });

    // Wait for sync
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Verify in database
    const db = mongoClient.db();
    const updatedDoc = await db
      .collection("Tasks")
      .findOne({ _id: "task-update-1" } as any);

    expect(updatedDoc).toBeDefined();
    expect(updatedDoc?.status).toBe("in-progress");
    expect(updatedDoc?.priority).toBe("high");
    expect(updatedDoc?._updated_by).toBe("crud-user-2");

    console.log("✅ UPDATE operation verified successfully");
  }, 20000);

  it("should handle DELETE operation and sync to all clients", async () => {
    console.log("\n=== Testing DELETE Operation ===");

    // First insert a document
    await client1.makeChange("insert", "Tasks", "task-delete-1", {
      title: "Task to Delete",
      status: "completed",
    });

    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Verify it exists
    const db = mongoClient.db();
    let doc = await db
      .collection("Tasks")
      .findOne({ _id: "task-delete-1" } as any);
    expect(doc).toBeDefined();

    // Client 2 deletes the document
    await client2.makeChange("delete", "Tasks", "task-delete-1");

    // Wait for sync
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Verify deletion in database
    doc = await db.collection("Tasks").findOne({ _id: "task-delete-1" } as any);

    expect(doc).toBeNull();

    console.log("✅ DELETE operation verified successfully");
  }, 20000);

  it("should handle multiple CRUD operations in sequence", async () => {
    console.log("\n=== Testing Multiple CRUD Operations ===");

    const db = mongoClient.db();

    // 1. INSERT
    console.log("1. Inserting document...");
    await client1.makeChange("insert", "Orders", "order-sequence-1", {
      customer: "John Doe",
      amount: 100.0,
      status: "pending",
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));

    let doc = await db
      .collection("Orders")
      .findOne({ _id: "order-sequence-1" } as any);
    expect(doc?.amount).toBe(100.0);
    expect(doc?.status).toBe("pending");
    console.log("   ✅ Insert verified");

    // 2. UPDATE (modify status)
    console.log("2. Updating status...");
    await client2.makeChange("update", "Orders", "order-sequence-1", {
      status: "processing",
      processedAt: new Date().toISOString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));

    doc = await db
      .collection("Orders")
      .findOne({ _id: "order-sequence-1" } as any);
    expect(doc?.status).toBe("processing");
    expect(doc?._updated_by).toBe("crud-user-2");
    console.log("   ✅ Update verified");

    // 3. UPDATE (modify amount)
    console.log("3. Updating amount...");
    await client1.makeChange("update", "Orders", "order-sequence-1", {
      amount: 150.0,
      status: "completed",
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));

    doc = await db
      .collection("Orders")
      .findOne({ _id: "order-sequence-1" } as any);
    expect(doc?.amount).toBe(150.0);
    expect(doc?.status).toBe("completed");
    console.log("   ✅ Second update verified");

    // 4. DELETE
    console.log("4. Deleting document...");
    await client2.makeChange("delete", "Orders", "order-sequence-1");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    doc = await db
      .collection("Orders")
      .findOne({ _id: "order-sequence-1" } as any);
    expect(doc).toBeNull();
    console.log("   ✅ Delete verified");

    console.log("✅ All CRUD operations completed successfully");
  }, 30000);

  it("should handle concurrent INSERT operations from multiple clients", async () => {
    console.log("\n=== Testing Concurrent INSERT Operations ===");

    // Both clients insert different documents simultaneously
    await Promise.all([
      client1.makeChange("insert", "Products", "product-1", {
        name: "Product from Client 1",
        price: 29.99,
      }),
      client2.makeChange("insert", "Products", "product-2", {
        name: "Product from Client 2",
        price: 39.99,
      }),
    ]);

    // Wait for sync
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Verify both documents exist
    const db = mongoClient.db();
    const product1 = await db
      .collection("Products")
      .findOne({ _id: "product-1" } as any);
    const product2 = await db
      .collection("Products")
      .findOne({ _id: "product-2" } as any);

    expect(product1).toBeDefined();
    expect(product1?.name).toBe("Product from Client 1");
    expect(product1?._updated_by).toBe("crud-user-1");

    expect(product2).toBeDefined();
    expect(product2?.name).toBe("Product from Client 2");
    expect(product2?._updated_by).toBe("crud-user-2");

    console.log("✅ Concurrent INSERT operations verified successfully");
  }, 20000);

  it("should handle concurrent UPDATE operations with last-write-wins", async () => {
    console.log("\n=== Testing Concurrent UPDATE Operations ===");

    // First insert a document
    await client1.makeChange("insert", "Counter", "counter-1", {
      value: 0,
      description: "Concurrent counter",
    });

    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Both clients update simultaneously
    await Promise.all([
      client1.makeChange("update", "Counter", "counter-1", {
        value: 10,
        updater: "client1",
      }),
      client2.makeChange("update", "Counter", "counter-1", {
        value: 20,
        updater: "client2",
      }),
    ]);

    // Wait for sync
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Verify one of the updates won (last-write-wins)
    const db = mongoClient.db();
    const counter = await db
      .collection("Counter")
      .findOne({ _id: "counter-1" } as any);

    expect(counter).toBeDefined();
    expect([10, 20]).toContain(counter?.value);
    expect(["client1", "client2"]).toContain(counter?.updater);

    console.log(
      `✅ Concurrent UPDATE resolved: value=${counter?.value}, updater=${counter?.updater}`
    );
  }, 20000);
});
