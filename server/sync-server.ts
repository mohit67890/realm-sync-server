import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { WebPubSubServiceClient } from "@azure/web-pubsub";
import { Database } from "./database";
import {
  Change,
  SyncRequest,
  SyncResponse,
  ChangeAck,
  UpdateSubscriptionsRequest,
  BootstrapData,
} from "../shared/types";
import { QueryTranslator } from "./query-translator";
import { PluginManager } from "../extensions/plugin-manager";
import { SyncServerPlugin } from "../extensions/plugin-types";

export class SyncServer {
  private app: express.Application;
  private httpServer: any;
  private io: Server;
  private db: Database;
  private webPubSubClient: WebPubSubServiceClient;
  private queryTranslator: QueryTranslator;
  private activeConnections = new Map<string, Set<string>>(); // userId -> Set<socketId>
  private userSubscriptions = new Map<string, any>(); // userId -> SubscriptionSet
  private rateLimits = new Map<string, number[]>(); // socketId -> timestamps (ms)
  private ipConnections = new Map<string, number>(); // IP -> connection count
  private cleanupInterval: NodeJS.Timeout | null = null;
  private maxChangesPerWindow = 50; // configurable threshold
  private rateWindowMs = 10_000; // 10s window
  private maxConnectionsPerUser = parseInt(
    process.env.MAX_CONNECTIONS_PER_USER ||
      (process.env.NODE_ENV === "production" ? "10" : "100")
  );
  private maxConnectionsPerIp = parseInt(
    process.env.MAX_CONNECTIONS_PER_IP ||
      (process.env.NODE_ENV === "production" ? "50" : "500")
  );
  private rateLimitingEnabled =
    process.env.RATE_LIMIT_DISABLED === "1" ||
    process.env.NODE_ENV === "test" ||
    process.env.NODE_ENV === "development"
      ? false
      : true;
  private readonly version = process.env.APP_VERSION || "dev";
  private mongoUri: string;
  private pluginManager: PluginManager;

  constructor(
    mongoUri: string,
    webPubSubConnectionString: string,
    hubName: string,
    private port: number = 3000
  ) {
    this.app = express();
    this.httpServer = createServer(this.app);
    this.io = new Server(this.httpServer, {
      cors: {
        origin:
          process.env.NODE_ENV === "production"
            ? process.env.ALLOWED_ORIGINS?.split(",") || false
            : "*",
        credentials: true,
      },
      transports: ["websocket", "polling"],
    });
    this.mongoUri = mongoUri;
    this.db = new Database(mongoUri);
    this.queryTranslator = new QueryTranslator();
    this.pluginManager = new PluginManager();
    this.webPubSubClient = new WebPubSubServiceClient(
      webPubSubConnectionString,
      hubName
    );
    // Allow env overrides for rate limiting configuration
    if (process.env.SYNC_RATE_LIMIT_MAX) {
      const v = parseInt(process.env.SYNC_RATE_LIMIT_MAX, 10);
      if (!isNaN(v) && v > 0) this.maxChangesPerWindow = v;
    }
    if (process.env.SYNC_RATE_LIMIT_WINDOW_MS) {
      const v = parseInt(process.env.SYNC_RATE_LIMIT_WINDOW_MS, 10);
      if (!isNaN(v) && v > 0) this.rateWindowMs = v;
    }
  }

  /**
   * Register a plugin to extend server functionality
   */
  registerPlugin(plugin: SyncServerPlugin): void {
    this.pluginManager.registerPlugin(plugin);
  }

  /**
   * Get the plugin manager instance (for advanced use cases)
   */
  getPluginManager(): PluginManager {
    return this.pluginManager;
  }

