/**
 * Complete example demonstrating how to use the plugin system
 *
 * This file shows:
 * 1. How to create custom plugins
 * 2. How to register plugins
 * 3. How to use all available hooks
 * 4. How to add custom socket events
 * 5. How to add REST endpoints
 */

import * as dotenv from "dotenv";
dotenv.config();

import { SyncServer } from "./sync-server";
import {
  AuthManager,
  AuthStrategy,
  createJWTProviderFromEnv,
  createFirebaseProviderFromEnv,
} from "../shared/auth-index";
import { SyncServerPlugin } from "../extensions/plugin-types";
import { Socket } from "socket.io";
import { Change } from "../shared/types";

// ============================================================================
// Example Plugin 1: Permission System
// ============================================================================

const permissionPlugin: SyncServerPlugin = {
  name: "permissions",
  version: "1.0.0",
  description: "Enforces collection-level permissions",

  // Store user permissions (in production, load from database)
  initialize: async (context) => {
    console.log("🔐 Permission system initialized");

    // Example: Add endpoint to grant permissions
    context.app.post("/api/permissions/grant", (req, res) => {
      const { userId, collection, permission } = req.body;
      // In production: Save to database
      res.json({ success: true, userId, collection, permission });
    });
  },

  hooks: {
    // Check permissions before allowing changes
    beforeChange: async (socket: Socket, change: Change) => {
      const userId = socket.data.userId || "anonymous";

      // Example: Only allow users to modify their own data
      if (change.collection === "user_profiles") {
        if (change.documentId !== userId) {
          throw new Error("Permission denied: Can only modify own profile");
        }
      }

      // Example: Prevent deletion of system collections
      if (
        change.collection === "system_config" &&
        change.operation === "delete"
      ) {
        throw new Error("Permission denied: Cannot delete system config");
      }

      return change;
    },

    // Log permission checks
    afterChange: async (socket: Socket, change: Change) => {
      console.log(
        `✅ Permission granted for ${change.userId} on ${change.collection}`
      );
    },
  },

  customEvents: [
    {
      event: "permissions:check",
      handler: async (socket, data, callback) => {
        const { collection, operation } = data;
        const userId = socket.data.userId;

        // In production: Check database
        const hasPermission = true; // Simplified

        callback?.({
          success: true,
          hasPermission,
          userId,
          collection,
          operation,
        });
      },
    },
  ],
};

// ============================================================================
// Example Plugin 2: Real-time Presence
// ============================================================================

const presencePlugin: SyncServerPlugin = {
  name: "presence",
  version: "1.0.0",
  description: "Tracks which users are currently online",

  initialize: async (context) => {
    console.log("👥 Presence tracking initialized");

    // Add endpoint to get online users
    context.app.get("/api/presence/online", (req, res) => {
      const onlineUsers = Array.from(context.activeConnections.keys());
      res.json({
        success: true,
        count: onlineUsers.length,
        users: onlineUsers,
      });
    });
  },

  hooks: {
    afterJoin: async (socket: Socket, userId: string) => {
      // Broadcast user online status
      socket.broadcast.emit("presence:user_online", {
        userId,
        timestamp: Date.now(),
      });

      console.log(`👋 User ${userId} is now online`);
    },

    onDisconnect: async (socket: Socket, userId?: string) => {
      if (userId) {
        // Broadcast user offline status
        socket.broadcast.emit("presence:user_offline", {
          userId,
          timestamp: Date.now(),
        });

        console.log(`👋 User ${userId} is now offline`);
      }
    },
  },

  customEvents: [
    {
      event: "presence:set_status",
      handler: async (socket, data, callback) => {
        const { status } = data; // e.g., "active", "away", "busy"
        const userId = socket.data.userId;

        // Broadcast status change
        socket.broadcast.emit("presence:status_changed", {
          userId,
          status,
          timestamp: Date.now(),
        });

        console.log(`📊 User ${userId} status: ${status}`);
        callback?.({ success: true, status });
      },
    },

    {
      event: "presence:typing",
      handler: async (socket, data, callback) => {
        const { roomId, isTyping } = data;
        const userId = socket.data.userId;

        // Broadcast typing indicator to room
        socket.to(`room:${roomId}`).emit("presence:typing_indicator", {
          userId,
          roomId,
          isTyping,
        });

        callback?.({ success: true });
      },
      rateLimit: 20, // Limit typing indicators to prevent spam
    },
  ],
};

// ============================================================================
// Example Plugin 3: Activity Feed
// ============================================================================

