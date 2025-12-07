import { Express, Request, Response } from "express";
import { WebPubSubServiceClient } from "@azure/web-pubsub";
import { Database } from "./database";
import { SubscriptionMatcher } from "../shared/subscription-matcher";
import { convertDatesToNative } from "../shared/utils";

/**
 * Route configuration context passed to route setup functions
 */
export interface RouteContext {
  app: Express;
  db: Database;
  webPubSubClient: WebPubSubServiceClient;
  version: string;
  activeConnections: Map<string, Set<string>>;
  userSubscriptions: Map<string, any>;
  io?: any; // Socket.IO server instance for broadcasting
  queryTranslator?: any; // QueryTranslator for subscription matching
  broadcastToSender?: boolean; // Whether to broadcast changes back to sender
}

/**
 * Default HTTP routes for the sync server
 * Users can extend or override these routes by providing custom setup functions
 */
export class SyncServerRoutes {
  /**
   * Setup default routes for health checks, stats, and negotiate
   */
  static setupDefaultRoutes(context: RouteContext): void {
    const { app, db, webPubSubClient, version, activeConnections } = context;

    // Health check endpoint
    app.get("/health", (req: Request, res: Response) => {
      res.json({
        status: "healthy",
        timestamp: Date.now(),
        activeConnections: activeConnections.size,
        version,
      });
    });

    // Ready check endpoint (checks database connection)
    app.get("/ready", (req: Request, res: Response) => {
      const ready = db.isConnected();
      if (!ready) {
        return res.status(503).json({ status: "starting", version });
      }
      res.json({ status: "ready", version });
    });

    // Stats endpoint (requires database access)
    app.get("/stats", async (req: Request, res: Response) => {
      try {
        const stats = await db.getStats();
        res.json({
          ...stats,
          activeConnections: activeConnections.size,
          activeUsers: Array.from(activeConnections.keys()),
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Web PubSub negotiate endpoint (generates access tokens)
    app.get("/api/negotiate", async (req: Request, res: Response) => {
      try {
        const userId = (req.query.userId as string) || undefined;
        if (!userId) {
          return res.status(400).json({ error: "Missing user identity" });
        }
        const token = await webPubSubClient.getClientAccessToken({
          userId,
          roles: ["webpubsub.sendToGroup", "webpubsub.joinLeaveGroup"],
        });
        res.json({ url: token.url, token: token.token });
      } catch (error: any) {
        console.error("Error generating token:", error);
        res.status(500).json({ error: "Failed to generate token" });
      }
    });

    // REST endpoint for submitting changes (alternative to WebSocket)
    app.post("/api/sync/change", async (req: Request, res: Response) => {
      const startTime = Date.now();

      try {
        const change = req.body;
        const emitTo = change.emitTo as string[] | undefined; // Optional list of userIds to emit to

        // Validate required fields
        if (
          !change ||
          !change.id ||
          !change.collection ||
          !change.documentId ||
          !change.operation
        ) {
          return res.status(400).json({
            success: false,
            error:
              "Missing required fields: id, collection, documentId, operation",
          });
        }

        // Extract userId from request (query param, header, or body)
        const userId =
          (req.query.userId as string) ||
          (req.headers["x-user-id"] as string) ||
          change.userId ||
          "anonymous";

        const timestamp = Date.now();

        // Ensure data includes sync_updated_at for conflict resolution
        const dataWithTimestamp = change.data
          ? {
              ...change.data,
              sync_updated_at: change.data.sync_updated_at || timestamp,
            }
          : undefined;

        // Build change record
        let changeRecord: any = {
          id: change.id,
          userId,
          timestamp: change.data?.sync_updated_at || timestamp, // Use client timestamp if provided
          operation: change.operation,
          collection: change.collection,
          documentId: change.documentId,
          data: dataWithTimestamp,
          synced: false,
        };

        console.log(
          `📝 REST API - Processing change: ${change.operation} on ${change.collection}/${change.documentId} (timestamp: ${changeRecord.timestamp})`
        );

        console.log(change);

        // Save to change log
        await db.saveChange(convertDatesToNative(changeRecord));

        // Apply change to actual data collection (with conflict detection)
        const applyResult = await db.applyChange(
          convertDatesToNative(changeRecord)
        );

        if (!applyResult.applied && applyResult.conflict) {
          // Conflict detected - inform client
          const latency = Date.now() - startTime;
          console.warn(
            `⚠️ REST API - Conflict detected, rejecting change in ${latency}ms`
          );

          return res.status(409).json({
            success: false,
            error: `conflict: ${applyResult.conflict.reason}`,
            conflict: applyResult.conflict,
            timestamp,
            latency,
          });
        }

        // Mark as synced (only if successfully applied)
        await db.markChangeSynced(changeRecord.id);

        // Real-time broadcast to connected Socket.IO clients
        if (context.io && activeConnections) {
          const { io, userSubscriptions, queryTranslator, broadcastToSender } =
            context;

          console.log(`📡 REST API - Broadcasting change to active users`);

          // Initialize subscription matcher with shared logic
          const subscriptionMatcher = new SubscriptionMatcher({
            userSubscriptions,
            activeConnections,
            queryTranslator,
            io,
          });

          // Determine target users for broadcast
          let targetUserIds: string[];
          if (emitTo && Array.isArray(emitTo) && emitTo.length > 0) {
            // Specific users requested
            targetUserIds = emitTo;
            console.log(
              `  🎯 Targeting specific users: ${targetUserIds.join(", ")}`
            );
          } else {
            // Broadcast to all connected users with matching subscriptions
            targetUserIds = Array.from(activeConnections.keys());
            console.log(
              `  📢 Broadcasting to all active users: ${targetUserIds.length} users`
            );
          }

          // Emit to target users using shared subscription matcher
          for (const targetUserId of targetUserIds) {
            const matchResult = subscriptionMatcher.shouldReceiveChange(
              targetUserId,
              changeRecord
            );

            if (matchResult.shouldReceive) {
              const socketIds = activeConnections.get(targetUserId);
              if (socketIds) {
                socketIds.forEach((socketId: string) => {
                  // Skip sender if broadcastToSender is false
                  if (!broadcastToSender && userId === targetUserId) {
                    return;
                  }

                  io.to(socketId).emit("sync:changes", [
                    convertDatesToNative(changeRecord),
                  ]);
                  console.log(
                    `    ✅ Emitted to socket ${socketId} (user: ${targetUserId}) - ${matchResult.reason}`
                  );
                });
              }
            } else {
              console.log(
                `    ⏭️ Skipping user ${targetUserId} - ${matchResult.reason}`
              );
            }
          }
        }

        const latency = Date.now() - startTime;
        console.log(`✅ REST API - Change applied in ${latency}ms`);

        res.json({
          success: true,
          changeId: change.id,
          timestamp,
          latency,
        });
      } catch (error: any) {
        const latency = Date.now() - startTime;
        console.error("❌ REST API - Error processing change:", error);

        res.status(500).json({
          success: false,
          error: String(error),
          latency,
        });
      }
    });
  }

  /**
   * Example: Custom route setup function
   * Users can create similar functions to add their own routes
   */
  static setupCustomRoutes(context: RouteContext): void {
    const { app, db } = context;

    // Example: Custom metrics endpoint
    app.get("/api/metrics", async (req: Request, res: Response) => {
      try {
        // Add your custom metrics logic here
        res.json({
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          timestamp: Date.now(),
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Example: Custom admin endpoint
    app.post("/api/admin/clear-cache", async (req: Request, res: Response) => {
      try {
        // Add your custom admin logic here
        res.json({ success: true, message: "Cache cleared" });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  }
}

/**
 * Type definition for custom route setup functions
 */
export type RouteSetupFunction = (context: RouteContext) => void;

/**
 * Example: User-defined custom routes
 *
 * Usage in server initialization:
 * ```typescript
 * const customRoutes: RouteSetupFunction = (context) => {
 *   const { app, db, version } = context;
 *
 *   app.get("/api/custom", (req, res) => {
 *     res.json({ message: "Custom route", version });
 *   });
 *
 *   app.post("/api/webhook", async (req, res) => {
 *     // Handle webhook
 *     res.json({ success: true });
 *   });
 * };
 *
 * const server = new SyncServer(mongoUri, webPubSubConn, hubName, port, authManager);
 * server.setCustomRoutes(customRoutes);
 * await server.start();
 * ```
 */
