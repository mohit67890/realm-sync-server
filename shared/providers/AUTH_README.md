# Authentication Module

This module provides flexible authentication for the sync server with support for multiple authentication providers.

## Overview

Two authentication systems are available:

### 1. Legacy JWT Auth (Simple)

- Single JWT-based authentication
- Uses `setupSocketAuth()` from `shared/auth.ts`
- Backward compatible

### 2. Multi-Provider Auth (Flexible)

- Supports multiple authentication methods: JWT, Firebase, custom providers
- Configurable strategies: FIRST_SUCCESS, FALLBACK_CHAIN, ALL_REQUIRED
- Uses `AuthManager` from `shared/auth-provider.ts`

## Quick Start

### Legacy JWT Auth

```typescript
import { SyncServer } from "./server/sync-server";

// Don't pass authManager - uses legacy auth
const server = new SyncServer(mongoUri, pubsubConnection, hubName, 3000);
await server.start();
```

### Multi-Provider Auth

```typescript
import { SyncServer } from "./server/sync-server";
import {
  AuthManager,
  AuthStrategy,
  createJWTProviderFromEnv,
  createFirebaseProviderFromEnv,
} from "./shared/auth-index";

const authManager = new AuthManager({
  strategy: AuthStrategy.FIRST_SUCCESS,
  allowAnonymous: process.env.NODE_ENV !== "production",
});

authManager.registerProvider(createJWTProviderFromEnv());
authManager.registerProvider(createFirebaseProviderFromEnv());
await authManager.initialize();

const server = new SyncServer(
  mongoUri,
  pubsubConnection,
  hubName,
  3000,
  authManager
);
await server.start();
```

## Legacy Auth Module (auth.ts)

The auth module handles:

- JWT token generation and verification
- Socket.IO authentication middleware
- HTTP endpoint authentication
- User ID extraction from various sources
- Production environment validation

## Core Functions

### `validateProductionAuth(env?, jwtSecret?)`

Validates that JWT secret is configured in production environments.

```typescript
validateProductionAuth(process.env.NODE_ENV, process.env.AUTH_JWT_SECRET);
```

**Throws**: Error if running in production without JWT secret

---

### `verifyJWT(token, secret): JWTVerificationResult`

Verifies a JWT token and extracts the user ID.

```typescript
const result = verifyJWT(token, process.env.AUTH_JWT_SECRET!);
if (result.success) {
  console.log(`User ID: ${result.userId}`);
} else {
  console.error(`Error: ${result.error}`);
}
```

**Returns**: `{ success: boolean, userId?: string, error?: string }`

---

### `generateJWT(userId, secret, expiresIn?): string`

Generates a JWT token for a user with configurable expiration.

```typescript
const token = generateJWT("user-123", jwtSecret, "15m");
```

**Parameters**:

- `userId` - User identifier to encode in token
- `secret` - JWT secret key
- `expiresIn` - Token expiration (default: "15m")

**Returns**: JWT token string

---

### `extractUserIdFromHeader(authHeader?, jwtSecret?)`

Extracts and verifies user ID from an Authorization header.

```typescript
const { userId, error } = extractUserIdFromHeader(
  req.headers.authorization,
  process.env.AUTH_JWT_SECRET
);

if (error) {
  return res.status(401).json({ error });
}
```

**Returns**: `{ userId?: string, error?: string }`

---

### `setupSocketAuth(io, config)`

Configures Socket.IO authentication middleware.

```typescript
setupSocketAuth(io, {
  jwtSecret: process.env.AUTH_JWT_SECRET,
  webPubSubClient: webPubSubClient,
  env: process.env.NODE_ENV,
});
```

**Config**:

- `jwtSecret` - JWT secret for token verification (optional)
- `webPubSubClient` - Azure Web PubSub client instance
- `env` - Environment name (for logging)

**Behavior**:

- If `jwtSecret` is provided: Enforces JWT authentication on all socket connections
- If `jwtSecret` is undefined: Logs warning and allows connections without auth (legacy mode)

---

### `createSocketAuthMiddleware(jwtSecret)`

Creates a Socket.IO middleware function for JWT authentication.

```typescript
const middleware = createSocketAuthMiddleware(jwtSecret);
io.use(middleware);
```

**Middleware behavior**:

- Checks for `token` in `socket.handshake.auth`
- Verifies token signature
- Attaches `userId` to `socket.data`
- Rejects connection with errors:
  - `auth_token_missing` - No token provided
  - `auth_token_invalid` - Invalid or expired token

---

### `handleNegotiate(req, res, config)`