  async start(): Promise<void> {
    // Production configuration enforcement
    if (process.env.NODE_ENV === "production" && !process.env.AUTH_JWT_SECRET) {
      console.error(
        "❌ FATAL: AUTH_JWT_SECRET is required in production for secure identity."
      );
      throw new Error("Missing AUTH_JWT_SECRET in production environment");
    }
    await this.db.connect();

    // Initialize plugins
    await this.pluginManager.initialize({
      app: this.app as any,
      io: this.io,
      db: this.db,
      activeConnections: this.activeConnections,
      userSubscriptions: this.userSubscriptions,
      version: this.version,
    });

    this.setupRoutes();
    this.setupAuthMiddleware();
    this.setupSocketHandlers();

    // Register custom event handlers from plugins
    this.registerPluginEventHandlers();

    this.httpServer.listen(this.port, () => {
      const redactedUri = this.mongoUri.replace(
        /(mongodb:\/\/)([^@]+@)?/,
        "$1"
      );
      console.log("==========================================");
      console.log("✅ Sync Server Started");
      console.log(`📦 Version: ${this.version}`);
      console.log(`🛡 JWT Auth Enabled: ${!!process.env.AUTH_JWT_SECRET}`);
      console.log(`🌐 Port: ${this.port}`);
      console.log(`🗄 MongoDB: ${redactedUri}`);
      console.log(
        `🔁 Rate Limiting: ${this.rateLimitingEnabled ? "enabled" : "disabled"} | window=${this.rateWindowMs}ms max=${this.maxChangesPerWindow}`
      );
      console.log(`📊 Health: http://localhost:${this.port}/health`);
      console.log(`✅ Ready:  http://localhost:${this.port}/ready`);
      console.log("==========================================");
    });

    // Execute plugin onServerStart hooks
    await this.pluginManager.executeOnServerStart();

    // Schedule periodic cleanup of old changes (daily)
    this.cleanupInterval = setInterval(
      () => {
        this.cleanupOldChanges();
      },
      24 * 60 * 60 * 1000
    );

    // Graceful shutdown handlers (idempotent)
    const shutdown = async (signal: string) => {
      try {
        console.log(`\n⚠️ Received ${signal}, shutting down gracefully...`);
        await this.stop();
        process.exit(0);
      } catch (e) {
        console.error("Error during shutdown", e);
        process.exit(1);
      }
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  }

  private setupRoutes(): void {
    this.app.use(express.json());

    this.app.get("/health", (req, res) => {
      res.json({
        status: "healthy",
        timestamp: Date.now(),
        activeConnections: this.activeConnections.size,
        version: this.version,
      });
    });

    this.app.get("/ready", (req, res) => {
      const ready = this.db.isConnected();
      if (!ready) {
        return res
          .status(503)
          .json({ status: "starting", version: this.version });
      }
      res.json({ status: "ready", version: this.version });
    });

    this.app.get("/stats", async (req, res) => {
      try {
        const stats = await this.db.getStats();
        res.json({
          ...stats,
          activeConnections: this.activeConnections.size,
          activeUsers: Array.from(this.activeConnections.keys()),
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Endpoint to get Web PubSub access token + optional JWT for socket auth
    this.app.get("/api/negotiate", async (req, res) => {
      try {
        let userId: string | undefined;
        const authHeader = req.headers.authorization;
        if (
          authHeader &&
          authHeader.startsWith("Bearer ") &&
          process.env.AUTH_JWT_SECRET
        ) {
          const raw = authHeader.substring(7);
          try {
            const payload: any = jwt.verify(raw, process.env.AUTH_JWT_SECRET);
            userId = payload.sub || payload.userId;
          } catch (e: any) {
            return res.status(401).json({ error: "Invalid token" });
          }
        } else {
          // Backwards compatibility fallback
          userId = (req.query.userId as string) || undefined;
        }
        if (!userId) {
          return res.status(400).json({ error: "Missing user identity" });
        }
        const token = await this.webPubSubClient.getClientAccessToken({
          userId,
          roles: ["webpubsub.sendToGroup", "webpubsub.joinLeaveGroup"],
        });
        let jwtToken: string | undefined;
        if (process.env.AUTH_JWT_SECRET) {
          jwtToken = jwt.sign({ sub: userId }, process.env.AUTH_JWT_SECRET, {
            expiresIn: "15m",
          });
        }
        res.json({ url: token.url, token: token.token, jwt: jwtToken });
      } catch (error: any) {
        console.error("Error generating token:", error);
        res.status(500).json({ error: "Failed to generate token" });
      }
    });
  }

  private registerPluginEventHandlers(): void {
    const customHandlers = this.pluginManager.getCustomEventHandlers();

    for (const handler of customHandlers) {
      this.io.on("connection", (socket) => {
        socket.on(handler.event, async (data: any, callback?: any) => {
          try {
            // Optional rate limiting for custom events
            if (
              handler.rateLimit &&
              !this.checkRateLimit(socket, handler.rateLimit)
            ) {
              if (callback) {
                callback({ success: false, error: "rate_limit_exceeded" });
              }
              return;
            }

            await handler.handler(socket, data, callback);
          } catch (error: any) {
            console.error(
              `❌ Error in custom event handler ${handler.event}:`,
              error
            );
            if (callback) {
              callback({ success: false, error: String(error) });
            }
          }
        });
      });

      console.log(`🔌 Registered custom event handler: ${handler.event}`);
    }
  }

  private setupAuthMiddleware(): void {
    if (process.env.AUTH_JWT_SECRET) {
      this.io.use((socket, next) => {
        const token = socket.handshake.auth?.token as string | undefined;
        if (!token) {
          return next(new Error("auth_token_missing"));
        }
        try {
          const payload: any = jwt.verify(token, process.env.AUTH_JWT_SECRET!);
          socket.data.userId = payload.sub || payload.userId;
          return next();
        } catch (e: any) {
          return next(new Error("auth_token_invalid"));
        }
      });
      console.log("🔐 JWT socket auth middleware enabled");
    } else {
      console.log("⚠️ JWT auth not enabled (no AUTH_JWT_SECRET)");
    }
  }

  private setupSocketHandlers(): void {
    this.io.on("connection", (socket: Socket) => {
      const clientIp = socket.handshake.address;
      console.log(`🔌 Client connected: ${socket.id} from ${clientIp}`);

      // Track IP connections for rate limiting (skip in test/development)
      if (process.env.NODE_ENV === "production") {
        const currentIpConnections = this.ipConnections.get(clientIp) || 0;
        if (currentIpConnections >= this.maxConnectionsPerIp) {
          console.warn(
            `⚠️ IP ${clientIp} exceeded connection limit (${this.maxConnectionsPerIp})`
          );
          socket.emit("error", { message: "Connection limit exceeded for IP" });
          socket.disconnect(true);
          return;
        }
        this.ipConnections.set(clientIp, currentIpConnections + 1);
      }

      // Transient, per-socket subscriptions for ad-hoc filtering
      // Map<collection, Array<{ query: string; args?: any[] }>>
      const transientSubscriptions: Map<
        string,
        Array<{ query: string; args?: any[] }>
      > = new Map();

      // Handle authentication and room joining
      socket.on(
        "sync:join",
        async (data: { userId?: string; token?: string }, callback?) => {
          try {
            // When auth secret enabled, userId must come from middleware
            let userId: string | undefined = socket.data.userId;
            if (!process.env.AUTH_JWT_SECRET) {
              // fallback legacy path
              userId = data.userId;
              // Set it on socket.data so other handlers can use it
              if (userId) {
                socket.data.userId = userId;
              }
            }
            if (!userId) {
              if (callback) {
                return callback({
                  success: false,
                  error: process.env.AUTH_JWT_SECRET
                    ? "unauthenticated"
                    : "userId required",
                });
              }
              return;
            }

            // Execute beforeJoin hooks (can reject by throwing)
            try {
              await this.pluginManager.executeBeforeJoin(socket, userId);
            } catch (error: any) {
              console.error(`❌ Plugin rejected join for ${userId}:`, error);
              if (callback) {
                return callback({
                  success: false,
                  error: `Join rejected: ${error.message}`,
                });
              }
              return;
            }

            // Check per-user connection limit (skip in test/development)
            const userConnections = this.activeConnections.get(userId);
            if (
              process.env.NODE_ENV === "production" &&
              userConnections &&
              userConnections.size >= this.maxConnectionsPerUser
            ) {
              console.warn(
                `⚠️ User ${userId} exceeded connection limit (${this.maxConnectionsPerUser})`
              );
              if (callback) {
                return callback({
                  success: false,
                  error: "Connection limit exceeded for user",
                });
              }
              socket.disconnect(true);
              return;
            }

            await socket.join(`user:${userId}`);
            if (!this.activeConnections.has(userId)) {
              this.activeConnections.set(userId, new Set());
            }
            this.activeConnections.get(userId)!.add(socket.id);

            // Load existing subscriptions from database
            const subscriptionSet = await this.db.getSubscriptionSet(userId);
            if (subscriptionSet) {
              this.userSubscriptions.set(userId, subscriptionSet);
              // Touch updatedAt to keep active subscriptions alive (prevents TTL deletion)
              await this.db.touchSubscriptionSet(userId);
              console.log(
                `📋 Loaded ${subscriptionSet.subscriptions?.length || 0} subscriptions for user ${userId}`
              );
            }

            console.log(`✅ User ${userId} joined (socket: ${socket.id})`);

            // Execute afterJoin hooks
            await this.pluginManager.executeAfterJoin(socket, userId);

            if (callback) {
              callback({ success: true, timestamp: Date.now() });
            }
            // Also emit a joined event for clients that don't support callbacks
            socket.emit("joined", { userId, timestamp: Date.now() });
          } catch (error: any) {
            console.error("Error joining:", error);
            if (callback) {
              callback({ success: false, error: String(error) });
            }
          }
        }
      );

      // Handle FLX subscription updates
      socket.on(
        "sync:update_subscriptions",
        async (request: UpdateSubscriptionsRequest, callback?) => {
          try {
            const userId = socket.data.userId;
            if (!userId) {
              if (callback)
                callback({ success: false, error: "Not authenticated" });
              return;
            }

            console.log(`📋 Updating subscriptions for user ${userId}`);

            // Execute beforeUpdateSubscriptions hooks
            await this.pluginManager.executeBeforeUpdateSubscriptions(
              socket,
              userId,
              request.subscriptions
            );

            // Save subscription set to database
            const version = await this.db.saveSubscriptionSet(
              userId,
              request.subscriptions
            );

            // Store in memory for fast filtering
            const subscriptionSet = await this.db.getSubscriptionSet(userId);
            this.userSubscriptions.set(userId, subscriptionSet);

            // Bootstrap each subscription with initial data
            for (const sub of request.subscriptions) {
              try {
                await this.bootstrapSubscription(socket, userId, sub);
              } catch (error) {
                console.error(
                  `Failed to bootstrap subscription ${sub.name || sub.collection}:`,
                  error
                );
              }
            }

            // Execute afterUpdateSubscriptions hooks
            await this.pluginManager.executeAfterUpdateSubscriptions(
              socket,
              userId,
              version
            );

            if (callback) {
              callback({
                success: true,
                version,
                timestamp: Date.now(),
              });
            }

            console.log(
              `✅ Subscriptions updated for user ${userId} (version ${version})`
            );
          } catch (error: any) {
            console.error("Error updating subscriptions:", error);
            if (callback) {
              callback({ success: false, error: String(error) });
            }
          }
        }
      );

      // Handle transient subscribe: { collection, filter, args }
      socket.on("sync:subscribe", (payload: any, callback?) => {
        try {
          const collection = payload?.collection as string | undefined;
          const filter = payload?.filter as string | undefined;
          const args = (payload?.args as any[]) || [];
          if (!collection) {
            callback?.({ success: false, error: "collection required" });
            return;
          }
          const list = transientSubscriptions.get(collection) || [];
          // Store empty filter as match-all
          list.push({ query: filter || "", args });
          transientSubscriptions.set(collection, list);
          // Expose on socket for matcher helper access
          (socket as any).transientSubscriptions = transientSubscriptions;
          socket.data.transientSubscriptions = transientSubscriptions;
          callback?.({ success: true, count: list.length });
        } catch (e: any) {
          callback?.({ success: false, error: String(e) });
        }
      });

      // Handle transient unsubscribe: { collection, filter? }
      socket.on("sync:unsubscribe", (payload: any, callback?) => {
        try {
          const collection = payload?.collection as string | undefined;
          const filter = payload?.filter as string | undefined;
          if (!collection) {
            callback?.({ success: false, error: "collection required" });
            return;
          }
          if (!transientSubscriptions.has(collection)) {
            callback?.({ success: true, count: 0 });
            return;
          }
          if (!filter) {
            transientSubscriptions.delete(collection);
            callback?.({ success: true, count: 0 });
            return;
          }
          const list = transientSubscriptions.get(collection) || [];
          const remaining = list.filter((s) => s.query !== filter);
          if (remaining.length > 0)
            transientSubscriptions.set(collection, remaining);
          else transientSubscriptions.delete(collection);
          (socket as any).transientSubscriptions = transientSubscriptions;
          socket.data.transientSubscriptions = transientSubscriptions;
          callback?.({ success: true, count: remaining.length });
        } catch (e: any) {
          callback?.({ success: false, error: String(e) });
        }
      });

      // Handle incoming change from client
      socket.on("sync:change", async (change: Change, callback) => {
        // Rate limiting
        if (!this.checkRateLimit(socket)) {
          return callback({
            changeId: change.id,
            success: false,
            error: "rate_limit_exceeded",
          });
        }
        const startTime = Date.now();

        try {
          const timestamp = Date.now();
          let changeRecord: Change = {
            ...change,
            timestamp,
            synced: false,
          };

          console.log(
            `📝 Processing change: ${change.operation} on ${change.collection}/${change.documentId}`
          );

          // Execute beforeChange hooks (can modify or reject change)
          const modifiedChange = await this.pluginManager.executeBeforeChange(
            socket,
            changeRecord
          );
          if (modifiedChange) {
            changeRecord = modifiedChange;
          }

          // Save to change log
          await this.db.saveChange(changeRecord);

          // Apply change to actual data collection (with conflict detection)
          const applyResult = await this.db.applyChange(changeRecord);

          if (!applyResult.applied && applyResult.conflict) {
            // Conflict detected - inform client
            const latency = Date.now() - startTime;
            console.warn(
              `⚠️ Conflict detected, rejecting change in ${latency}ms`
            );

            const ack: ChangeAck = {
              changeId: change.id,
              success: false,
              error: `conflict: ${applyResult.conflict.reason}`,
              timestamp,
            };
            callback(ack);
            return;
          }

          // Mark as synced (only if successfully applied)
          await this.db.markChangeSynced(changeRecord.id);

          // FLX-aware broadcast: emit to ALL users with matching subscriptions (including sender)
          // Emit directly to socket IDs to ensure all clients receive changes
          for (const userId of this.activeConnections.keys()) {
            if (this.shouldReceiveChange(userId, changeRecord)) {
              const socketIds = this.activeConnections.get(userId);
              if (socketIds) {
                socketIds.forEach((socketId) => {
                  this.io.to(socketId).emit("sync:changes", [changeRecord]);
                });
              }
            }
          }

          // Transient per-socket subscriptions: emit to individual sockets that match
          this.io.sockets.sockets.forEach((s) => {
            if (
              s.id !== socket.id &&
              this.matchesTransientSubscription(s, changeRecord)
            ) {
              s.emit("sync:changes", [changeRecord]);
            }
          });

          const latency = Date.now() - startTime;
          console.log(`✅ Change applied in ${latency}ms`);

          // Execute afterChange hooks
          await this.pluginManager.executeAfterChange(socket, changeRecord);

          // Acknowledge to sender
          const ack: ChangeAck = {
            changeId: change.id,
            success: true,
            timestamp,
          };
          callback(ack);
        } catch (error: any) {
          console.error("❌ Error processing change:", error);
          const ack: ChangeAck = {
            changeId: change.id,
            success: false,
            error: String(error),
          };
          callback(ack);
        }
      });

      // Compatibility handler for Dart client mongoUpsert payloads
      socket.on("mongoUpsert", async (payload: any, callback?) => {
        try {
          const startTime = Date.now();
          const collection = payload?.collection;
          const update = payload?.update || {};
          const queryId = payload?.query?._id || update.id;
          if (!collection || !queryId) {
            if (callback) callback("error");
            return;
          }
          // Determine operation: treat all as update (upsert semantics)
          const operation: Change["operation"] = "update";
          // Extract patchId for idempotency or generate one
          const changeId =
            payload?.patchId ||
            update.patchId ||
            `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
          const userId: string =
            socket.data.userId || update.userId || "anonymous";
          // Convert wrapped dates {type:'date',value:iso} -> iso/Date number
          const normalizedData: any = { ...update };
          for (const k of Object.keys(normalizedData)) {
            const v = normalizedData[k];
            if (v && typeof v === "object" && v.type === "date" && v.value) {
              // Store as sync_updated_at for internal conflict resolution, also keep original field
              if (k === "updatedAt") {
                normalizedData.sync_updated_at = Date.parse(v.value);
              }
              normalizedData[k] = v.value;
            }
          }
          // Remove client-only metadata
          delete normalizedData.patchId;
          delete normalizedData.id; // documentId already represented
          // Build Change record
          let change: Change = {
            id: changeId,
            userId,
            timestamp: Date.now(),
            operation,
            collection,
            documentId: queryId,
            data: normalizedData,
            synced: false,
          };

          // Execute beforeChange hooks (can modify or reject change)
          try {
            const modifiedChange = await this.pluginManager.executeBeforeChange(
              socket,
              change
            );
            if (modifiedChange) {
              change = modifiedChange;
            }
          } catch (error: any) {
            console.error(`❌ Plugin rejected mongoUpsert:`, error);
            if (callback) callback("error");
            return;
          }

          // Reuse existing logic path
          await this.db.saveChange(change);
          const applyResult = await this.db.applyChange(change);
          if (!applyResult.applied && applyResult.conflict) {
            await this.db.markChangeSynced(change.id); // record attempted
            if (callback) callback("error");
            return;
          }
          await this.db.markChangeSynced(change.id);
          // Broadcast using existing channel - emit directly to socket IDs
          console.log(
            `📡 Broadcasting mongoUpsert change to active users: ${Array.from(this.activeConnections.keys()).join(", ")}`
          );
          for (const userIdKey of this.activeConnections.keys()) {
            if (this.shouldReceiveChange(userIdKey, change)) {
              const socketIds = this.activeConnections.get(userIdKey);
              if (socketIds) {
                console.log(
                  `  ✅ Emitting to user ${userIdKey} (${socketIds.size} socket(s)): ${Array.from(socketIds).join(", ")}`
                );
                socketIds.forEach((socketId) => {
                  this.io.to(socketId).emit("sync:changes", [change]);
                });
              }
            } else {
              console.log(
                `  ⏭️ Skipping user ${userIdKey} (shouldReceiveChange=false)`
              );
            }
          }
          // Transient subscriptions broadcast
          this.io.sockets.sockets.forEach((s) => {
            if (
              s.id !== socket.id &&
              this.matchesTransientSubscription(s, change)
            ) {
              s.emit("sync:changes", [change]);
            }
          });
          const latency = Date.now() - startTime;
          console.log(
            `✅ mongoUpsert applied ${collection}/${queryId} in ${latency}ms`
          );

          // Execute afterChange hooks
          await this.pluginManager.executeAfterChange(socket, change);

          if (callback) callback("ok");
        } catch (e) {
          console.error("❌ mongoUpsert error", e);
          if (callback) callback("error");
        }
      });

      // Compatibility handler for Dart client mongoDelete payloads
      socket.on("mongoDelete", async (payload: any, callback?) => {
        try {
          const collection = payload?.collection;
          const id = payload?.query?._id;
          if (!collection || !id) {
            if (callback) callback("error");
            return;
          }
          const changeId =
            payload?.patchId ||
            `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
          const userId: string = socket.data.userId || "anonymous";
          let change: Change = {
            id: changeId,
            userId,
            timestamp: Date.now(),
            operation: "delete",
            collection,
            documentId: id,
            synced: false,
          };

          // Execute beforeChange hooks (can reject delete)
          try {
            const modifiedChange = await this.pluginManager.executeBeforeChange(
              socket,
              change
            );
            if (modifiedChange) {
              change = modifiedChange;
            }
          } catch (error: any) {
            console.error(`❌ Plugin rejected mongoDelete:`, error);
            if (callback) callback("error");
            return;
          }

          await this.db.saveChange(change);
          const applyResult = await this.db.applyChange(change);
          if (!applyResult.applied && applyResult.conflict) {
            await this.db.markChangeSynced(change.id);
            if (callback) callback("error");
            return;
          }
          await this.db.markChangeSynced(change.id);
          // Broadcast delete to all matching users - emit directly to socket IDs
          for (const userIdKey of this.activeConnections.keys()) {
            if (this.shouldReceiveChange(userIdKey, change)) {
              const socketIds = this.activeConnections.get(userIdKey);
              if (socketIds) {
                socketIds.forEach((socketId) => {
                  this.io.to(socketId).emit("sync:changes", [change]);
                });
              }
            }
          }
          // Transient subscriptions broadcast
          this.io.sockets.sockets.forEach((s) => {
            if (
              s.id !== socket.id &&
              this.matchesTransientSubscription(s, change)
            ) {
              s.emit("sync:changes", [change]);
            }
          });
          console.log(`✅ mongoDelete applied ${collection}/${id}`);

          // Execute afterChange hooks
          await this.pluginManager.executeAfterChange(socket, change);

          if (callback) callback("ok");
        } catch (e) {
          console.error("❌ mongoDelete error", e);
          if (callback) callback("error");
        }
      });

      // Handle batched changes from SyncHelper (more efficient than individual calls)
      socket.on("sync:changeBatch", async (payload: any, callback?) => {
        try {
          const startTime = Date.now();
          const changes = payload?.changes || [];
          if (!Array.isArray(changes) || changes.length === 0) {
            if (callback)
              callback({ success: false, error: "No changes provided" });
            return;
          }

          const userId: string = socket.data.userId || "anonymous";

          // Apply rate limiting to batch operations (count entire batch with weight)
          if (!this.checkRateLimit(socket, changes.length)) {
            if (callback)
              callback({
                success: false,
                error: "Rate limit exceeded for batch operation",
              });
            return;
          }

          const results: any[] = [];

          // Process all changes in the batch
          for (const change of changes) {
            try {
              const { operation, collectionName, documentId, data, patchId } =
                change;

              if (!collectionName || !documentId) {
                results.push({
                  success: false,
                  error: "Missing collection or documentId",
                });
                continue;
              }

              // Generate or use provided changeId
              const changeId =
                patchId ||
                `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

              if (operation === "delete") {
                // Handle delete operation
                let changeRecord: Change = {
                  id: changeId,
                  userId,
                  timestamp: Date.now(),
                  operation: "delete",
                  collection: collectionName,
                  documentId,
                  synced: false,
                };

                // Execute beforeChange hooks
                try {
                  const modifiedChange = await this.pluginManager.executeBeforeChange(
                    socket,
                    changeRecord
                  );
                  if (modifiedChange) {
                    changeRecord = modifiedChange;
                  }
                } catch (error: any) {
                  results.push({
                    success: false,
                    documentId,
                    error: `Plugin rejected: ${error.message}`,
                  });
                  continue;
                }

                await this.db.saveChange(changeRecord);
                const applyResult = await this.db.applyChange(changeRecord);

                if (applyResult.applied) {
                  await this.db.markChangeSynced(changeRecord.id);

                  // Broadcast to all matching users
                  for (const userIdKey of this.activeConnections.keys()) {
                    if (this.shouldReceiveChange(userIdKey, changeRecord)) {
                      this.io
                        .to(`user:${userIdKey}`)
                        .emit("sync:changes", [changeRecord]);
                    }
                  }

                  // Execute afterChange hooks
                  await this.pluginManager.executeAfterChange(socket, changeRecord);

                  results.push({
                    success: true,
                    documentId,
                    operation: "delete",
                  });
                } else {
                  results.push({
                    success: false,
                    documentId,
                    error: applyResult.conflict?.reason || "Apply failed",
                  });
                }
              } else {
                // Handle upsert operation
                let changeRecord: Change = {
                  id: changeId,
                  userId,
                  timestamp: data?.sync_updated_at || Date.now(),
                  operation: "update",
                  collection: collectionName,
                  documentId,
                  data: data || {},
                  synced: false,
                };

                // Execute beforeChange hooks
                try {
                  const modifiedChange = await this.pluginManager.executeBeforeChange(
                    socket,
                    changeRecord
                  );
                  if (modifiedChange) {
                    changeRecord = modifiedChange;
                  }
                } catch (error: any) {
                  results.push({
                    success: false,
                    documentId,
                    error: `Plugin rejected: ${error.message}`,
                  });
                  continue;
                }

                await this.db.saveChange(changeRecord);
                const applyResult = await this.db.applyChange(changeRecord);

                if (applyResult.applied) {
                  await this.db.markChangeSynced(changeRecord.id);

                  // Broadcast to all matching users
                  for (const userIdKey of this.activeConnections.keys()) {
                    if (this.shouldReceiveChange(userIdKey, changeRecord)) {
                      this.io
                        .to(`user:${userIdKey}`)
                        .emit("sync:changes", [changeRecord]);
                    }
                  }

                  // Execute afterChange hooks
                  await this.pluginManager.executeAfterChange(socket, changeRecord);

                  results.push({
                    success: true,
                    documentId,
                    operation: "upsert",
                  });
                } else {
                  results.push({
                    success: false,
                    documentId,
                    error: applyResult.conflict?.reason || "Apply failed",
                  });
                }
              }
            } catch (itemError) {
              console.error(`❌ Batch item error:`, itemError);
              results.push({ success: false, error: String(itemError) });
            }
          }

          const latency = Date.now() - startTime;
          const successCount = results.filter((r) => r.success).length;
          console.log(
            `✅ Batch processed ${successCount}/${changes.length} changes in ${latency}ms`
          );

          if (callback) {
            callback({
              success: true,
              results,
              totalProcessed: changes.length,
              successCount,
              latency,
            });
          }
        } catch (e) {
          console.error("❌ changeBatch error", e);
          if (callback) callback({ success: false, error: String(e) });
        }
      });

      // Handle batch changes
      socket.on("sync:batch_changes", async (changes: Change[], callback) => {
        if (!this.checkRateLimit(socket, changes.length)) {
          return callback(
            changes.map((c) => ({
              changeId: c.id,
              success: false,
              error: "rate_limit_exceeded",
            }))
          );
        }
        const results: ChangeAck[] = [];

        for (const change of changes) {
          try {
            const timestamp = Date.now();
            let changeRecord: Change = {
              ...change,
              timestamp,
              synced: false,
            };

            // Execute beforeChange hooks (can modify or reject change)
            try {
              const modifiedChange = await this.pluginManager.executeBeforeChange(
                socket,
                changeRecord
              );
              if (modifiedChange) {
                changeRecord = modifiedChange;
              }
            } catch (error: any) {
              results.push({
                changeId: change.id,
                success: false,
                error: `Plugin rejected: ${error.message}`,
              });
              continue;
            }

            await this.db.saveChange(changeRecord);
            await this.db.applyChange(changeRecord);
            await this.db.markChangeSynced(changeRecord.id);

            // Execute afterChange hooks
            await this.pluginManager.executeAfterChange(socket, changeRecord);

            results.push({
              changeId: change.id,
              success: true,
              timestamp,
            });
          } catch (error: any) {
            results.push({
              changeId: change.id,
              success: false,
              error: String(error),
            });
          }
        }

        // FLX-aware broadcast for batch changes - emit directly to socket IDs
        const successfulChanges = changes.filter((_, i) => results[i].success);
        if (successfulChanges.length > 0) {
          for (const userId of this.activeConnections.keys()) {
            // Exclude origin user and filter by subscriptions
            const filtered = successfulChanges.filter(
              (c) => c.userId !== userId && this.shouldReceiveChange(userId, c)
            );
            if (filtered.length > 0) {
              const socketIds = this.activeConnections.get(userId);
              if (socketIds) {
                socketIds.forEach((socketId) => {
                  this.io.to(socketId).emit("sync:changes", filtered);
                });
              }
            }
          }
          // Transient subscriptions broadcast (per socket)
          this.io.sockets.sockets.forEach((s) => {
            const filtered = successfulChanges.filter((c) =>
              this.matchesTransientSubscription(s, c)
            );
            if (filtered.length > 0) {
              s.emit("sync:changes", filtered);
            }
          });
        }

        callback(results);
        console.log(
          `✅ Batch processed: ${results.filter((r) => r.success).length}/${changes.length} succeeded`
        );
      });

      // Handle request for historical changes (optionally filtered by collection + query)
      socket.on("sync:get_changes", async (request: any, callback?) => {
        try {
          const userId = request.userId || socket.data.userId;
          const since = request.since || 0;
          const limit = request.limit || 100;
          const collection = request.collection as string | undefined;
          const filter = request.filter as string | undefined;
          const args = (request.args as any[]) || [];

          let changes: Change[] = [];

          if (collection) {
            // Filter by collection and query
            let mongoQuery: any = { sync_updated_at: { $gt: since } };
            if (filter) {
              // Substitute args into filter before translation
              let finalFilter = filter;
              if (args && args.length > 0) {
                args.forEach((arg, idx) => {
                  const placeholder = `$${idx}`;
                  const value =
                    typeof arg === "string" ? `'${arg}'` : String(arg);
                  finalFilter = finalFilter.replace(
                    new RegExp(`\\${placeholder}\\b`, "g"),
                    value
                  );
                });
              }
              const translated = this.queryTranslator.toMongoQuery(finalFilter);
              mongoQuery = { ...mongoQuery, ...translated };
            }
            const docs = await this.db.getDocumentsForSubscription(
              collection,
              mongoQuery,
              limit
            );
            changes = docs.map((d: any) => ({
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
              userId: userId || "anonymous",
              timestamp: d.sync_updated_at || Date.now(),
              operation: "update",
              collection,
              documentId: d._id?.toString?.() || d._id,
              data: d,
              synced: true,
            }));
          } else {
            // Fallback to general change log
            changes = await this.db.getChangesSince(userId, since, limit);
          }

          const latestTimestamp =
            changes.length > 0
              ? Math.max(since, ...changes.map((c) => c.timestamp))
              : since;

          const response: SyncResponse = {
            changes,
            latestTimestamp,
            hasMore: changes.length === limit,
          };

          if (typeof callback === "function") {
            callback(response);
          }
          console.log(
            `📥 Sent ${changes.length} changes to user ${userId} (collection=${collection || "*"})`
          );
        } catch (error: any) {
          console.error("❌ Error fetching changes:", error);
          if (typeof callback === "function") {
            callback({ changes: [], latestTimestamp: 0, hasMore: false });
          }
        }
      });

      // Test endpoint for querying MongoDB (for integration tests)
      socket.on("test:query", async (payload: any, callback?) => {
        try {
          const { collection, filter } = payload;
          if (!collection || !filter) {
            if (typeof callback === "function") {
              callback({
                success: false,
                error: "Missing collection or filter",
              });
            }
            return;
          }

          // Direct MongoDB collection query
          const result = await this.db
            .getCollection(collection)
            .findOne(filter);
          if (typeof callback === "function") {
            callback({ success: true, data: result });
          }
        } catch (error: any) {
          console.error("❌ Test query error:", error);
          if (typeof callback === "function") {
            callback({ success: false, error: error.message });
          }
        }
      });

      // Handle ping for keepalive (callback optional)
      socket.on("ping", (callback?) => {
        const payload = { timestamp: Date.now() };
        if (typeof callback === "function") {
          callback(payload);
        } else {
          // For clients that don't use ACK callbacks, emit a 'pong'
          socket.emit("pong", payload);
        }
      });

      // Handle disconnect
      socket.on("disconnect", async () => {
        const userId = socket.data.userId;
        const clientIp = socket.handshake.address;

        // Execute onDisconnect hooks
        await this.pluginManager.executeOnDisconnect(socket, userId);

        // Cleanup IP connection tracking
        const ipCount = this.ipConnections.get(clientIp) || 0;
        if (ipCount > 1) {
          this.ipConnections.set(clientIp, ipCount - 1);
        } else {
          this.ipConnections.delete(clientIp);
        }

        if (userId) {
          const connections = this.activeConnections.get(userId);
          if (connections) {
            connections.delete(socket.id);
            if (connections.size === 0) {
              this.activeConnections.delete(userId);

              // Schedule memory cleanup after 5 minutes of inactivity
              // This allows quick reconnects without reloading subscriptions from DB
              setTimeout(
                () => {
                  // Check if user reconnected during timeout
                  if (!this.activeConnections.has(userId)) {
                    this.userSubscriptions.delete(userId);
                    console.log(
                      `🧹 Cleared subscription cache for inactive user: ${userId}`
                    );
                  }
                },
                5 * 60 * 1000
              );
            }
          }
        }
        console.log(`🔌 Client disconnected: ${socket.id}`);
        // Clear transient subscriptions for this socket
        transientSubscriptions.clear();
      });
    });
  }

  private async cleanupOldChanges(): Promise<void> {
    try {
      const deletedCount = await this.db.cleanupOldChanges(30);
      console.log(`🧹 Cleaned up ${deletedCount} old changes`);

      // Also cleanup inactive subscriptions (TTL index handles this automatically,
      // but manual cleanup ensures it works even without TTL support)
      const deletedSubs = await this.db.cleanupInactiveSubscriptions(90);
      if (deletedSubs > 0) {
        console.log(`🧹 Cleaned up ${deletedSubs} inactive subscriptions`);
      }
    } catch (error) {
      console.error("Error cleaning up old data:", error);
    }
  }

  async stop(): Promise<void> {
    // Execute onServerStop hooks
    await this.pluginManager.executeOnServerStop();

    // Cleanup plugins
    await this.pluginManager.cleanup();

    this.io.close();
    await this.db.close();
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    console.log("✅ Sync server stopped");
  }

  private checkRateLimit(socket: Socket, weight: number = 1): boolean {
    const now = Date.now();
    const windowStart = now - this.rateWindowMs;
    const arr = this.rateLimits.get(socket.id) || [];
    // prune old
    const recent = arr.filter((t) => t >= windowStart);
    // Disable rate limiting in test environment to avoid flakiness
    if (process.env.NODE_ENV === "test") {
      return true;
    }
    if (!this.rateLimitingEnabled) {
      return true;
    }
    if (recent.length + weight > this.maxChangesPerWindow) {
      return false;
    }
    for (let i = 0; i < weight; i++) {
      recent.push(now);
    }
    this.rateLimits.set(socket.id, recent);
    return true;
  }

  /**
   * Bootstrap a subscription by sending initial matching data
   */
  private async bootstrapSubscription(
    socket: Socket,
    userId: string,
    subscription: any
  ): Promise<void> {
    try {
      // Mark subscription as bootstrapping
      await this.db.updateSubscriptionState(
        userId,
        subscription.id || subscription.collection,
        "bootstrapping"
      );

      // Translate RQL query to MongoDB query
      const mongoQuery = this.queryTranslator.toMongoQuery(subscription.query);

      console.log(
        `🔄 Bootstrapping subscription: ${subscription.name || subscription.collection} (query: ${subscription.query})`
      );

      // Fetch initial data
      const documents = await this.db.getDocumentsForSubscription(
        subscription.collection,
        mongoQuery,
        1000 // Limit initial bootstrap
      );

      // Send bootstrap data
      const bootstrapData: BootstrapData = {
        subscription: subscription.name || subscription.collection,
        collection: subscription.collection,
        data: documents,
        hasMore: documents.length >= 1000,
      };

      socket.emit("sync:bootstrap", bootstrapData);

      // Mark subscription as complete
      await this.db.updateSubscriptionState(
        userId,
        subscription.id || subscription.collection,
        "complete"
      );

      console.log(
        `✅ Bootstrapped ${documents.length} documents for subscription ${subscription.name || subscription.collection}`
      );
    } catch (error) {
      console.error(`Failed to bootstrap subscription:`, error);
      await this.db.updateSubscriptionState(
        userId,
        subscription.id || subscription.collection,
        "error"
      );

      // Notify client of bootstrap error
      socket.emit("sync:bootstrap_error", {
        subscription: subscription.name || subscription.collection,
        collection: subscription.collection,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  /**
   * Check if a user should receive a change based on their subscriptions
   */
  private shouldReceiveChange(userId: string, change: Change): boolean {
    // If no subscriptions defined, fall back to broadcasting all changes (legacy behavior)
    const subscriptionSet = this.userSubscriptions.get(userId);
    if (
      !subscriptionSet ||
      !subscriptionSet.subscriptions ||
      subscriptionSet.subscriptions.length === 0
    ) {
      return true;
    }

    // Check if any subscription matches this change
    for (const sub of subscriptionSet.subscriptions) {
      // Check collection match
      if (sub.collection !== change.collection) {
        continue;
      }

      // Check if change data matches subscription query
      try {
        const document = change.data || { _id: change.documentId };
        if (this.queryTranslator.matchesQuery(document, sub.query)) {
          return true;
        }
      } catch (error) {
        console.warn(
          `Error evaluating query for subscription ${sub.name}:`,
          error
        );
        // On error, be permissive and send the change
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a socket's transient subscriptions match the change
   */
  private matchesTransientSubscription(
    socket: Socket,
    change: Change
  ): boolean {
    // We stored transient subscriptions per-socket in the connection scope,
    // but here we reconstruct from socket.data if present for robustness.
    const subs: Map<string, Array<{ query: string; args?: any[] }>> = (socket
      .data.transientSubscriptions as any) || undefined;
    // Fallback: if not on socket.data, try a weak reference cache via symbol
    const anySocket: any = socket as any;
    const localSubs: Map<
      string,
      Array<{ query: string; args?: any[] }>
    > = anySocket.transientSubscriptions || subs;
    if (!localSubs || localSubs.size === 0) return false;
    const list = localSubs.get(change.collection);
    if (!list || list.length === 0) return false;
    const doc = change.data || { _id: change.documentId };
    for (const s of list) {
      try {
        if (!s.query || s.query.trim() === "") return true; // match-all
        // Substitute args into query if present
        let finalQuery = s.query;
        if (s.args && s.args.length > 0) {
          s.args.forEach((arg, idx) => {
            const placeholder = `$${idx}`;
            const value = typeof arg === "string" ? `'${arg}'` : String(arg);
            // Use correct escaping: \$ matches literal $, \b for word boundary
            finalQuery = finalQuery.replace(
              new RegExp(`\\${placeholder}\\b`, "g"),
              value
            );
          });
        }
        if (this.queryTranslator.matchesQuery(doc, finalQuery)) {
          return true;
        }
      } catch (e) {
        // On translator error, be conservative and skip
        console.warn(
          `Subscription match error for ${change.collection}/${change.documentId}:`,
          e
        );
      }
    }
    return false;
  }
}
