# Extension System Guide

The Realm Sync Server includes a powerful plugin system that allows you to extend its functionality without modifying the core codebase. This guide explains how to create and register custom plugins.

## Table of Contents

- [Overview](#overview)
- [Plugin Architecture](#plugin-architecture)
- [Creating a Plugin](#creating-a-plugin)
- [Event Hooks](#event-hooks)
- [Custom Socket Events](#custom-socket-events)
- [Plugin Context](#plugin-context)
- [Example Plugins](#example-plugins)
- [Best Practices](#best-practices)

## Overview

The plugin system allows you to:

- **Hook into lifecycle events**: Intercept and extend built-in sync operations (join, change, disconnect, etc.)
- **Add custom socket events**: Create new WebSocket event handlers for your application
- **Access server internals**: Get direct access to Express app, Socket.IO server, MongoDB database, and more
- **Validate and transform data**: Modify changes before they're applied or reject operations
- **Integrate external services**: Connect to analytics, logging, notifications, etc.

## Plugin Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Sync Server                            │
│                                                             │
│  ┌───────────────┐                                         │
│  │ PluginManager │                                         │
│  └───────┬───────┘                                         │
│          │                                                  │
│          ├──► Plugin 1 (Audit Logger)                      │
│          │      • hooks: afterJoin, afterChange            │
│          │      • customEvents: audit:get_logs             │
│          │                                                  │
│          ├──► Plugin 2 (Analytics)                         │
│          │      • hooks: afterJoin, afterChange            │
│          │      • customEvents: analytics:track_event      │
│          │      • REST endpoints: /analytics/stats         │
│          │                                                  │
│          └──► Plugin 3 (Data Validation)                   │
│                 • hooks: beforeChange                       │
│                 • customEvents: validate:schema             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Creating a Plugin

### Basic Plugin Structure

```typescript
import { SyncServerPlugin } from "./extensions";

export const myPlugin: SyncServerPlugin = {
  name: "my-plugin",
  version: "1.0.0",
  description: "My awesome plugin",

  // Optional: Initialize resources
  initialize: async (context) => {
    console.log("Plugin initialized!");
  },

  // Optional: Define event hooks
  hooks: {
    afterJoin: async (socket, userId) => {
      console.log(`User ${userId} joined`);
    },
  },

  // Optional: Add custom socket events
  customEvents: [
    {
      event: "custom:action",
      handler: async (socket, data, callback) => {
        callback?.({ success: true });
      },
    },
  ],

  // Optional: Cleanup resources
  cleanup: async (context) => {
    console.log("Plugin cleaned up!");
  },
};
```

### Registering a Plugin

In your `server/index.ts`:

```typescript
import { SyncServer } from "./sync-server";
import { myPlugin } from "./extensions/my-plugin";

const server = new SyncServer(
  process.env.MONGODB_URI!,
  process.env.WEB_PUBSUB_CONNECTION_STRING!,
  process.env.WEB_PUBSUB_HUB_NAME!,
  parseInt(process.env.PORT || "3000")
);

// Register plugin before starting server
server.registerPlugin(myPlugin);

// Start server
server.start();
```

## Event Hooks

Event hooks allow you to intercept and extend built-in sync operations.

### Available Hooks

#### `beforeJoin`

Called **before** a user joins. Can reject by throwing an error.

```typescript
hooks: {
  beforeJoin: async (socket, userId) => {
    // Check if user is banned
    const isBanned = await checkBanStatus(userId);
    if (isBanned) {
      throw new Error("User is banned");
    }
  };
}
```

#### `afterJoin`

Called **after** a user successfully joins.

```typescript
hooks: {
  afterJoin: async (socket, userId) => {
    // Track login event
    await analytics.track("user_login", { userId });
  };
}
```

#### `beforeChange`

Called **before** a change is processed. Can modify the change or reject by throwing.

```typescript
hooks: {
  beforeChange: async (socket, change) => {
    // Validate data
    if (change.collection === "posts" && !change.data?.title) {
      throw new Error("Posts must have a title");
    }

    // Modify data (e.g., sanitize)
    if (change.data?.email) {
      change.data.email = change.data.email.toLowerCase();
    }

    // Return modified change
    return change;
  };
}
```

#### `afterChange`

Called **after** a change is successfully applied.

```typescript
hooks: {
  afterChange: async (socket, change) => {
    // Send notification
    if (change.operation === "insert" && change.collection === "messages") {
      await sendNotification(change.data);
    }
  };
}
```

#### `beforeUpdateSubscriptions`

Called **before** subscriptions are updated.

```typescript
hooks: {
  beforeUpdateSubscriptions: async (socket, userId, subscriptions) => {
    // Validate subscription permissions
    for (const sub of subscriptions) {
      if (!(await hasPermission(userId, sub.collection))) {
        throw new Error(`No permission for ${sub.collection}`);
      }
    }
  };
}
```

#### `afterUpdateSubscriptions`

Called **after** subscriptions are successfully updated.

```typescript
hooks: {
  afterUpdateSubscriptions: async (socket, userId, version) => {
    console.log(`Subscriptions v${version} active for ${userId}`);
  };
}
```

#### `onDisconnect`

Called when a socket disconnects.

```typescript
hooks: {
  onDisconnect: async (socket, userId) => {
    await analytics.track("user_logout", { userId });
  };
}
```

#### `onServerStart`

Called when the server starts (after database connection).

```typescript
hooks: {
  onServerStart: async (context) => {
    console.log(
      `Server started with ${context.activeConnections.size} connections`
    );
  };
}
```

#### `onServerStop`

Called when the server stops (before database close).

```typescript
hooks: {
  onServerStop: async (context) => {
    // Flush any pending data
    await flushAnalytics();
  };
}
```

## Custom Socket Events

Add custom WebSocket event handlers that clients can call.

### Basic Custom Event

```typescript
customEvents: [
  {
    event: "custom:action",
    handler: async (socket, data, callback) => {
      // Process data
      const result = await processAction(data);

      // Send response via callback
      callback?.({ success: true, result });
    },
  },
];
```

### With Rate Limiting

```typescript
customEvents: [
  {
    event: "expensive:operation",
    handler: async (socket, data, callback) => {
      // Expensive operation
      const result = await heavyComputation(data);
      callback?.({ success: true, result });
    },
    rateLimit: 10, // Max 10 requests per rate limit window (default 10s)
  },
];
```

### Client Usage

```typescript
// Client-side
socket.emit("custom:action", { param: "value" }, (response) => {
  console.log(response); // { success: true, result: ... }
});
```

## Plugin Context

The `PluginContext` provides access to server internals:

```typescript
interface PluginContext {
  app: Express; // Express app for REST endpoints
  io: Server; // Socket.IO server
  db: Database; // MongoDB database instance
  activeConnections: Map<string, Set<string>>; // userId -> socket IDs
  userSubscriptions: Map<string, any>; // userId -> subscription sets
  version: string; // Server version
}
```

### Example: Adding REST Endpoints

```typescript
initialize: async (context) => {
  // Add custom REST endpoint
  context.app.get("/api/my-plugin/stats", async (req, res) => {
    const stats = {
      activeUsers: context.activeConnections.size,
      totalSubscriptions: context.userSubscriptions.size,
    };
    res.json(stats);
  });
};
```

### Example: Direct Database Access

```typescript
afterJoin: async (socket, userId) => {
  // Query custom collection
  const userProfile = await context.db
    .getCollection("user_profiles")
    .findOne({ userId });

  // Send to client
  socket.emit("profile:loaded", userProfile);
};
```

### Example: Broadcasting to All Users

```typescript
customEvents: [
  {
    event: "admin:broadcast",
    handler: async (socket, data, callback) => {
      const { message } = data;

      // Broadcast to all connected users
      context.io.emit("admin:message", {
        message,
        timestamp: Date.now(),
      });

      callback?.({ success: true, sent: context.activeConnections.size });
    },
  },
];
```

## Example Plugins

### 1. Audit Logger

Tracks all sync operations for compliance/auditing.

```typescript
import { SyncServerPlugin } from "../extensions";

export const auditLoggerPlugin: SyncServerPlugin = {
  name: "audit-logger",
  version: "1.0.0",
  description: "Logs all sync operations",

  hooks: {
    afterJoin: async (socket, userId) => {
      console.log(`[AUDIT] User ${userId} joined`);
    },

    afterChange: async (socket, change) => {
      console.log(
        `[AUDIT] ${change.operation} on ${change.collection}/${change.documentId}`
      );
    },
  },
};
```

### 2. Data Validation

Validates data before changes are applied.

```typescript
import { SyncServerPlugin } from "../extensions";

export const dataValidationPlugin: SyncServerPlugin = {
  name: "data-validation",
  version: "1.0.0",

  hooks: {
    beforeChange: async (socket, change) => {
      if (change.collection === "users" && change.operation !== "delete") {
        // Validate required fields
        if (!change.data?.email || !change.data?.name) {
          throw new Error("Users must have email and name");
        }

        // Sanitize email
        change.data.email = change.data.email.toLowerCase().trim();

        return change;
      }
    },
  },
};
```

### 3. Analytics Tracker

Tracks user activity and usage metrics.

```typescript
import { SyncServerPlugin } from "../extensions";

export const analyticsPlugin: SyncServerPlugin = {
  name: "analytics",
  version: "1.0.0",

  initialize: async (context) => {
    // Add analytics endpoint
    context.app.get("/analytics/stats", (req, res) => {
      res.json({
        totalUsers: context.activeConnections.size,
        timestamp: Date.now(),
      });
    });
  },

  hooks: {
    afterChange: async (socket, change) => {
      // Track operation metrics
      await trackMetric("operation", {
        type: change.operation,
        collection: change.collection,
      });
    },
  },

  customEvents: [
    {
      event: "analytics:track_event",
      handler: async (socket, data, callback) => {
        const { eventName, properties } = data;
        await trackMetric(eventName, properties);
        callback?.({ success: true });
      },
    },
  ],
};
```

### 4. Notification System

Sends real-time notifications to users.

```typescript
import { SyncServerPlugin } from "../extensions";

export const notificationPlugin: SyncServerPlugin = {
  name: "notifications",
  version: "1.0.0",

  customEvents: [
    {
      event: "notification:send",
      handler: async (socket, data, callback) => {
        const { userId, title, message } = data;

        // Emit to target user
        socket.to(`user:${userId}`).emit("notification:received", {
          title,
          message,
          timestamp: Date.now(),
        });

        callback?.({ success: true });
      },
    },

    {
      event: "notification:broadcast",
      handler: async (socket, data, callback) => {
        const { title, message } = data;

        // Broadcast to all users
        socket.broadcast.emit("notification:received", {
          title,
          message,
          timestamp: Date.now(),
        });

        callback?.({ success: true });
      },
    },
  ],
};
```

## Best Practices

### 1. Error Handling

Always wrap hook logic in try-catch for robustness:

```typescript
hooks: {
  afterChange: async (socket, change) => {
    try {
      await sendNotification(change);
    } catch (error) {
      console.error("Notification failed:", error);
      // Don't throw - change already applied
    }
  };
}
```

### 2. Rejecting Operations

Only throw errors in **before** hooks to reject operations:

```typescript
hooks: {
  beforeChange: async (socket, change) => {
    if (!isValid(change.data)) {
      throw new Error("Invalid data"); // Rejects change
    }
  };
}
```

### 3. Async Operations

Use `async/await` for database queries and external API calls:

```typescript
hooks: {
  afterJoin: async (socket, userId) => {
    const profile = await fetchUserProfile(userId);
    socket.emit("profile:loaded", profile);
  };
}
```

### 4. Rate Limiting

Apply rate limits to expensive custom events:

```typescript
customEvents: [
  {
    event: "heavy:computation",
    rateLimit: 5, // Max 5 per window
    handler: async (socket, data, callback) => {
      // ...
    },
  },
];
```

### 5. Plugin Isolation

Keep plugins independent and avoid shared state:

```typescript
// ❌ Bad: Shared state between plugins
let sharedCache = {};

// ✅ Good: Plugin-specific state
const pluginCache = new Map();
```

### 6. Cleanup Resources

Always cleanup in the `cleanup` hook:

```typescript
let intervalId: NodeJS.Timeout;

export const myPlugin: SyncServerPlugin = {
  initialize: async (context) => {
    intervalId = setInterval(() => {
      // Periodic task
    }, 60000);
  },

  cleanup: async (context) => {
    if (intervalId) {
      clearInterval(intervalId);
    }
  },
};
```

### 7. Testing Plugins

Create unit tests for your plugins:

```typescript
import { myPlugin } from "./my-plugin";

describe("MyPlugin", () => {
  it("should validate data correctly", async () => {
    const change = { collection: "users", data: {} };
    await expect(
      myPlugin.hooks!.beforeChange!(null as any, change)
    ).rejects.toThrow();
  });
});
```

## Advanced: Multiple Plugins

Register multiple plugins to compose functionality:

```typescript
import { SyncServer } from "./sync-server";
import {
  auditLoggerPlugin,
  analyticsPlugin,
  dataValidationPlugin,
  notificationPlugin,
} from "./extensions/examples";

const server = new SyncServer(...);

// Register all plugins
server.registerPlugin(auditLoggerPlugin);
server.registerPlugin(analyticsPlugin);
server.registerPlugin(dataValidationPlugin);
server.registerPlugin(notificationPlugin);

server.start();
```

**Execution order**: Plugins are executed in registration order.

## Troubleshooting

### Plugin Not Loading

Check console output for registration messages:

```
📦 Registered plugin: my-plugin v1.0.0
✅ Initialized plugin: my-plugin
🔌 Registered custom event handler: custom:action
```

### Hook Not Executing

Ensure hook name is correct (case-sensitive):

```typescript
hooks: {
  afterChange: async (socket, change) => { ... }  // ✅ Correct
  AfterChange: async (socket, change) => { ... }  // ❌ Wrong
}
```

### Rate Limit Errors

Custom events inherit server rate limiting. To disable:

```bash
RATE_LIMIT_DISABLED=1 npm run dev:server
```

## Next Steps

- Explore [example plugins](examples/) for more patterns
- Check [plugin-types.ts](plugin-types.ts) for full API reference
- Join discussions for plugin ideas and best practices

---

**Need help?** Open an issue on [GitHub](https://github.com/mohit67890/realm-sync-server/issues).