Handles the `/api/negotiate` endpoint for generating client tokens.

```typescript
app.get("/api/negotiate", async (req, res) => {
  await handleNegotiate(req, res, {
    jwtSecret: process.env.AUTH_JWT_SECRET,
    webPubSubClient: webPubSubClient,
    env: process.env.NODE_ENV,
  });
});
```

**Request**:

- **Header** (preferred): `Authorization: Bearer <jwt-token>`
- **Query** (legacy): `?userId=<user-id>`

**Response**:

```json
{
  "url": "wss://...",
  "token": "...",
  "jwt": "..." // Only if jwtSecret is configured
}
```

**Errors**:

- `400` - Missing user identity
- `401` - Invalid authorization token
- `500` - Failed to generate token

---

### `getUserIdFromSocket(socket, fallbackUserId?): string | undefined`

Extracts user ID from socket, supporting both JWT auth and legacy mode.

```typescript
const userId = getUserIdFromSocket(socket, data.userId);
if (!userId) {
  return callback({ success: false, error: "Not authenticated" });
}
```

**Priority**:

1. `socket.data.userId` (set by JWT middleware)
2. `fallbackUserId` (for legacy mode)

---

### `isJWTAuthEnabled(jwtSecret?): boolean`

Checks if JWT authentication is enabled.

```typescript
if (isJWTAuthEnabled(process.env.AUTH_JWT_SECRET)) {
  console.log("JWT auth is enabled");
}
```

---

## Usage Examples

### Basic Setup

```typescript
import { Server } from "socket.io";
import {
  validateProductionAuth,
  setupSocketAuth,
  handleNegotiate,
} from "../shared/auth";

// 1. Validate production environment
validateProductionAuth(process.env.NODE_ENV, process.env.AUTH_JWT_SECRET);

// 2. Setup Socket.IO auth middleware
const io = new Server(httpServer);
setupSocketAuth(io, {
  jwtSecret: process.env.AUTH_JWT_SECRET,
  webPubSubClient: webPubSubClient,
  env: process.env.NODE_ENV,
});

// 3. Setup negotiate endpoint
app.get("/api/negotiate", async (req, res) => {
  await handleNegotiate(req, res, {
    jwtSecret: process.env.AUTH_JWT_SECRET,
    webPubSubClient: webPubSubClient,
  });
});
```

### Socket Handler with Auth

```typescript
import { getUserIdFromSocket } from "../shared/auth";

io.on("connection", (socket) => {
  socket.on("sync:join", async (data, callback) => {
    // Extract userId (works in both JWT and legacy mode)
    const userId = getUserIdFromSocket(socket, data.userId);

    if (!userId) {
      return callback({
        success: false,
        error: "Not authenticated",
      });
    }

    // Set for legacy compatibility
    if (!socket.data.userId) {
      socket.data.userId = userId;
    }

    // Continue with join logic...
    await socket.join(`user:${userId}`);
    callback({ success: true });
  });
});
```

### Custom Endpoint with Auth

```typescript
import { extractUserIdFromHeader } from "../shared/auth";

app.get("/api/protected", async (req, res) => {
  const { userId, error } = extractUserIdFromHeader(
    req.headers.authorization,
    process.env.AUTH_JWT_SECRET
  );

  if (error || !userId) {
    return res.status(401).json({ error: error || "Unauthorized" });
  }

  // User is authenticated
  res.json({ userId, data: "protected data" });
});
```

### Manual Token Generation

```typescript
import { generateJWT } from "../shared/auth";

// Generate token for a user
const token = generateJWT("user-123", process.env.AUTH_JWT_SECRET!, "1h");

// Send to client
res.json({ token });
```

### Token Verification

```typescript
import { verifyJWT } from "../shared/auth";

// Verify a token
const result = verifyJWT(token, process.env.AUTH_JWT_SECRET!);

if (result.success) {
  console.log(`Authenticated user: ${result.userId}`);
} else {
  console.error(`Authentication failed: ${result.error}`);
}
```

## Authentication Flow

### With JWT (Production)

1. **Client requests token**:

   ```
   GET /api/negotiate
   Authorization: Bearer <existing-jwt-or-api-key>
   ```

2. **Server validates and generates tokens**:
   - Verifies authorization header
   - Generates Web PubSub token
   - Generates JWT token for socket auth
3. **Client connects to Socket.IO**:

   ```javascript
   socket = io(url, {
     auth: { token: jwt },
   });
   ```

