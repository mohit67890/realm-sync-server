# Extension System - Getting Started

Welcome to the Realm Sync Server extension system! This guide will get you up and running in 5 minutes.

## What is the Plugin System?

The plugin system allows you to extend the sync server with custom functionality **without modifying the core codebase**. You can:

- ✅ Validate data before it's saved
- ✅ Send notifications when data changes
- ✅ Track analytics and user activity
- ✅ Enforce custom permissions
- ✅ Add custom WebSocket events
- ✅ Integrate with external services

## Quick Start (5 minutes)

### Step 1: Create Your First Plugin

Create `extensions/my-first-plugin.ts`:

```typescript
import { SyncServerPlugin } from "./plugin-types";

export const myFirstPlugin: SyncServerPlugin = {
  name: "my-first-plugin",
  version: "1.0.0",
  description: "My awesome plugin",

  hooks: {
    // Log when users join
    afterJoin: async (socket, userId) => {
      console.log(`👋 Welcome ${userId}!`);
    },

    // Log all changes
    afterChange: async (socket, change) => {
      console.log(`📝 ${change.operation} on ${change.collection}`);
    },
  },
};
```

### Step 2: Register the Plugin

Edit `server/index.ts`:

```typescript
import { SyncServer } from "./sync-server";
import { myFirstPlugin } from "../extensions/my-first-plugin";

const server = new SyncServer(...);

// Register your plugin
server.registerPlugin(myFirstPlugin);

// Start server
await server.start();
```

### Step 3: Test It!

```bash
npm run dev:server
```

You should see:

```
📦 Registered plugin: my-first-plugin v1.0.0
✅ Initialized plugin: my-first-plugin
🚀 Sync server started on port 3000
```

Now when users connect or make changes, you'll see your log messages!

## Next Steps

### Add Data Validation

```typescript
hooks: {
  beforeChange: async (socket, change) => {
    // Reject invalid data
    if (change.collection === "posts" && !change.data?.title) {
      throw new Error("Posts must have a title");
    }
  };
}
```

### Add Custom Socket Events

```typescript
customEvents: [
  {
    event: "greet:user",
    handler: async (socket, data, callback) => {
      const { name } = data;
      callback?.({ message: `Hello, ${name}!` });
    },
  },
];
```

Client usage:

```typescript
socket.emit("greet:user", { name: "Alice" }, (response) => {
  console.log(response.message); // "Hello, Alice!"
});
```

### Add REST Endpoints

```typescript
initialize: async (context) => {
  context.app.get("/api/stats", (req, res) => {
    res.json({
      activeUsers: context.activeConnections.size,
    });
  });
};
```

## Example Use Cases

### 1. Audit Logging

Track all operations for compliance:

```typescript
hooks: {
  afterChange: async (socket, change) => {
    await auditLog.write({
      userId: change.userId,
      action: change.operation,
      collection: change.collection,
      timestamp: change.timestamp,
    });
  };
}
```

### 2. Real-time Notifications

Notify users about mentions:

```typescript
hooks: {
  afterChange: async (socket, change) => {
    if (change.data?.mentions) {
      for (const userId of change.data.mentions) {
        socket.to(`user:${userId}`).emit("notification", {
          type: "mention",
          from: change.userId,
        });
      }
    }
  };
}
```

### 3. Data Sanitization

Auto-format data:

```typescript
hooks: {
  beforeChange: async (socket, change) => {
    if (change.data?.email) {
      // Lowercase and trim emails
      change.data.email = change.data.email.toLowerCase().trim();
    }
    return change;
  };
}
```

### 4. Rate Limiting

Custom rate limits for expensive operations:

```typescript
customEvents: [
  {
    event: "ai:generate",
    rateLimit: 3, // Max 3 requests per window
    handler: async (socket, data, callback) => {
      const result = await aiService.generate(data.prompt);
      callback?.({ result });
    },
  },
];
```

## Available Hooks Reference

| Hook           | When Called          | Can Block? | Common Uses             |
| -------------- | -------------------- | ---------- | ----------------------- |
| `beforeJoin`   | Before user connects | Yes        | Auth, bans              |
| `afterJoin`    | After user connects  | No         | Welcome, analytics      |
| `beforeChange` | Before data saved    | Yes        | Validation, permissions |
| `afterChange`  | After data saved     | No         | Notifications, logging  |
| `onDisconnect` | User disconnects     | No         | Cleanup, offline status |

## Plugin Context

Access server internals:

```typescript
initialize: async (context) => {
  // Express app - add REST endpoints
  context.app.get("/my-endpoint", ...);

  // Socket.IO - broadcast messages
  context.io.emit("announcement", { ... });

  // Database - direct MongoDB access
  await context.db.getCollection("users").find(...);

  // Active connections - who's online
  context.activeConnections.size;

  // User subscriptions - what they're watching
  context.userSubscriptions.get(userId);
}
```

## Best Practices

### ✅ DO:

- Use `beforeChange` for validation (can reject)
- Use `afterChange` for side effects (notifications, logging)
- Handle errors gracefully in `afterChange` hooks
- Use rate limiting for expensive custom events
- Test plugins before deploying to production

### ❌ DON'T:

- Throw errors in `afterChange` hooks (change already applied)
- Block the event loop with heavy computations
- Store state in plugin closures (use database or context)
- Forget to cleanup resources in the `cleanup` hook

## Example Plugins

Check out complete examples in `extensions/examples/`:

- **Audit Logger** - Track all sync operations
- **Analytics** - Usage metrics and tracking
- **Data Validation** - Schema validation
- **Notifications** - Real-time user notifications

## Running the Example Server

We've included a fully-featured example server with multiple plugins:

```bash
# Copy the example server
cp server/index-with-plugins.ts server/index.ts

# Start server
npm run dev:server
```

This demonstrates:

- Permission system
- Presence tracking
- Activity feeds
- Change stream logging

## Need Help?

- **Full Documentation:** [README.md](README.md)
- **Quick Reference:** [QUICK_REFERENCE.md](QUICK_REFERENCE.md)
- **API Types:** [plugin-types.ts](plugin-types.ts)
- **GitHub Issues:** [Report bugs or request features](https://github.com/mohit67890/realm-sync-server/issues)

## What's Next?

1. ✅ Create your first plugin (you did it!)
2. 📖 Read the [full documentation](README.md)
3. 🧪 Write tests for your plugins
4. 🚀 Deploy to production
5. 💬 Share your plugins with the community!

---

Happy coding! 🎉
