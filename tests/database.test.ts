import * as dotenv from "dotenv";
dotenv.config();

import { Database } from "../server/database";

describe("Database", () => {
  let db: Database;
  const testMongoUri =
    process.env.TEST_MONGODB_URI ||
    process.env.MONGODB_URI ||
    "mongodb://localhost:27017/sync_test";

  beforeAll(async () => {
    db = new Database(testMongoUri);
    await db.connect();
  }, 20000); // Increase timeout for Atlas connection

  afterAll(async () => {
    await db.close();
  }, 10000);

  it("should connect successfully", () => {
    expect(db).toBeDefined();
  });

  it("should save and retrieve a change", async () => {
    const change = {
      id: "test-change-1",
      userId: "user-1",
      timestamp: Date.now(),
      operation: "insert" as const,
      collection: "test_collection",
      documentId: "doc-1",
      data: { name: "Test" },
      synced: true,
    };

    await db.saveChange(change);

    const changes = await db.getChangesSince("user-2", 0, 10);
    const savedChange = changes.find((c) => c.id === change.id);

    expect(savedChange).toBeDefined();
    expect(savedChange?.operation).toBe("insert");
  });

  it("should not return own changes", async () => {
    const userId = "user-own-test";
    const change = {
      id: "own-change-1",
      userId,
      timestamp: Date.now(),
      operation: "insert" as const,
      collection: "test_collection",
      documentId: "doc-own",
      data: { name: "Own" },
      synced: true,
    };

    await db.saveChange(change);

    // Request changes as the same user
    const changes = await db.getChangesSince(userId, 0, 10);
    const ownChange = changes.find((c) => c.id === change.id);

    expect(ownChange).toBeUndefined();
  });

  it("should get database stats", async () => {
    const stats = await db.getStats();

    expect(stats).toHaveProperty("totalChanges");
    expect(stats).toHaveProperty("syncedChanges");
    expect(stats).toHaveProperty("pendingChanges");
    expect(typeof stats.totalChanges).toBe("number");
  });
});
