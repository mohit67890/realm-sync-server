import { SyncServerPlugin } from "../plugin-types";
import { Socket } from "socket.io";

/**
 * Example plugin: Analytics tracker
 */
export const analyticsPlugin: SyncServerPlugin = {
  name: "analytics",
  version: "1.0.0",
  description: "Tracks user activity and usage metrics",

  initialize: async (context) => {
    console.log("📊 Analytics plugin initialized");

    // Add a custom REST endpoint for analytics dashboard
    context.app.get("/analytics/stats", async (req, res) => {
      res.json({
        totalUsers: context.activeConnections.size,
        totalSubscriptions: context.userSubscriptions.size,
        timestamp: Date.now(),
      });
    });
  },

  hooks: {
    afterJoin: async (socket: Socket, userId: string) => {
      // Track user login event
      console.log(`📊 [Analytics] User ${userId} session started`);
    },

    afterChange: async (socket: Socket, change) => {
      // Track data modification metrics
      console.log(
        `📊 [Analytics] Operation: ${change.operation} on ${change.collection}`
      );
    },
  },

  customEvents: [
    {
      event: "analytics:track_event",
      handler: async (socket, data, callback) => {
        // Custom analytics event from client
        const { eventName, properties } = data;
        console.log(`📊 [Analytics] Custom event: ${eventName}`, properties);
        callback?.({ success: true, tracked: true });
      },
    },
  ],

  cleanup: async (context) => {
    console.log("📊 Analytics plugin cleanup complete");
  },
};
