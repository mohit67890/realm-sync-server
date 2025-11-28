/**
 * Real-Life Sync Test Server with MongoDB Atlas Integration
 *
 * This server simulates a production-like sync environment with:
 * - Full MongoDB Atlas integration
 * - Realistic Realm model collections (Users, Tasks, Notes)
 * - Last-write-wins conflict resolution
 * - Changeset tracking and replication
 * - Without JWT authentication (for testing purposes)
 */

import * as dotenv from "dotenv";
dotenv.config();

import { Server, Socket } from "socket.io";
import { createServer } from "http";
import { MongoClient, Db, Collection, ObjectId } from "mongodb";

// Define realistic Realm-like models
interface User {
  _id: string;
  name: string;
  email: string;
  age?: number;
  sync_updated_at: number;
  _updated_by: string;
}

interface Task {
  _id: string;
  title: string;
  description: string;
  completed: boolean;
  userId: string;
  priority?: "low" | "medium" | "high";
  sync_updated_at: number;
  _updated_by: string;
}

interface Note {
  _id: string;
  content: string;
  userId: string;
  tags?: string[];
  sync_updated_at: number;
  _updated_by: string;
}

interface Change {
  id: string;
  userId: string;
  timestamp: number;
  operation: "insert" | "update" | "delete";
  collection: string;
  documentId: string;
  data?: any;
  synced?: boolean;
}

interface ChangeAck {
  changeId: string;
  success: boolean;
  timestamp?: number;
  error?: string;
}

class RealSyncTestServer {
  private io: Server;
  private mongoClient: MongoClient;
  private db: Db | null = null;
  private changesCollection: Collection<Change> | null = null;
  private usersCollection: Collection<User> | null = null;
  private tasksCollection: Collection<Task> | null = null;
  private notesCollection: Collection<Note> | null = null;
  private activeConnections = new Map<string, Set<string>>(); // userId -> socketIds
  private httpServer: any;

  constructor(
    private mongoUri: string,
    private port: number = 3030
  ) {
    this.mongoClient = new MongoClient(mongoUri);
    this.httpServer = createServer();
    this.io = new Server(this.httpServer, {
      cors: { origin: "*" },
      transports: ["websocket", "polling"],
      pingTimeout: 60000,
      pingInterval: 25000,
    });
  }

  async start(): Promise<void> {
    // Connect to MongoDB
    await this.mongoClient.connect();
    this.db = this.mongoClient.db("realm_sync_test");

    // Initialize collections
    this.changesCollection = this.db.collection<Change>("_sync_changes");
    this.usersCollection = this.db.collection<User>("users");
    this.tasksCollection = this.db.collection<Task>("tasks");
    this.notesCollection = this.db.collection<Note>("notes");

    // Create indexes for efficient queries
    await this.changesCollection.createIndex({ timestamp: 1 });
    await this.changesCollection.createIndex({ userId: 1, timestamp: 1 });
    await this.changesCollection.createIndex({ collection: 1, documentId: 1 });
    await this.changesCollection.createIndex({ synced: 1 });

    // Create indexes for data collections
    await this.usersCollection.createIndex(
      { email: 1 },
      { unique: true, sparse: true }
    );
    await this.tasksCollection.createIndex({ userId: 1 });
    await this.tasksCollection.createIndex({ completed: 1 });
    await this.notesCollection.createIndex({ userId: 1 });

    console.log("✅ MongoDB connected and indexes created");

    this.setupSocketHandlers();

    this.httpServer.listen(this.port, () => {
      console.log("==========================================");
      console.log("✅ Real Sync Test Server Started");
      console.log(`🌐 Port: ${this.port}`);
      console.log(
        `🗄 MongoDB: ${this.mongoUri.replace(/(mongodb.*:\/\/)([^@]+@)?/, "$1***@")}`
      );
      console.log(`📊 Collections: users, tasks, notes`);
      console.log(`🔁 Features: Insert, Update, Delete, Conflict Resolution`);
      console.log("==========================================");
    });
  }

