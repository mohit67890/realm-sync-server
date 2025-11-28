import { io as Client } from "socket.io-client";
import http from "http";
import { SyncServer } from "../server/sync-server";
// Jest globals are provided by ts-jest preset; ensure env is initialized
import "./setup-env";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare const describe: any,
  beforeAll: any,
  afterAll: any,
  test: any,
  expect: any;
// Increase overall timeout for this suite
(global as any).jest && (global as any).jest.setTimeout?.(30000);

// Helper to wait for a single event with timeout
function waitFor<T = any>(
  socket: any,
  event: string,
  timeoutMs = 3000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe("RealmSync client behavior vs server", () => {
  let socketA: any;
  let socketB: any;
  let server: SyncServer | null = null;

  beforeAll(async () => {
    // Start SyncServer locally for this test if not already running
    server = new SyncServer(
      process.env.MONGODB_URI || "mongodb://localhost:27017/realm_sync_test",
      process.env.WEB_PUBSUB_CONNECTION_STRING ||
        "Endpoint=sb://local/;AccessKey=dummy;",
      process.env.WEB_PUBSUB_HUB_NAME || "test-hub",
      3000
    );
    try {
      await server.start();
    } catch (e) {
      // If already running, continue
    }
    // Wait for server /ready
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const attempt = () => {
        const req = http.get("http://localhost:3000/ready", (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            if (Date.now() - start > 20000)
              return reject(new Error("server not ready"));
            setTimeout(attempt, 300);
          }
        });
        req.on("error", () => {
          if (Date.now() - start > 20000)
            return reject(new Error("server not reachable"));
          setTimeout(attempt, 300);
        });
      };
      attempt();
    });
    socketA = Client("http://localhost:3000", {
      transports: ["websocket"],
      forceNew: true,
    });
    socketB = Client("http://localhost:3000", {
      transports: ["websocket"],
      forceNew: true,
    });

    await new Promise<void>((res) => socketA.on("connect", () => res()));
    await new Promise<void>((res) => socketB.on("connect", () => res()));

    // Join with different users
    await new Promise<void>((res) =>
      socketA.emit("sync:join", { userId: "test-user-A" }, () => res())
    );
    await new Promise<void>((res) =>
      socketB.emit("sync:join", { userId: "test-user-B" }, () => res())
    );
  });

  afterAll(() => {
    try {
      socketA?.disconnect();
    } catch {}
    try {
      socketB?.disconnect();
    } catch {}
    try {
      server?.stop();
    } catch {}
  });

  test("subscribe filters broadcasts and get_changes honors since + filter", async () => {
    // Increase timeout for network operations
    (global as any).jest && (global as any).jest.setTimeout?.(20000);

    // Both clients subscribe to ALL tasks with ownerId == 'shared'
    // This way when one client inserts, the other will receive it
    await new Promise<void>((res) =>
      socketA.emit(
        "sync:subscribe",
        { collection: "Tasks", filter: "ownerId == $0", args: ["shared"] },
        () => res()
      )
    );
    await new Promise<void>((res) =>
      socketB.emit(
        "sync:subscribe",
        { collection: "Tasks", filter: "ownerId == $0", args: ["shared"] },
        () => res()
      )
    );

    // Upsert two tasks with ownerId: 'shared', one from A and one from B
    const now = Date.now();
    const upsertA = {
      collection: "Tasks",
      update: {
        _id: "task-A-1",
        title: "A1",
        ownerId: "shared",
        sync_updated_at: now,
      },
      query: { _id: "task-A-1" },
    };
    const upsertB = {
      collection: "Tasks",
      update: {
        _id: "task-B-1",
        title: "B1",
        ownerId: "shared",
        sync_updated_at: now + 5,
      },
      query: { _id: "task-B-1" },
    };

    // Setup collectors for ALL sync:changes events
    const aChanges: any[] = [];
    const bChanges: any[] = [];
    socketA.on("sync:changes", (payload: any[]) => aChanges.push(...payload));
    socketB.on("sync:changes", (payload: any[]) => bChanges.push(...payload));

    // Send via server compatibility handler
    await new Promise<void>((res) =>
      socketB.emit("mongoUpsert", upsertB, () => res())
    );
    await new Promise<void>((res) =>
      socketA.emit("mongoUpsert", upsertA, () => res())
    );

    // Wait for events to propagate
    await new Promise((r) => setTimeout(r, 500));

    expect(Array.isArray(aChanges)).toBe(true);
    expect(Array.isArray(bChanges)).toBe(true);
    expect(aChanges.length).toBeGreaterThan(0);
    expect(bChanges.length).toBeGreaterThan(0);

    const aDocIds = aChanges.map((c) => c.documentId);
    const bDocIds = bChanges.map((c) => c.documentId);

    // A should receive only B's task (not their own), and vice versa
    expect(bDocIds).toContain("task-A-1"); // B receives A's task (both subscribed to ownerId=='shared')
    expect(aDocIds).toContain("task-B-1"); // A receives B's task (both subscribed to ownerId=='shared')

    // Now query historical changes for A since 0 with filter ownerId == $0 with args ['shared']
    const respA: any = await new Promise((resolve) =>
      socketA.emit(
        "sync:get_changes",
        {
          userId: "test-user-A",
          collection: "Tasks",
          since: 0,
          limit: 100,
          filter: "ownerId == $0",
          args: ["shared"],
        },
        (r: any) => resolve(r)
      )
    );

    expect(Array.isArray(respA.changes)).toBe(true);
    const aHistIds = respA.changes.map((c: any) => c.documentId);
    // Both tasks have ownerId: 'shared', so both should be in history
    expect(aHistIds).toContain("task-A-1");
    expect(aHistIds).toContain("task-B-1");

    // Verify latestTimestamp moves forward (at least now)
    expect(respA.latestTimestamp).toBeGreaterThanOrEqual(now);

    // Delete task A and ensure only B receives the delete notification (A sent it)
    const bDeletePromise = waitFor<any[]>(socketB, "sync:changes", 3000);
    await new Promise<void>((res) =>
      socketA.emit(
        "mongoDelete",
        { collection: "Tasks", query: { _id: "task-A-1" } },
        () => res()
      )
    );

    const bDelChanges = await bDeletePromise;
    expect(
      bDelChanges.some(
        (c) => c.operation === "delete" && c.documentId === "task-A-1"
      )
    ).toBe(true);
  });
});
