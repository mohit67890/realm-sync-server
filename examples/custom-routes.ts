/**
 * Example: Custom Routes for Sync Server
 *
 * This file demonstrates how to extend the sync server with custom HTTP routes.
 * Copy this file and modify it according to your requirements.
 */

import { RouteSetupFunction } from "../server/routes";

/**
 * Example 1: Add custom metrics and monitoring endpoints
 */
export const metricsRoutes: RouteSetupFunction = (context) => {
  const { app, db, activeConnections } = context;

  // Custom metrics endpoint with detailed stats
  app.get("/api/metrics", async (req, res) => {
    try {
      const stats = await db.getStats();
      const metrics = {
        ...stats,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        activeConnections: activeConnections.size,
        activeUsers: Array.from(activeConnections.keys()).length,
        timestamp: Date.now(),
      };
      res.json(metrics);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // User-specific connection info
  app.get("/api/connections/:userId", (req, res) => {
    const { userId } = req.params;
    const connections = activeConnections.get(userId);

    if (!connections) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      userId,
      socketIds: Array.from(connections),
      count: connections.size,
    });
  });
};

/**
 * Example 2: Admin endpoints for server management
 */
export const adminRoutes: RouteSetupFunction = (context) => {
  const { app, db, activeConnections, userSubscriptions } = context;

  // Middleware for admin authentication (replace with your own logic)
  const requireAdmin = (req: any, res: any, next: any) => {
    const apiKey = req.headers["x-admin-key"];
    if (apiKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };

  // List all active users
  app.get("/api/admin/users", requireAdmin, (req, res) => {
    const users = Array.from(activeConnections.entries()).map(
      ([userId, sockets]) => ({
        userId,
        connectionCount: sockets.size,
        socketIds: Array.from(sockets),
      })
    );
    res.json({ users, total: users.length });
  });

  // Force disconnect a user
  app.post("/api/admin/disconnect/:userId", requireAdmin, async (req, res) => {
    const { userId } = req.params;
    const connections = activeConnections.get(userId);

    if (!connections) {
      return res.status(404).json({ error: "User not found" });
    }

    // Disconnect all sockets for this user
    // Note: You'll need to pass io to context for this to work
    res.json({
      success: true,
      message: `Disconnected ${connections.size} connections for user ${userId}`,
    });
  });

  // Clear old data
  app.post("/api/admin/cleanup", requireAdmin, async (req, res) => {
    try {
      const days = parseInt(req.body.days) || 30;
      const deletedCount = await db.cleanupOldChanges(days);
      res.json({ success: true, deletedCount, days });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
};

/**
 * Example 3: Webhook endpoints for external integrations
 */
export const webhookRoutes: RouteSetupFunction = (context) => {
  const { app, db } = context;

  // Webhook for external system notifications
  app.post("/api/webhooks/notify", async (req, res) => {
    try {
      const { userId, event, data } = req.body;

      // Validate webhook signature (implement your own logic)
      const signature = req.headers["x-webhook-signature"];
      if (!validateWebhookSignature(signature as string, req.body)) {
        return res.status(401).json({ error: "Invalid signature" });
      }

      // Process webhook event
      console.log(`📨 Webhook received: ${event} for user ${userId}`);

      // You can create changes, send notifications, etc.
      res.json({ success: true, processed: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Bulk import endpoint
  app.post("/api/webhooks/import", async (req, res) => {
    try {
      const { collection, documents } = req.body;

      if (!collection || !Array.isArray(documents)) {
        return res.status(400).json({ error: "Invalid request" });
      }

      // Bulk insert documents
      const result = await db.getCollection(collection).insertMany(documents);

      res.json({
        success: true,
        inserted: result.insertedCount,
        collection,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
};

/**
 * Example 4: Combine multiple route sets
 */
export const allCustomRoutes: RouteSetupFunction = (context) => {
  metricsRoutes(context);
  adminRoutes(context);
  webhookRoutes(context);

  console.log("✅ Custom routes loaded: metrics, admin, webhooks");
};

// Helper function (implement your own signature validation)
function validateWebhookSignature(signature: string, body: any): boolean {
  // Implement HMAC signature validation
  // Example: crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex') === signature
  return true; // Placeholder
}

/**
 * Usage in your server initialization:
 *
 * ```typescript
 * import { allCustomRoutes } from './examples/custom-routes';
 *
 * const server = new SyncServer(mongoUri, webPubSubConn, hubName, port, authManager);
 * server.setCustomRoutes(allCustomRoutes);
 * await server.start();
 * ```
 */
