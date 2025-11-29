import { SyncServerPlugin } from "../plugin-types";
import { Socket } from "socket.io";

/**
 * Example plugin: Audit logger that tracks all sync operations
 */
export const auditLoggerPlugin: SyncServerPlugin = {
  name: "audit-logger",
  version: "1.0.0",
  description: "Logs all sync operations for audit purposes",

  hooks: {
    afterJoin: async (socket: Socket, userId: string) => {
      console.log(
        `[AUDIT] User ${userId} joined from ${socket.handshake.address}`
      );
    },

    afterChange: async (socket: Socket, change) => {
      console.log(
        `[AUDIT] ${change.operation} on ${change.collection}/${change.documentId} by ${change.userId}`
      );
    },

    onDisconnect: async (socket: Socket, userId) => {
      if (userId) {
        console.log(`[AUDIT] User ${userId} disconnected`);
      }
    },
  },

  customEvents: [
    {
      event: "audit:get_logs",
      handler: async (socket, data, callback) => {
        // In a real implementation, you'd query your audit log database
        const logs = [
          { timestamp: Date.now(), action: "example", userId: "demo" },
        ];
        callback?.({ success: true, logs });
      },
    },
  ],
};