4. **Server verifies JWT**:
   - `setupSocketAuth` middleware verifies token
   - Sets `socket.data.userId`
   - Allows or rejects connection

5. **Client sends sync:join**:
   - Server uses `getUserIdFromSocket` to get userId
   - No need to pass userId in payload

### Without JWT (Development/Legacy)

1. **Client requests token**:

   ```
   GET /api/negotiate?userId=user-123
   ```

2. **Server generates Web PubSub token only**

3. **Client connects and sends userId**:

   ```javascript
   socket.emit("sync:join", { userId: "user-123" }, callback);
   ```

4. **Server accepts userId from payload**:
   - `getUserIdFromSocket` falls back to payload
   - Sets `socket.data.userId` for consistency

## Environment Variables

- `AUTH_JWT_SECRET` - Secret key for JWT signing/verification
  - **Required in production**
  - Optional in development (enables legacy mode)
- `NODE_ENV` - Environment name
  - `production` - Enforces JWT secret requirement
  - `development` / `test` - Allows legacy mode

## Error Handling

All auth functions handle errors gracefully:

- **JWT verification errors** return `{ success: false, error: "..." }`
- **Socket middleware errors** reject connection with descriptive error codes
- **HTTP endpoint errors** return appropriate status codes (400, 401, 500)

## Security Best Practices

1. **Always use JWT in production**: Set `AUTH_JWT_SECRET` environment variable
2. **Use HTTPS**: Never send tokens over unencrypted connections
3. **Short token expiration**: Default 15 minutes for socket tokens
4. **Validate on every request**: Don't trust client-provided user IDs
5. **Rotate secrets regularly**: Update JWT secret periodically
6. **Log authentication failures**: Monitor for suspicious activity

## Multi-Provider Authentication System

### Available Providers

#### JWT Provider

```typescript
import { createJWTProviderFromEnv } from "./shared/auth-index";
authManager.registerProvider(createJWTProviderFromEnv());
```

**Env**: `AUTH_JWT_SECRET`

#### Firebase Provider

```typescript
import { createFirebaseProviderFromEnv } from "./shared/auth-index";
authManager.registerProvider(createFirebaseProviderFromEnv());
```

**Env**: `FIREBASE_ADMIN_CREDENTIALS_B64`, `GOOGLE_APPLICATION_CREDENTIALS`, or `FIREBASE_ADMIN_CREDENTIALS`

#### Custom Provider

```typescript
import { IAuthProvider, AuthVerificationResult } from "./shared/auth-provider";

class CustomProvider implements IAuthProvider {
  readonly name = "custom";
  async initialize(config: any): Promise<void> {
    /* ... */
  }
  async verifySocket(socket: Socket): Promise<AuthVerificationResult> {
    /* ... */
  }
  async verifyCredentials(
    credentials: string
  ): Promise<AuthVerificationResult> {
    /* ... */
  }
  isEnabled(): boolean {
    /* ... */
  }
  async cleanup(): Promise<void> {
    /* ... */
  }
}
```

### Authentication Strategies

- **FIRST_SUCCESS**: Try providers in order, accept first success (default)
- **FALLBACK_CHAIN**: Like FIRST_SUCCESS but logs fallback attempts
- **ALL_REQUIRED**: All providers must succeed (multi-factor auth)

### Examples

See `examples/multi-auth-setup.ts` for complete examples of:

- JWT-only authentication
- Firebase-only authentication
- JWT + Firebase fallback
- Custom API key provider
- Multi-factor authentication

## Testing

```typescript
import {
  verifyJWT,
  generateJWT,
  extractUserIdFromHeader,
} from "../shared/auth";

describe("Auth Module", () => {
  const secret = "test-secret";
  const userId = "user-123";

  test("generates and verifies JWT", () => {
    const token = generateJWT(userId, secret);
    const result = verifyJWT(token, secret);

    expect(result.success).toBe(true);
    expect(result.userId).toBe(userId);
  });

  test("rejects invalid token", () => {
    const result = verifyJWT("invalid-token", secret);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("extracts userId from header", () => {
    const token = generateJWT(userId, secret);
    const header = `Bearer ${token}`;
    const result = extractUserIdFromHeader(header, secret);

    expect(result.userId).toBe(userId);
    expect(result.error).toBeUndefined();
  });
});
```

## Future Enhancements

Potential additions to the auth module:

- [ ] Refresh token support
- [ ] Role-based access control (RBAC)
- [ ] OAuth2 integration
- [ ] API key authentication
- [ ] Rate limiting per user
- [ ] Session management
- [ ] Multi-tenant support
- [ ] Audit logging
