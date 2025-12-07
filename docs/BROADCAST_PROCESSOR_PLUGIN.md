# Broadcast Processor Plugin Hook

## Overview

The `broadcastProcessor` plugin hook allows you to transform change data before it is broadcasted to specific users. This is useful for:

- **Filtering sensitive fields** based on recipient permissions
- **Adding computed properties** specific to each user
- **Customizing data** based on user context or preferences
- **Implementing field-level access control**
- **Enriching changes** with user-specific metadata

## Hook Signature

```typescript
broadcastProcessor?: (
  socket: Socket,
  change: Change,
  targetUserId: string
) => Promise<Change | void> | Change | void;
```

### Parameters

- **socket**: The Socket.IO socket of the sender who initiated the change
- **change**: The change record being broadcasted
- **targetUserId**: The ID of the user who will receive this change

### Return Value

- Return a **modified `Change` object** to transform the data before broadcasting
- Return `void` or `undefined` to broadcast the original change unchanged

## When It Runs

The `broadcastProcessor` hook is called:

1. **Before every broadcast** to individual users via `this.io.to(socketId).emit("sync:changes", ...)`
2. **For transient subscriptions** when broadcasting to specific sockets
3. **Once per recipient** - if a change goes to 5 users, the hook runs 5 times (once per user)

## Broadcast Locations

The hook is applied at **10 broadcast points**:

1. **sync:change (mongoUpsert)** - Main subscription broadcast
2. **sync:change (mongoUpsert)** - Transient subscription broadcast
3. **sync:changeBatch (upsert)** - Main subscription broadcast
4. **sync:changeBatch (upsert)** - Transient subscription broadcast
5. **sync:changeBatch (delete)** - Main subscription broadcast
6. **sync:changeBatch (delete)** - Transient subscription broadcast
7. **sync:batch_changes** - Main subscription broadcast (bulk)
8. **sync:batch_changes** - Transient subscription broadcast (bulk)
9. **Inbound processor (delete)** - Server-initiated delete broadcast
10. **Inbound processor (upsert)** - Server-initiated upsert broadcast

## Example Use Cases

### 1. Filter Sensitive Fields

```typescript
const privacyPlugin: SyncServerPlugin = {
  name: "privacy-filter",
  version: "1.0.0",
  hooks: {
    broadcastProcessor: async (socket, change, targetUserId) => {
      // Don't show email addresses to non-admin users
      if (change.collection === "users" && change.operation === "upsert") {
        const isAdmin = await checkIfAdmin(targetUserId);
        if (!isAdmin && change.data?.email) {
          return {
            ...change,
            data: {
              ...change.data,
              email: "***@***.**", // Redact email
            },
          };
        }
      }
      return change;
    },
  },
};
```

### 2. Add User-Specific Computed Fields

```typescript
const enrichmentPlugin: SyncServerPlugin = {
  name: "data-enrichment",
  version: "1.0.0",
  hooks: {
    broadcastProcessor: async (socket, change, targetUserId) => {
      if (change.collection === "posts" && change.operation === "upsert") {
        // Add "isAuthor" flag for the target user
        const isAuthor = change.data?.authorId === targetUserId;
        return {
          ...change,
          data: {
            ...change.data,
            isAuthor, // User-specific computed field
          },
        };
      }
      return change;
    },
  },
};
```

### 3. Implement Field-Level Permissions

```typescript
const permissionsPlugin: SyncServerPlugin = {
  name: "field-permissions",
  version: "1.0.0",
  hooks: {
    broadcastProcessor: async (socket, change, targetUserId) => {
      if (change.collection === "documents" && change.operation === "upsert") {
        const permissions = await getUserPermissions(
          targetUserId,
          change.documentId
        );

        // Remove fields user doesn't have permission to see
        const filteredData = {};
        for (const [key, value] of Object.entries(change.data || {})) {
          if (permissions.includes(key) || permissions.includes("*")) {
            filteredData[key] = value;
          }
        }

        return {
          ...change,
          data: filteredData,
        };
      }
      return change;
    },
  },
};
```

### 4. Localize Data Per User

```typescript
const localizationPlugin: SyncServerPlugin = {
  name: "localization",
  version: "1.0.0",
  hooks: {
    broadcastProcessor: async (socket, change, targetUserId) => {
      if (change.operation === "upsert" && change.data) {
        const userLocale = await getUserLocale(targetUserId);

        // Translate text fields based on user's locale
        const localizedData = {
          ...change.data,
          title: await translate(change.data.title, userLocale),
          description: await translate(change.data.description, userLocale),
        };

        return {
          ...change,
          data: localizedData,
        };
      }
      return change;
    },
  },
};
```

## Plugin Registration

Register your plugin with the SyncServer:

```typescript
import { SyncServer } from "./sync-server";
import { PluginManager } from "./extensions/plugin-manager";

const pluginManager = new PluginManager();
pluginManager.registerPlugin(privacyPlugin);
pluginManager.registerPlugin(enrichmentPlugin);

const syncServer = new SyncServer(
  io,
  db,
  authManager,
  false, // broadcastToSender
  pluginManager
);
```

## Performance Considerations

1. **Hook is called per recipient**: If 100 users receive a change, the hook runs 100 times
2. **Keep processing fast**: Avoid expensive database queries or external API calls
3. **Use caching**: Cache user permissions, preferences, or other frequently accessed data
4. **Return early**: If no transformation is needed, return immediately

## Error Handling

- If the hook **throws an error**, it is logged but the original change is broadcasted
- Multiple plugins are executed in registration order
- Each plugin can transform the change from the previous plugin

## Implementation Notes

- The hook receives the **sender's socket** (not the recipient's socket)
- The `targetUserId` is extracted from:
  1. `socket.data.userId`
  2. `socket.handshake.query.uuid`
  3. `socket.handshake.query.userId`
  4. Fallback: `"unknown"`
- For transient subscriptions, the target user is determined from the recipient socket
- Changes can be chained across multiple plugins

## See Also

- [Plugin System Documentation](./PLUGIN_SYSTEM.md)
- [Event Hooks Reference](../extensions/plugin-types.ts)
- [Example Plugins](../examples/plugins/)
