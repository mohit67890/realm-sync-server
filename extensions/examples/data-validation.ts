import { SyncServerPlugin } from "../plugin-types";
import { Socket } from "socket.io";
import { Change } from "../../shared/types";

/**
 * Example plugin: Data validation middleware
 */
export const dataValidationPlugin: SyncServerPlugin = {
  name: "data-validation",
  version: "1.0.0",
  description: "Validates data before changes are applied",

  hooks: {
    beforeChange: async (socket: Socket, change: Change) => {
      // Example: Validate that user data has required fields
      if (change.collection === "users" && change.operation !== "delete") {
        const data = change.data || {};

        if (!data.email || !data.name) {
          throw new Error(
            "Validation failed: users must have email and name fields"
          );
        }

        // Example: Sanitize email
        if (typeof data.email === "string") {
          data.email = data.email.toLowerCase().trim();
        }

        // Return modified change
        return { ...change, data };
      }

      // No modification needed
      return change;
    },
  },

  customEvents: [
    {
      event: "validate:schema",
      handler: async (socket, data, callback) => {
        const { collection, document } = data;

        // In a real implementation, check against JSON schema
        const isValid = collection && document;

        callback?.({
          success: true,
          isValid,
          errors: isValid ? [] : ["Missing collection or document"],
        });
      },
    },
  ],
};