  private setupSocketHandlers(): void {
    this.io.on("connection", (socket: Socket) => {
      console.log(`🔌 Client connected: ${socket.id}`);

      // Simple join without authentication (for testing)
      socket.on("join", async (data: { userId: string }, callback?) => {
        try {
          const userId = data.userId;
          if (!userId) {
            if (callback)
              callback({ success: false, error: "userId required" });
            return;
          }

          await socket.join(`user:${userId}`);
          if (!this.activeConnections.has(userId)) {
            this.activeConnections.set(userId, new Set());
          }
          this.activeConnections.get(userId)!.add(socket.id);

          console.log(`✅ User ${userId} joined (socket: ${socket.id})`);
          if (callback) callback({ success: true, timestamp: Date.now() });
        } catch (error: any) {
          console.error("Error joining:", error);
          if (callback) callback({ success: false, error: String(error) });
        }
      });

      // Handle change event (insert, update, delete)
      socket.on("change", async (change: Change, callback?) => {
        try {
          const timestamp = Date.now();
          const changeRecord: Change = {
            ...change,
            timestamp,
            synced: false,
          };

          console.log(
            `📝 Processing ${change.operation} on ${change.collection}/${change.documentId}`
          );
          if (change.data) {
            console.log(
              `   Data:`,
              JSON.stringify(change.data).substring(0, 100)
            );
          }

          // Save to change log
          await this.changesCollection!.insertOne(changeRecord as any);

          // Apply change to actual collection with conflict detection
          const result = await this.applyChange(changeRecord);

          if (!result.applied && result.conflict) {
            // Conflict detected - reject
            console.warn(`⚠️ Conflict detected: ${result.conflict.reason}`);
            const ack: ChangeAck = {
              changeId: change.id,
              success: false,
              error: `conflict: ${result.conflict.reason}`,
              timestamp,
            };
            if (callback) callback(ack);
            return;
          }

          // Mark as synced
          await this.changesCollection!.updateOne(
            { id: changeRecord.id } as any,
            { $set: { synced: true } }
          );

          // Broadcast to other users
          for (const userId of this.activeConnections.keys()) {
            if (userId !== changeRecord.userId) {
              this.io.to(`user:${userId}`).emit("sync:changes", [changeRecord]);
            }
          }

          console.log(`✅ Change ${change.operation} applied successfully`);

          // Acknowledge to sender
          const ack: ChangeAck = {
            changeId: change.id,
            success: true,
            timestamp,
          };
          if (callback) callback(ack);
        } catch (error: any) {
          console.error("❌ Error processing change:", error);
          const ack: ChangeAck = {
            changeId: change.id,
            success: false,
            error: String(error),
          };
          if (callback) callback(ack);
        }
      });

      // Handle batch changes
      socket.on("batch_changes", async (changes: Change[], callback?) => {
        const results: ChangeAck[] = [];

        for (const change of changes) {
          try {
            const timestamp = Date.now();
            const changeRecord: Change = {
              ...change,
              timestamp,
              synced: false,
            };

            await this.changesCollection!.insertOne(changeRecord as any);
            const result = await this.applyChange(changeRecord);

            if (result.applied) {
              await this.changesCollection!.updateOne(
                { id: changeRecord.id } as any,
                { $set: { synced: true } }
              );

              results.push({
                changeId: change.id,
                success: true,
                timestamp,
              });
            } else {
              results.push({
                changeId: change.id,
                success: false,
                error: result.conflict?.reason || "Unknown error",
              });
            }
          } catch (error: any) {
            results.push({
              changeId: change.id,
              success: false,
              error: String(error),
            });
          }
        }

        // Broadcast successful changes
        const successfulChanges = changes.filter((_, i) => results[i].success);
        if (successfulChanges.length > 0) {
          for (const userId of this.activeConnections.keys()) {
            const filtered = successfulChanges.filter(
              (c) => c.userId !== userId
            );
            if (filtered.length > 0) {
              this.io.to(`user:${userId}`).emit("sync:changes", filtered);
            }
          }
        }

        if (callback) callback(results);
        console.log(
          `✅ Batch: ${results.filter((r) => r.success).length}/${changes.length} succeeded`
        );
      });

      // Handle request for changes since timestamp
      socket.on(
        "get_changes",
        async (
          request: { userId: string; since: number; limit?: number },
          callback?
        ) => {
          try {
            const changes = await this.changesCollection!.find({
              timestamp: { $gt: request.since },
              synced: true,
              userId: { $ne: request.userId },
            })
              .sort({ timestamp: 1 })
              .limit(request.limit || 100)
              .toArray();

            if (callback) {
              callback({
                changes,
                latestTimestamp:
                  changes.length > 0
                    ? changes[changes.length - 1].timestamp
                    : request.since,
                hasMore: changes.length === (request.limit || 100),
              });
            }

            console.log(
              `📥 Sent ${changes.length} changes to user ${request.userId}`
            );
          } catch (error: any) {
            console.error("❌ Error fetching changes:", error);
            if (callback) {
              callback({
                changes: [],
                latestTimestamp: request.since,
                hasMore: false,
              });
            }
          }
        }
      );

      // Echo event for testing
      socket.on("echo", (data: any, callback) => {
        console.log(`📢 Echo received:`, data);
        socket.emit("echo", data);
        if (callback) callback({ success: true });
      });

      // Ping for keepalive
      socket.on("ping", (callback) => {
        callback({ timestamp: Date.now() });
      });

      // Handle disconnect
      socket.on("disconnect", () => {
        for (const [userId, sockets] of this.activeConnections.entries()) {
          if (sockets.has(socket.id)) {
            sockets.delete(socket.id);
            if (sockets.size === 0) {
              this.activeConnections.delete(userId);
            }
            break;
          }
        }
        console.log(`🔌 Client disconnected: ${socket.id}`);
      });
    });
  }