const activityFeedPlugin: SyncServerPlugin = {
  name: "activity-feed",
  version: "1.0.0",
  description: "Creates an activity feed from all changes",

  initialize: async (context) => {
    console.log("📰 Activity feed initialized");

    // Add endpoint to get recent activity
    context.app.get("/api/activity/recent", async (req, res) => {
      const limit = parseInt(req.query.limit as string) || 20;

      // Query recent changes from database
      const activities = await context.db
        .getCollection("_sync_changes")
        .find({ synced: true })
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();

      res.json({ success: true, activities });
    });
  },

  hooks: {
    afterChange: async (socket: Socket, change: Change) => {
      // Create activity feed entry
      const activity = {
        id: change.id,
        userId: change.userId,
        action: change.operation,
        collection: change.collection,
        documentId: change.documentId,
        timestamp: change.timestamp,
        // Add human-readable message
        message: `${change.userId} ${change.operation}d a ${change.collection}`,
      };

      // Broadcast to all users (or specific feeds based on subscriptions)
      socket.broadcast.emit("activity:new", activity);
    },
  },

  customEvents: [
    {
      event: "activity:subscribe",
      handler: async (socket, data, callback) => {
        const { collection } = data;

        // Subscribe to activity feed for specific collection
        socket.join(`activity:${collection}`);

        console.log(`📰 User subscribed to ${collection} activity feed`);
        callback?.({ success: true, collection });
      },
    },
  ],
};

// ============================================================================
// Example Plugin 4: Change Stream Logger
// ============================================================================

const changeStreamLoggerPlugin: SyncServerPlugin = {
  name: "change-stream-logger",
  version: "1.0.0",
  description: "Logs detailed change streams for debugging",

  hooks: {
    beforeChange: async (socket: Socket, change: Change) => {
      console.log("📝 [BEFORE] Change:", {
        operation: change.operation,
        collection: change.collection,
        documentId: change.documentId,
        userId: change.userId,
        dataKeys: Object.keys(change.data || {}),
      });

      return change; // No modification
    },

    afterChange: async (socket: Socket, change: Change) => {
      console.log("✅ [AFTER] Change applied:", {
        id: change.id,
        timestamp: change.timestamp,
        synced: change.synced,
      });
    },
  },

  customEvents: [
    {
      event: "debug:get_change_log",
      handler: async (socket, data, callback) => {
        const { collection, limit = 10 } = data;

        // Query change log
        const logs = await (socket as any).server.db
          .getCollection("_sync_changes")
          .find({ collection })
          .sort({ timestamp: -1 })
          .limit(limit)
          .toArray();

        callback?.({ success: true, logs });
      },
    },
  ],
};

// ============================================================================
// Main Server Setup
// ============================================================================

async function main() {
  // Validate environment variables
  const required = [
    "MONGODB_URI",
    "WEB_PUBSUB_CONNECTION_STRING",
    "WEB_PUBSUB_HUB_NAME",
  ];

  for (const key of required) {
    if (!process.env[key]) {
      console.error(`❌ Missing required environment variable: ${key}`);
      process.exit(1);
    }
  }

  // Configure provider-based authentication
  const authManager = new AuthManager({
    strategy: AuthStrategy.FIRST_SUCCESS,
    allowAnonymous: process.env.NODE_ENV !== "production",
    requireAuthInProduction: true,
    env: process.env.NODE_ENV,
  });
  authManager.registerProvider(createJWTProviderFromEnv());
  authManager.registerProvider(createFirebaseProviderFromEnv());
  await authManager.initialize();

  // Create server instance
  const server = new SyncServer(
    process.env.MONGODB_URI!,
    process.env.WEB_PUBSUB_CONNECTION_STRING!,
    process.env.WEB_PUBSUB_HUB_NAME!,
    parseInt(process.env.PORT || "3000"),
    authManager
  );

  // Register all plugins
  console.log("\n📦 Registering plugins...\n");

  server.registerPlugin(permissionPlugin);
  server.registerPlugin(presencePlugin);
  server.registerPlugin(activityFeedPlugin);
  server.registerPlugin(changeStreamLoggerPlugin);

  // Optionally register example plugins from extensions/examples
  // import { auditLoggerPlugin, analyticsPlugin } from "./extensions/examples";
  // server.registerPlugin(auditLoggerPlugin);
  // server.registerPlugin(analyticsPlugin);

  console.log("\n🚀 Starting server with plugins...\n");

  // Start server
  await server.start();

  console.log("\n✅ Server is ready with the following plugins:");
  const plugins = server.getPluginManager().getPlugins();
  plugins.forEach((plugin) => {
    console.log(
      `   - ${plugin.name} v${plugin.version}: ${plugin.description}`
    );
  });

  console.log("\n📚 Available custom events:");
  const customHandlers = server.getPluginManager().getCustomEventHandlers();
  customHandlers.forEach((handler) => {
    console.log(
      `   - ${handler.event}${handler.rateLimit ? ` (rate limited: ${handler.rateLimit})` : ""}`
    );
  });

  console.log("\n");
}

// Run server
main().catch((error) => {
  console.error("❌ Failed to start server:", error);
  process.exit(1);
});
