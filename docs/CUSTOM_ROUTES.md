# Custom HTTP Routes

The sync server now supports extensible HTTP routes, allowing you to add custom endpoints without modifying the core server code.

## Overview

HTTP routes are now segregated into a separate `routes.ts` file with a clean extension API. You can:

- Use the default routes (health, ready, stats, negotiate)
- Add custom routes for your application
- Override or extend default behavior
- Keep your custom logic separate from core server code

## Basic Usage

### 1. Default Routes (Already Included)

The server automatically sets up these default routes:

- `GET /health` - Health check with connection count
- `GET /ready` - Database readiness check
- `GET /stats` - Database statistics and active users
- `GET /api/negotiate` - Web PubSub token generation

### 2. Adding Custom Routes

Create a route setup function and pass it to the server:

```typescript
import { SyncServer } from "./server/sync-server";
import { RouteSetupFunction } from "./server/routes";

// Define your custom routes
const customRoutes: RouteSetupFunction = (context) => {
  const { app, db, version, activeConnections } = context;

  // Add a custom endpoint
  app.get("/api/my-endpoint", async (req, res) => {
    res.json({ message: "Hello from custom route", version });
  });

  // Add another endpoint with database access
  app.post("/api/data", async (req, res) => {
    const result = await db.getCollection("my_collection").findOne({});
    res.json(result);
  });
};

// Apply custom routes to server
const server = new SyncServer(
  mongoUri,
  webPubSubConn,
  hubName,
  port,
  authManager
);
server.setCustomRoutes(customRoutes);
await server.start();
```

## Route Context

The `RouteContext` object passed to your setup function contains:

```typescript
interface RouteContext {
  app: Express; // Express app instance
  db: Database; // Database connection
  webPubSubClient: WebPubSubServiceClient; // PubSub client
  version: string; // Server version
  activeConnections: Map<string, Set<string>>; // User connections
  userSubscriptions: Map<string, any>; // User subscriptions
}
```

## Examples

### Example 1: Custom Metrics

```typescript
const metricsRoutes: RouteSetupFunction = (context) => {
  const { app, db, activeConnections } = context;

  app.get("/api/metrics", async (req, res) => {
    const stats = await db.getStats();
    res.json({
      ...stats,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      activeUsers: activeConnections.size,
    });
  });
};

server.setCustomRoutes(metricsRoutes);
```

### Example 2: Admin Endpoints

```typescript
const adminRoutes: RouteSetupFunction = (context) => {
  const { app, db, activeConnections } = context;

  // Middleware for auth
  const requireAdmin = (req, res, next) => {
    if (req.headers["x-admin-key"] !== process.env.ADMIN_KEY) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };

  // List active users
  app.get("/api/admin/users", requireAdmin, (req, res) => {
    const users = Array.from(activeConnections.keys());
    res.json({ users, count: users.length });
  });

  // Cleanup old data
  app.post("/api/admin/cleanup", requireAdmin, async (req, res) => {
    const deleted = await db.cleanupOldChanges(30);
    res.json({ success: true, deleted });
  });
};
```

### Example 3: Webhooks

```typescript
const webhookRoutes: RouteSetupFunction = (context) => {
  const { app, db } = context;

  app.post("/api/webhooks/external-event", async (req, res) => {
    // Validate webhook signature
    const signature = req.headers["x-webhook-signature"];
    if (!isValidSignature(signature, req.body)) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    // Process event
    const { userId, event, data } = req.body;
    console.log(`Webhook: ${event} for ${userId}`);

    res.json({ success: true });
  });
};
```

### Example 4: Combining Multiple Route Sets

```typescript
const allRoutes: RouteSetupFunction = (context) => {
  metricsRoutes(context);
  adminRoutes(context);
  webhookRoutes(context);
};

server.setCustomRoutes(allRoutes);
```

## Complete Example Files

See these files for complete working examples:

- `examples/custom-routes.ts` - Full examples with metrics, admin, and webhooks
- `server/routes.ts` - Route system implementation and types

## Best Practices

1. **Keep routes organized** - Group related routes into separate functions
2. **Use middleware** - Add authentication, validation, rate limiting
3. **Handle errors** - Always wrap async operations in try-catch
4. **Document your routes** - Add comments for custom endpoints
5. **Environment variables** - Use env vars for sensitive config (API keys, etc.)

## Migration from Old Code

If you had custom routes directly in `sync-server.ts`, move them to a separate file:

**Before:**

```typescript
// Inside sync-server.ts setupRoutes()
this.app.get("/my-custom-route", (req, res) => {
  // custom logic
});
```

**After:**

```typescript
// In your server/custom-routes.ts
export const myRoutes: RouteSetupFunction = (context) => {
  context.app.get("/my-custom-route", (req, res) => {
    // custom logic
  });
};

// In your server initialization
server.setCustomRoutes(myRoutes);
```

## Type Safety

All routes are fully typed with TypeScript:

```typescript
import { RouteSetupFunction, RouteContext } from "./server/routes";

const routes: RouteSetupFunction = (context: RouteContext) => {
  // Full TypeScript support
  context.app.get("/endpoint", (req, res) => {
    res.json({ typed: true });
  });
};
```
