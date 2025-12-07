/**
 * Example: Privacy Filter Plugin
 *
 * This plugin demonstrates how to use the broadcastProcessor hook
 * to filter sensitive data based on the recipient user.
 */

import { SyncServerPlugin } from "../../extensions/plugin-types";
import { Change } from "../../shared/types";

/**
 * Simple privacy filter that redacts email addresses for non-admin users
 */
export const privacyFilterPlugin: SyncServerPlugin = {
  name: "privacy-filter",
  version: "1.0.0",
  description: "Filters sensitive user data based on recipient permissions",

  hooks: {
    /**
     * Transform changes before broadcasting to specific users
     */
    broadcastProcessor: async (socket, change, targetUserId) => {
      console.log(
        `🔒 [PrivacyFilter] Processing broadcast for user: ${targetUserId}`
      );

      // Example: Filter user data
      if (
        change.collection === "users" &&
        (change.operation === "insert" || change.operation === "update")
      ) {
        const modifiedChange = { ...change };

        // Check if the target user is the document owner
        const isOwner = change.data?.userId === targetUserId;

        if (!isOwner && change.data) {
          // Redact sensitive fields for non-owners
          modifiedChange.data = {
            ...change.data,
            email: "***@***.**",
            phone: "***-***-****",
            address: undefined, // Remove completely
          };

          console.log(
            `  → Redacted sensitive fields for non-owner user ${targetUserId}`
          );
        } else {
          console.log(`  → No redaction needed (owner or admin)`);
        }

        return modifiedChange;
      }

      // No transformation needed for other collections
      return change;
    },
  },
};

/**
 * Example: Add user-specific metadata
 */
export const enrichmentPlugin: SyncServerPlugin = {
  name: "data-enrichment",
  version: "1.0.0",
  description: "Adds user-specific computed fields to changes",

  hooks: {
    broadcastProcessor: async (socket, change, targetUserId) => {
      console.log(`✨ [Enrichment] Adding metadata for user: ${targetUserId}`);

      // Example: Add "isAuthor" flag to posts
      if (
        change.collection === "posts" &&
        (change.operation === "insert" || change.operation === "update") &&
        change.data
      ) {
        const isAuthor = change.data.authorId === targetUserId;

        return {
          ...change,
          data: {
            ...change.data,
            isAuthor, // User-specific computed field
            receivedAt: new Date().toISOString(), // Add timestamp
          },
        };
      }

      return change;
    },
  },
};

/**
 * Example: Block changes from certain users
 */
export const blockListPlugin: SyncServerPlugin = {
  name: "blocklist",
  version: "1.0.0",
  description: "Prevents users from receiving changes from blocked users",

  hooks: {
    broadcastProcessor: async (socket, change, targetUserId) => {
      // Get sender's user ID
      const senderId =
        socket.data.userId ||
        socket.handshake.query.uuid ||
        socket.handshake.query.userId;

      if (!senderId) {
        return change; // Can't determine sender, allow
      }

      // Check if target user has blocked the sender
      const isBlocked = await checkIfBlocked(targetUserId, senderId as string);

      if (isBlocked) {
        console.log(
          `🚫 [Blocklist] User ${targetUserId} blocked sender ${senderId}`
        );
        // Return void to prevent broadcasting
        return undefined;
      }

      return change;
    },
  },
};

/**
 * Mock function to check if a user is blocked
 * In production, this would query your database
 */
async function checkIfBlocked(
  userId: string,
  blockedUserId: string
): Promise<boolean> {
  // Example implementation - replace with real database query
  // const blocklist = await db.collection("blocklists").findOne({ userId });
  // return blocklist?.blockedUsers?.includes(blockedUserId) || false;
  return false;
}

/**
 * Example: Audit logging for callbacks
 */
export const auditLogPlugin: SyncServerPlugin = {
  name: "audit-log",
  version: "1.0.0",
  description: "Logs callback responses for auditing purposes",

  hooks: {
    callbackProcessor: async (socket, eventName, response, originalData) => {
      const userId =
        socket.data.userId ||
        socket.handshake.query.uuid ||
        socket.handshake.query.userId;

      console.log(`📊 [Audit] User ${userId} - Event: ${eventName}`, {
        response,
        originalData,
        timestamp: new Date().toISOString(),
      });

      // Return response unchanged
      return response;
    },
  },
};

/**
 * Example: Add metadata to all callback responses
 */
export const responseEnrichmentPlugin: SyncServerPlugin = {
  name: "response-enrichment",
  version: "1.0.0",
  description: "Adds metadata to callback responses",

  hooks: {
    callbackProcessor: async (socket, eventName, response, originalData) => {
      // Only enrich object responses, not strings like "ok" or "error"
      if (typeof response === "object" && response !== null) {
        return {
          ...response,
          _meta: {
            eventName,
            timestamp: Date.now(),
            serverVersion: "1.0.0",
          },
        };
      }

      return response;
    },
  },
};

/**
 * Example: Error transformation for callbacks
 */
export const errorTransformPlugin: SyncServerPlugin = {
  name: "error-transform",
  version: "1.0.0",
  description: "Transforms error responses to a consistent format",

  hooks: {
    callbackProcessor: async (socket, eventName, response, originalData) => {
      // Transform "error" string responses to structured error objects
      if (response === "error") {
        return {
          success: false,
          error: {
            code: "OPERATION_FAILED",
            message: `Failed to process ${eventName}`,
            timestamp: Date.now(),
          },
        };
      }

      // Transform "ok" to success object
      if (response === "ok") {
        return {
          success: true,
          timestamp: Date.now(),
        };
      }

      return response;
    },
  },
};

// Export all example plugins
export const exampleBroadcastPlugins = [
  privacyFilterPlugin,
  enrichmentPlugin,
  blockListPlugin,
];

export const exampleCallbackPlugins = [
  auditLogPlugin,
  responseEnrichmentPlugin,
  errorTransformPlugin,
];

export const allExamplePlugins = [
  ...exampleBroadcastPlugins,
  ...exampleCallbackPlugins,
];
