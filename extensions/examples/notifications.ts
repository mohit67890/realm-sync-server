import { SyncServerPlugin } from "../plugin-types";
import { Socket } from "socket.io";

/**
 * Example plugin: Notification system
 */
export const notificationPlugin: SyncServerPlugin = {
  name: "notifications",
  version: "1.0.0",
  description: "Sends real-time notifications to users",

  hooks: {
    afterChange: async (socket: Socket, change) => {
      // Example: Send notification when someone mentions a user
      if (
        change.collection === "messages" &&
        change.data?.mentions &&
        Array.isArray(change.data.mentions)
      ) {
        // In a real implementation, emit to mentioned users
        console.log(
          `🔔 [Notifications] Mentions detected: ${change.data.mentions.join(", ")}`
        );
      }
    },
  },

  customEvents: [
    {
      event: "notification:send",
      handler: async (socket, data, callback) => {
        const { userId, title, message } = data;

        if (!userId || !message) {
          callback?.({ success: false, error: "Missing required fields" });
          return;
        }

        console.log(`🔔 [Notifications] Sending to ${userId}: ${title}`);

        // Emit notification to target user
        socket.to(`user:${userId}`).emit("notification:received", {
          title,
          message,
          timestamp: Date.now(),
        });

        callback?.({ success: true, sent: true });
      },
    },

    {
      event: "notification:broadcast",
      handler: async (socket, data, callback) => {
        const { title, message } = data;

        console.log(`🔔 [Notifications] Broadcasting: ${title}`);

        // Broadcast to all connected users
        socket.broadcast.emit("notification:received", {
          title,
          message,
          timestamp: Date.now(),
        });

        callback?.({ success: true, broadcast: true });
      },
    },
  ],
};