  private async applyChange(change: Change): Promise<{
    applied: boolean;
    conflict?: { existingVersion: number; reason: string };
  }> {
    const collection = this.getCollectionByName(change.collection);
    if (!collection) {
      throw new Error(`Unknown collection: ${change.collection}`);
    }

    try {
      // Fetch existing document for conflict resolution
      const existing = await collection.findOne({
        _id: change.documentId,
      } as any);

      // Last-write-wins conflict resolution
      if (existing && existing.sync_updated_at && change.operation !== "insert") {
        if (existing.sync_updated_at >= change.timestamp) {
          return {
            applied: false,
            conflict: {
              existingVersion: existing.sync_updated_at,
              reason: `Server has newer version (${existing.sync_updated_at}) than incoming change (${change.timestamp})`,
            },
          };
        }
      }

      switch (change.operation) {
        case "insert":
          if (existing) {
            // Treat as update if already exists
            await collection.updateOne({ _id: change.documentId } as any, {
              $set: {
                ...change.data,
                sync_updated_at: change.timestamp,
                _updated_by: change.userId,
              },
            });
          } else {
            await collection.insertOne({
              _id: change.documentId,
              ...change.data,
              sync_updated_at: change.timestamp,
              _updated_by: change.userId,
            } as any);
          }
          break;

        case "update":
          await collection.updateOne(
            { _id: change.documentId } as any,
            {
              $set: {
                ...change.data,
                sync_updated_at: change.timestamp,
                _updated_by: change.userId,
              },
            },
            { upsert: true }
          );
          break;

        case "delete":
          await collection.deleteOne({ _id: change.documentId } as any);
          break;

        default:
          throw new Error(`Unknown operation: ${change.operation}`);
      }

      return { applied: true };
    } catch (error: any) {
      // Handle duplicate key errors
      if (error.code === 11000) {
        console.warn(
          `Duplicate key for ${change.collection}/${change.documentId}`
        );
        if (change.operation === "insert") {
          // Retry as update
          await collection.updateOne({ _id: change.documentId } as any, {
            $set: {
              ...change.data,
              sync_updated_at: change.timestamp,
              _updated_by: change.userId,
            },
          });
          return { applied: true };
        }
      }
      throw error;
    }
  }

  private getCollectionByName(name: string): Collection<any> | null {
    switch (name) {
      case "users":
        return this.usersCollection as Collection<any>;
      case "tasks":
        return this.tasksCollection as Collection<any>;
      case "notes":
        return this.notesCollection as Collection<any>;
      default:
        return null;
    }
  }

  async stop(): Promise<void> {
    this.io.close();
    await this.mongoClient.close();
    console.log("✅ Real Sync Test Server stopped");
  }
}

// Start server
const mongoUri =
  process.env.MONGODB_URI || "mongodb://localhost:27017/realm_sync_test";
const port = parseInt(process.env.PORT || "3030", 10);

const server = new RealSyncTestServer(mongoUri, port);

server.start().catch((error) => {
  console.error("❌ Failed to start server:", error);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down...");
  await server.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Shutting down...");
  await server.stop();
  process.exit(0);
});
