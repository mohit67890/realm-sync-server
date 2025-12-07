import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import { WebPubSubServiceClient } from "@azure/web-pubsub";

import { useAzureSocketIO } from "@azure/web-pubsub-socket.io";

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
import { SyncServerRoutes, RouteSetupFunction, RouteContext } from "./routes";
import { PluginManager } from "../extensions/plugin-manager";
import { SyncServerPlugin } from "../extensions/plugin-types";
import { SubscriptionMatcher } from "../shared/subscription-matcher";
// Auth helper: derive userId from authenticated socket or fallback
function getUserIdFromSocket(
  socket: Socket,
  fallbackUserId?: string
): string | undefined {
  // If USE_USERID is true, use socket.id as userId
  if (process.env.USE_USERID === "true") {
    return socket.id;
  }

  if (socket?.data?.userId) return socket.data.userId;
  if (socket?.handshake.query.uuid)
    return socket.handshake.query.uuid as string;
  if (socket?.handshake.query.userId)
    return socket.handshake.query.userId as string;
  return fallbackUserId;
}

import {
  AuthManager,
  AuthStrategy,
  createJWTProviderFromEnv,
  createFirebaseProviderFromEnv,
} from "../shared/auth-index";
import { convertDatesToNative } from "../shared/utils";
import fs from "fs";

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
  private subscriptionMatcher: SubscriptionMatcher;
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
  // Limit the number of documents sent during initial FLX bootstrap per subscription
  private bootstrapLimit = parseInt(
    process.env.SUBSCRIPTION_BOOTSTRAP_LIMIT || "1000",
    10
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
  private broadcastToSender: boolean;
  private authManager: AuthManager;
  private customRouteSetup?: RouteSetupFunction;
  // Azure Pub Sub has a 1MB message limit, so we cap at 900KB for safety
  private maxMessageSize = parseInt(
    process.env.MAX_MESSAGE_SIZE || "921600", // 900KB default
    10
  );

  constructor(
    mongoUri: string,
    webPubSubConnectionString: string,
    hubName: string,
    private port: number = 3000,
    authManager: AuthManager
  ) {
    this.authManager = authManager;
    this.app = express();
    this.httpServer = createServer(this.app);
    this.io = new Server(this.httpServer, {
      allowUpgrades: false,

      maxHttpBufferSize: 1e6, // 1MB
      cors: {
        origin:
          process.env.NODE_ENV === "production"
            ? process.env.ALLOWED_ORIGINS?.split(",") || false
            : "*",
        methods: ["GET", "POST"],
        allowedHeaders: ["authorization"],
        credentials: true,
      },
      transports: ["websocket"],
      connectionStateRecovery: {
        maxDisconnectionDuration: 1000,
      },
    });
    this.mongoUri = mongoUri;
    this.db = new Database(mongoUri);
    this.queryTranslator = new QueryTranslator();
    this.pluginManager = new PluginManager();
    this.webPubSubClient = new WebPubSubServiceClient(
      webPubSubConnectionString,
      hubName
    );
    // Initialize subscription matcher with configuration
    this.subscriptionMatcher = new SubscriptionMatcher({
      userSubscriptions: this.userSubscriptions,
      activeConnections: this.activeConnections,
      queryTranslator: this.queryTranslator,
      io: this.io,
    });
    // Allow env overrides for rate limiting configuration
    if (process.env.SYNC_RATE_LIMIT_MAX) {
      const v = parseInt(process.env.SYNC_RATE_LIMIT_MAX, 10);
      if (!isNaN(v) && v > 0) this.maxChangesPerWindow = v;
    }
    if (process.env.SYNC_RATE_LIMIT_WINDOW_MS) {
      const v = parseInt(process.env.SYNC_RATE_LIMIT_WINDOW_MS, 10);
      if (!isNaN(v) && v > 0) this.rateWindowMs = v;
    }
    // Configure whether to broadcast changes back to sender
    this.broadcastToSender = process.env.BROADCAST_TO_SENDER === "true";
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

  /**
   * Set custom route setup function for extending HTTP endpoints
   */
  setCustomRoutes(setupFunction: RouteSetupFunction): void {
    this.customRouteSetup = setupFunction;
  }

  /**
   * Get route context for custom route setup
   */
  private getRouteContext(): RouteContext {
    return {
      app: this.app as any,
      db: this.db,
      webPubSubClient: this.webPubSubClient,
      version: this.version,
      activeConnections: this.activeConnections,
      userSubscriptions: this.userSubscriptions,
      io: this.io,
      queryTranslator: this.queryTranslator,
      broadcastToSender: this.broadcastToSender,
    };
  }

  async start(): Promise<void> {
    // Enforce provider-based auth: require at least one enabled provider
    const providers = this.authManager.getEnabledProviders();
    if (!providers.length) {
      const msg = "No auth providers enabled; configure at least one provider.";
      if (process.env.NODE_ENV === "production") {
        console.error(`❌ FATAL (production): ${msg}`);
        throw new Error(msg);
      } else {
        console.warn(`⚠️ ${msg}`);
      }
    }
    await this.db.connect();

    if (
      process.env.WEB_PUBSUB_HUB_NAME != null &&
      process.env.WEB_PUBSUB_CONNECTION_STRING != null
    ) {
      await useAzureSocketIO(this.io, {
        hub: process.env.WEB_PUBSUB_HUB_NAME, // The hub name can be any valid string.
        connectionString: process.env.WEB_PUBSUB_CONNECTION_STRING,
      });
    }

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
      const enabledProviders = this.authManager.getEnabledProviders();
      console.log(
        `🔐 Auth Providers: ${enabledProviders.join(", ") || "none"}`
      );
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

    // Setup default routes (health, ready, stats, negotiate)
    const context = this.getRouteContext();
    SyncServerRoutes.setupDefaultRoutes(context);

    // Setup custom routes if provided
    if (this.customRouteSetup) {
      console.log("🔧 Setting up custom routes");
      this.customRouteSetup(context);
    }
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
    // Custom middleware to override socket.id with userId when USE_USERID=true
    if (process.env.USE_USERID === "true") {
      this.io.use(async (socket, next) => {
        try {
          // Extract userId from various sources
          const uuid = socket.handshake.query.uuid as string | undefined;
          const userId = socket.handshake.query.userId as string | undefined;

          // Use uuid or userId from query parameters
          if (uuid) {
            // Override socket.id by modifying the internal property
            (socket as any).id = uuid;
            socket.data.userId = uuid;
            console.log(`🔑 Socket ID overridden with uuid: ${uuid}`);
            return next();
          }

          if (userId) {
            // Override socket.id by modifying the internal property
            (socket as any).id = userId;
            socket.data.userId = userId;
            console.log(`🔑 Socket ID overridden with userId: ${userId}`);
            return next();
          }

          // If no uuid/userId provided, keep original socket.id
          socket.data.userId = socket.id;
          console.log(`🔑 Using original socket.id as userId: ${socket.id}`);
          return next();
        } catch (err) {
          console.error("Socket ID override error:", err);
          return next();
        }
      });
    }

    // Use multi-provider auth system
    this.io.use(this.authManager.createMiddleware());
    const enabledProviders = this.authManager.getEnabledProviders();
    console.log(`🔐 Auth Providers: ${enabledProviders.join(", ") || "none"}`);
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
        async (
          data: { userId?: string; token?: string; subscriptions?: any[] },
          callback?
        ) => {
          try {
            // Extract userId using auth module (handles both JWT and legacy mode)
            let userId = getUserIdFromSocket(socket, data.userId);

            // If USE_USERID is true, always use socket.id as userId
            if (process.env.USE_USERID === "true") {
              userId = socket.id;
            }

            // Set it on socket.data for consistency
            if (userId && !socket.data.userId) {
              socket.data.userId = userId;
            }
            if (!userId) {
              if (callback) {
                return callback({ success: false, error: "unauthenticated" });
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

            // Process subscriptions sent with sync:join (NEW: supports FLX subscriptions in join payload)
            let subscriptionVersion: number | undefined;
            if (
              data.subscriptions &&
              Array.isArray(data.subscriptions) &&
              data.subscriptions.length > 0
            ) {
              console.log(
                `📋 [sync:join] Client sent ${data.subscriptions.length} subscriptions in join payload for userId=${userId}`
              );

              // Execute beforeUpdateSubscriptions hooks
              await this.pluginManager.executeBeforeUpdateSubscriptions(
                socket,
                userId,
                data.subscriptions
              );

              // Save subscription set to database
              subscriptionVersion = await this.db.saveSubscriptionSet(
                userId,
                data.subscriptions
              );
              console.log(
                `✅ [sync:join] Saved ${data.subscriptions.length} subscriptions with version=${subscriptionVersion} for userId=${userId}`
              );

              // Store in memory for fast filtering
              const subscriptionSet = await this.db.getSubscriptionSet(userId);
              this.userSubscriptions.set(userId, subscriptionSet);
              console.log(
                `✅ [sync:join] Stored subscriptions in memory for userId=${userId}, total users in map: ${this.userSubscriptions.size}`
              );

              // Bootstrap each subscription with initial data
              for (const sub of data.subscriptions) {
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
                subscriptionVersion
              );
            } else {
              // No subscriptions in join payload - load existing from database (backward compatibility)
              console.log(
                `🔍 [sync:join] No subscriptions in payload, loading from DB for userId=${userId}`
              );
              const subscriptionSet = await this.db.getSubscriptionSet(userId);
              console.log(
                `🔍 [sync:join] getSubscriptionSet result for userId=${userId}:`,
                subscriptionSet
                  ? `Found ${subscriptionSet.subscriptions?.length || 0} subscriptions (version ${subscriptionSet.version})`
                  : "NULL/UNDEFINED"
              );

              // Always store in map, even if null/empty, to mark user as having joined
              // This prevents shouldReceiveChange from always returning true (broadcast-all fallback)
              if (subscriptionSet) {
                this.userSubscriptions.set(userId, subscriptionSet);
                console.log(
                  `✅ [sync:join] Stored subscriptions in memory for userId=${userId}, total users in map: ${this.userSubscriptions.size}`
                );
                // Touch updatedAt to keep active subscriptions alive (prevents TTL deletion)
                await this.db.touchSubscriptionSet(userId);
                console.log(
                  `📋 Loaded ${subscriptionSet.subscriptions?.length || 0} subscriptions for user ${userId}`
                );
                subscriptionVersion = subscriptionSet.version;
              } else {
                // Store empty subscription set to indicate user has joined but has no filters
                const emptySet = {
                  userId,
                  version: 0,
                  subscriptions: [],
                  updatedAt: Date.now(),
                };
                this.userSubscriptions.set(userId, emptySet);
                console.log(
                  `✅ [sync:join] Created empty subscription set for userId=${userId}, total users in map: ${this.userSubscriptions.size}`
                );
                console.log(
                  `📋 No subscriptions found for user ${userId} - using broadcast-all behavior`
                );
                subscriptionVersion = 0;
              }
            }

            console.log(`✅ User ${userId} joined (socket: ${socket.id})`);

            // Execute afterJoin hooks
            await this.pluginManager.executeAfterJoin(socket, userId);

            if (callback) {
              const response = await this.processCallback(
                socket,
                "sync:join",
                {
                  success: true,
                  timestamp: Date.now(),
                  subscriptionVersion: subscriptionVersion,
                },
                data
              );
              callback(response);
            }
            // Also emit a joined event for clients that don't support callbacks
            socket.emit("joined", {
              userId,
              timestamp: Date.now(),
              subscriptionVersion,
            });
          } catch (error: any) {
            console.error("Error joining:", error);
            if (callback) {
              const response = await this.processCallback(
                socket,
                "sync:join",
                { success: false, error: String(error) },
                data
              );
              callback(response);
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
            console.log(
              `🔍 [sync:update_subscriptions] Saving ${request.subscriptions.length} subscriptions for userId=${userId}`
            );
            const version = await this.db.saveSubscriptionSet(
              userId,
              request.subscriptions
            );
            console.log(
              `✅ [sync:update_subscriptions] Saved subscriptions with version=${version} for userId=${userId}`
            );

            // Store in memory for fast filtering
            const subscriptionSet = await this.db.getSubscriptionSet(userId);
            console.log(
              `🔍 [sync:update_subscriptions] Retrieved subscriptionSet from DB:`,
              subscriptionSet
                ? `Found ${subscriptionSet.subscriptions?.length || 0} subscriptions (version ${subscriptionSet.version})`
                : "NULL/UNDEFINED"
            );
            this.userSubscriptions.set(userId, subscriptionSet);
            console.log(
              `✅ [sync:update_subscriptions] Stored in memory for userId=${userId}, total users in map: ${this.userSubscriptions.size}`
            );

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
              const response = await this.processCallback(
                socket,
                "sync:update_subscriptions",
                {
                  success: true,
                  version,
                  timestamp: Date.now(),
                },
                request
              );
              callback(response);
            }

            console.log(
              `✅ Subscriptions updated for user ${userId} (version ${version})`
            );
          } catch (error: any) {
            console.error("Error updating subscriptions:", error);
            if (callback) {
              const response = await this.processCallback(
                socket,
                "sync:update_subscriptions",
                { success: false, error: String(error) },
                request
              );
              callback(response);
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
          // Convert ISO-8601 date strings and wrapped dates to native Date objects
          const convertedData = change.data
            ? convertDatesToNative(change.data)
            : undefined;

          let changeRecord: Change = {
            ...change,
            data: convertedData,
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

          // FLX-aware broadcast: emit to users with matching subscriptions
          // Emit directly to socket IDs to ensure all clients receive changes
          for (const userId of this.activeConnections.keys()) {
            const matchResult = this.subscriptionMatcher.shouldReceiveChange(
              userId,
              changeRecord
            );
            if (matchResult.shouldReceive) {
              const socketIds = this.activeConnections.get(userId);
              if (socketIds) {
                socketIds.forEach(async (socketId) => {
                  // Skip sender if BROADCAST_TO_SENDER is false
                  if (!this.broadcastToSender && socketId === socket.id) {
                    return;
                  }
                  // Apply broadcast processor hook
                  let processedChange = changeRecord;
                  const modifiedChange =
                    await this.pluginManager.executeBroadcastProcessor(
                      socket,
                      changeRecord,
                      userId
                    );
                  if (modifiedChange) {
                    processedChange = modifiedChange;
                  }
                  this.io.to(socketId).emit("sync:changes", [processedChange]);
                });
              }
            }
          }

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
          const response = await this.processCallback(
            socket,
            "sync:change",
            ack,
            change
          );
          callback(response);
        } catch (error: any) {
          console.error("❌ Error processing change:", error);
          const ack: ChangeAck = {
            changeId: change.id,
            success: false,
            error: String(error),
          };
          const response = await this.processCallback(
            socket,
            "sync:change",
            ack,
            change
          );
          callback(response);
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
          // Convert ISO-8601 date strings and wrapped dates to native Date objects
          const normalizedData = convertDatesToNative({ ...update });

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
            const matchResult = this.subscriptionMatcher.shouldReceiveChange(
              userIdKey,
              change
            );
            if (matchResult.shouldReceive) {
              const socketIds = this.activeConnections.get(userIdKey);
              if (socketIds) {
                console.log(
                  `  ✅ Emitting to user ${userIdKey} (${socketIds.size} socket(s)): ${Array.from(socketIds).join(", ")}`
                );
                socketIds.forEach(async (socketId) => {
                  // Skip sender if BROADCAST_TO_SENDER is false
                  if (!this.broadcastToSender && socketId === socket.id) {
                    return;
                  }
                  // Apply broadcast processor hook
                  let processedChange = change;
                  const modifiedChange =
                    await this.pluginManager.executeBroadcastProcessor(
                      socket,
                      change,
                      userIdKey
                    );
                  if (modifiedChange) {
                    processedChange = modifiedChange;
                  }
                  this.io.to(socketId).emit("sync:changes", [processedChange]);
                });
              }
            } else {
              console.log(
                `  ⏭️ Skipping user ${userIdKey} (shouldReceiveChange=false)`
              );
            }
          }

          const latency = Date.now() - startTime;
          console.log(
            `✅ mongoUpsert applied ${collection}/${queryId} in ${latency}ms`
          );

          // Execute afterChange hooks
          await this.pluginManager.executeAfterChange(socket, change);

          if (callback) {
            const response = await this.processCallback(
              socket,
              "mongoUpsert",
              "ok",
              payload
            );
            callback(response);
          }
        } catch (e) {
          console.error("❌ mongoUpsert error", e);
          if (callback) {
            const response = await this.processCallback(
              socket,
              "mongoUpsert",
              "error",
              payload
            );
            callback(response);
          }
        }
      });

      // Compatibility handler for Dart client mongoDelete payloads
      socket.on("mongoDelete", async (payload: any, callback?) => {
        try {
          const startTime = Date.now();
          const collection = payload?.collection;
          const id = payload?.query?._id;
          if (!collection || !id) {
            console.warn(`⚠️ mongoDelete: Missing collection or id`);
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

          console.log(
            `🗑️ Processing mongoDelete: ${collection}/${id} by user ${userId}`
          );

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
            if (callback) {
              const response = await this.processCallback(
                socket,
                "mongoDelete",
                { success: false, error: error.message },
                payload
              );
              callback(response);
            }
            return;
          }

          await this.db.saveChange(change);
          const applyResult = await this.db.applyChange(change);

          if (!applyResult.applied && applyResult.conflict) {
            await this.db.markChangeSynced(change.id);
            console.warn(
              `⚠️ mongoDelete conflict for ${collection}/${id}: ${applyResult.conflict.reason}`
            );
            if (callback) {
              const response = await this.processCallback(
                socket,
                "mongoDelete",
                {
                  success: false,
                  error: "conflict",
                  conflict: applyResult.conflict,
                },
                payload
              );
              callback(response);
            }
            return;
          }

          await this.db.markChangeSynced(change.id);

          // Broadcast delete to all matching users - emit directly to socket IDs
          console.log(
            `📡 Broadcasting mongoDelete to active users: ${Array.from(this.activeConnections.keys()).join(", ")}`
          );
          for (const userIdKey of this.activeConnections.keys()) {
            const matchResult = this.subscriptionMatcher.shouldReceiveChange(
              userIdKey,
              change
            );
            if (matchResult.shouldReceive) {
              const socketIds = this.activeConnections.get(userIdKey);
              if (socketIds) {
                socketIds.forEach(async (socketId) => {
                  // Skip sender if BROADCAST_TO_SENDER is false
                  if (!this.broadcastToSender && socketId === socket.id) {
                    return;
                  }
                  // Apply broadcast processor hook
                  let processedChange = change;
                  const modifiedChange =
                    await this.pluginManager.executeBroadcastProcessor(
                      socket,
                      change,
                      userIdKey
                    );
                  if (modifiedChange) {
                    processedChange = modifiedChange;
                  }
                  this.io.to(socketId).emit("sync:changes", [processedChange]);
                });
              }
            }
          }

          const latency = Date.now() - startTime;
          console.log(
            `✅ mongoDelete applied ${collection}/${id} in ${latency}ms - document deleted from MongoDB`
          );

          // Execute afterChange hooks
          await this.pluginManager.executeAfterChange(socket, change);

          if (callback) {
            const response = await this.processCallback(
              socket,
              "mongoDelete",
              { success: true },
              payload
            );
            callback(response);
          }
        } catch (e) {
          console.error("❌ mongoDelete error", e);
          if (callback) {
            const response = await this.processCallback(
              socket,
              "mongoDelete",
              { success: false, error: String(e) },
              payload
            );
            callback(response);
          }
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
                  const modifiedChange =
                    await this.pluginManager.executeBeforeChange(
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
                      const socketIds = this.activeConnections.get(userIdKey);
                      if (socketIds) {
                        socketIds.forEach(async (socketId) => {
                          // Skip sender if BROADCAST_TO_SENDER is false
                          if (
                            !this.broadcastToSender &&
                            socketId === socket.id
                          ) {
                            return;
                          }
                          // Apply broadcast processor hook
                          let processedChange = changeRecord;
                          const modifiedChange =
                            await this.pluginManager.executeBroadcastProcessor(
                              socket,
                              changeRecord,
                              userIdKey
                            );
                          if (modifiedChange) {
                            processedChange = modifiedChange;
                          }
                          this.io
                            .to(socketId)
                            .emit("sync:changes", [processedChange]);
                        });
                      }
                    }
                  }

                  // Execute afterChange hooks
                  await this.pluginManager.executeAfterChange(
                    socket,
                    changeRecord
                  );

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
                // Convert ISO-8601 date strings and wrapped dates to native Date objects
                const convertedData = convertDatesToNative(data || {});

                let changeRecord: Change = {
                  id: changeId,
                  userId,
                  timestamp: data?.sync_updated_at || Date.now(),
                  operation: "update",
                  collection: collectionName,
                  documentId,
                  data: convertedData,
                  synced: false,
                };

                // Execute beforeChange hooks
                try {
                  const modifiedChange =
                    await this.pluginManager.executeBeforeChange(
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
                      const socketIds = this.activeConnections.get(userIdKey);
                      if (socketIds) {
                        socketIds.forEach(async (socketId) => {
                          // Skip sender if BROADCAST_TO_SENDER is false
                          if (
                            !this.broadcastToSender &&
                            socketId === socket.id
                          ) {
                            return;
                          }
                          // Apply broadcast processor hook
                          let processedChange = changeRecord;
                          const modifiedChange =
                            await this.pluginManager.executeBroadcastProcessor(
                              socket,
                              changeRecord,
                              userIdKey
                            );
                          if (modifiedChange) {
                            processedChange = modifiedChange;
                          }
                          this.io
                            .to(socketId)
                            .emit("sync:changes", [processedChange]);
                        });
                      }
                    }
                  }

                  // Execute afterChange hooks
                  await this.pluginManager.executeAfterChange(
                    socket,
                    changeRecord
                  );

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
            const response = await this.processCallback(
              socket,
              "sync:changeBatch",
              {
                success: true,
                results,
                totalProcessed: changes.length,
                successCount,
                latency,
              },
              payload
            );
            callback(response);
          }
        } catch (e) {
          console.error("❌ changeBatch error", e);
          if (callback) {
            const response = await this.processCallback(
              socket,
              "sync:changeBatch",
              { success: false, error: String(e) },
              payload
            );
            callback(response);
          }
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
              const modifiedChange =
                await this.pluginManager.executeBeforeChange(
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
        // Use individual emits to stay under Azure Pub Sub 1MB limit
        const successfulChanges = changes.filter((_, i) => results[i].success);
        if (successfulChanges.length > 0) {
          for (const userId of this.activeConnections.keys()) {
            // Exclude origin user and filter by subscriptions
            const filtered = successfulChanges.filter(
              (c) =>
                c.userId !== userId &&
                this.subscriptionMatcher.shouldReceiveChange(userId, c)
                  .shouldReceive
            );
            if (filtered.length > 0) {
              const socketIds = this.activeConnections.get(userId);
              if (socketIds) {
                socketIds.forEach(async (socketId) => {
                  // Skip sender if BROADCAST_TO_SENDER is false
                  if (!this.broadcastToSender && socketId === socket.id) {
                    return;
                  }
                  // Emit changes individually to stay under 1MB limit
                  // broadcastProcessor already applied by emitChangesSafely
                  await this.emitChangesSafely(
                    socket,
                    socketId,
                    filtered,
                    userId
                  );
                });
              }
            }
          }
        }

        const response = await this.processCallback(
          socket,
          "sync:batch_changes",
          results,
          changes
        );
        callback(response);
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
              console.log(
                `🔍 [sync:get_changes] Original filter: "${filter}", args:`,
                args
              );
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
              console.log(
                `🔍 [sync:get_changes] After arg substitution: "${finalFilter}"`
              );
              const translated = this.queryTranslator.toMongoQuery(finalFilter);
              console.log(
                `🔍 [sync:get_changes] Translated to MongoDB:`,
                JSON.stringify(translated)
              );
              mongoQuery = { ...mongoQuery, ...translated };
              console.log(
                `🔍 [sync:get_changes] Final MongoDB query:`,
                JSON.stringify(mongoQuery)
              );
            }

            const docs = await this.db.getDocumentsForSubscription(
              collection,
              mongoQuery,
              limit
            );
            console.log(
              `🔍 [sync:get_changes] Found ${docs.length} documents matching query`
            );

            changes = docs.map((d: any) => {
              // Ensure sync_update_db is false to prevent client from re-syncing
              const data = { ...d, sync_update_db: false };
              return {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
                userId: userId || "anonymous",
                timestamp: d.sync_updated_at || Date.now(),
                operation: "update",
                collection,
                documentId: d._id?.toString?.() || d._id,
                data,
                synced: true,
              };
            });
          } else {
            // Fallback to general change log
            changes = await this.db.getChangesSince(userId, since, limit);
          }

          const latestTimestamp =
            changes.length > 0
              ? Math.max(since, ...changes.map((c) => c.timestamp))
              : since;

          // Send changes individually via emit to stay under 1MB limit
          // Then send summary via callback
          if (changes.length > 0) {
            console.log(
              `📥 Emitting ${changes.length} changes individually to user ${userId} (collection=${collection || "*"})`
            );
            await this.emitChangesSafely(socket, socket.id, changes, userId);
          }

          // Send lightweight summary response via callback
          const response = {
            latestTimestamp,
            hasMore: changes.length === limit,
            count: changes.length,
          };

          if (typeof callback === "function") {
            const processedResponse = await this.processCallback(
              socket,
              "sync:get_changes",
              response,
              request
            );
            fs.writeFileSync(
              "./debug_get_changes_response.json",
              JSON.stringify(processedResponse, null, 2)
            );
            callback(processedResponse);
            console.log(
              `✅ Sent summary for ${changes.length} changes to user ${userId} (collection=${collection || "*"})`
            );
          }
        } catch (error: any) {
          console.error("❌ Error fetching changes:", error);
          if (typeof callback === "function") {
            const response = await this.processCallback(
              socket,
              "sync:get_changes",
              {
                latestTimestamp: 0,
                hasMore: false,
                count: 0,
                error: error.message,
              },
              request
            );
            callback(response);
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
            const response = await this.processCallback(
              socket,
              "test:query",
              { success: true, data: result },
              payload
            );
            callback(response);
          }
        } catch (error: any) {
          console.error("❌ Test query error:", error);
          if (typeof callback === "function") {
            const response = await this.processCallback(
              socket,
              "test:query",
              { success: false, error: error.message },
              payload
            );
            callback(response);
          }
        }
      });

      // Handle ping for keepalive (callback optional)
      socket.on("ping", (data?: any, callback?: any) => {
        // Handle both signatures: ping(callback) and ping(data, callback)
        const actualCallback = typeof data === "function" ? data : callback;
        const clientTimestamp = typeof data === "object" ? data?.t : undefined;

        const payload = {
          timestamp: Date.now(),
          clientTimestamp,
          latency: clientTimestamp ? Date.now() - clientTimestamp : undefined,
        };

        if (typeof actualCallback === "function") {
          actualCallback(payload);
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

              const hasSubscriptions = this.userSubscriptions.has(userId);
              console.log(
                `🔍 [disconnect] User ${userId} fully disconnected, hasSubscriptions=${hasSubscriptions}`
              );

              // Schedule memory cleanup after 5 minutes of inactivity
              // This allows quick reconnects without reloading subscriptions from DB
              setTimeout(
                () => {
                  // Check if user reconnected during timeout
                  if (!this.activeConnections.has(userId)) {
                    const hadSubs = this.userSubscriptions.has(userId);
                    this.userSubscriptions.delete(userId);
                    console.log(
                      `🧹 Cleared subscription cache for inactive user: ${userId} (had subscriptions: ${hadSubs})`
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

    // Cleanup auth manager
    if (this.authManager) {
      await this.authManager.cleanup();
    }

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
   * Process callback through plugin system before sending
   */
  private async processCallback(
    socket: Socket,
    eventName: string,
    response: any,
    originalData?: any
  ): Promise<any> {
    return await this.pluginManager.executeCallbackProcessor(
      socket,
      eventName,
      response,
      originalData
    );
  }

  /**
   * Safely emit changes individually to stay under Azure Pub Sub 1MB limit
   * Emits each change as a single-item array to ensure compatibility with client expectations
   */
  private async emitChangesSafely(
    socket: Socket,
    socketId: string,
    changes: Change[],
    targetUserId: string,
    skipSizeCheck: boolean = false
  ): Promise<void> {
    for (const change of changes) {
      // Apply broadcast processor hook (e.g., decryption)
      let processedChange = change;
      const modifiedChange = await this.pluginManager.executeBroadcastProcessor(
        socket,
        change,
        targetUserId
      );
      if (modifiedChange) {
        processedChange = modifiedChange;
      }

      // Ensure sync_update_db is false to prevent client from re-syncing this data
      if (processedChange.data) {
        processedChange.data.sync_update_db = false;
      }

      if (!skipSizeCheck) {
        const estimatedSize = JSON.stringify([processedChange]).length;

        if (estimatedSize > this.maxMessageSize) {
          console.warn(
            `⚠️ Change ${processedChange.id} exceeds max message size (${estimatedSize} bytes > ${this.maxMessageSize} bytes), skipping emission`
          );
          continue;
        }
      }

      // Emit as single-item array for client compatibility
      this.io.to(socketId).emit("sync:changes", [processedChange]);
    }
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

      // Substitute args ($0, $1, ...) into query before translation
      let finalQuery = subscription.query || "";
      if (subscription.args && Array.isArray(subscription.args)) {
        subscription.args.forEach((arg: any, idx: number) => {
          const placeholder = `$${idx}`;
          const value = typeof arg === "string" ? `'${arg}'` : String(arg);
          finalQuery = finalQuery.replace(
            new RegExp(`\\${placeholder}\\b`, "g"),
            value
          );
        });
      }
      // Translate RQL query to MongoDB query
      const mongoQuery = this.queryTranslator.toMongoQuery(finalQuery);

      console.log(
        `🔄 Bootstrapping subscription: ${subscription.name || subscription.collection} (query: ${finalQuery})`
      );

      // Fetch initial data
      // const documents = await this.db.getDocumentsForSubscription(
      //   subscription.collection,
      //   mongoQuery,
      //   this.bootstrapLimit // Limit initial bootstrap (env configurable)
      // );

      // // Send bootstrap data
      // const bootstrapData: BootstrapData = {
      //   subscription: subscription.name || subscription.collection,
      //   collection: subscription.collection,
      //   data: documents,
      //   hasMore: documents.length >= this.bootstrapLimit,
      // };

      // socket.emit("sync:bootstrap", bootstrapData);

      // Mark subscription as complete
      await this.db.updateSubscriptionState(
        userId,
        subscription.id || subscription.collection,
        "complete"
      );

      // console.log(
      //   `✅ Bootstrapped ${documents.length} documents for subscription ${subscription.name || subscription.collection}`
      // );
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
   * @deprecated Use subscriptionMatcher.shouldReceiveChange() instead
   * Legacy method kept for backward compatibility
   */
  private shouldReceiveChange(userId: string, change: Change): boolean {
    return this.subscriptionMatcher.shouldReceiveChange(userId, change)
      .shouldReceive;
  }
}
