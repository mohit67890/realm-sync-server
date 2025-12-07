# Multi-Provider Authentication System

A flexible, pluggable authentication system that supports multiple auth providers (JWT, Firebase, custom) with configurable strategies.

## Quick Start

### Option 1: Use Legacy JWT Auth (Simple)

```typescript
import { setupSocketAuth } from "../shared/auth";

// In your sync server setup
setupSocketAuth(io, {
  jwtSecret: process.env.AUTH_JWT_SECRET,
  webPubSubClient: webPubSubClient,
  env: process.env.NODE_ENV,
});
```

### Option 2: Use Multi-Provider System (Flexible)

```typescript
import {
  AuthManager,
  AuthStrategy,
  createJWTProviderFromEnv,
  createFirebaseProviderFromEnv,
} from "../shared/auth-index";

// Create auth manager
const authManager = new AuthManager({
  strategy: AuthStrategy.FIRST_SUCCESS,
  allowAnonymous: process.env.NODE_ENV !== "production",
  requireAuthInProduction: true,
  env: process.env.NODE_ENV,
});

// Register providers
authManager.registerProvider(createJWTProviderFromEnv());
authManager.registerProvider(createFirebaseProviderFromEnv());

// Initialize
await authManager.initialize();

// Use as Socket.IO middleware
io.use(authManager.createMiddleware());
```

## Authentication Providers

### JWT Provider

Verifies JWT tokens from socket handshake.

```typescript
import { JWTAuthProvider } from "../shared/providers/jwt-provider";

const jwtProvider = new JWTAuthProvider();
await jwtProvider.initialize({
  secret: process.env.AUTH_JWT_SECRET!,
  tokenLocation: "both", // Look in auth and query
  tokenField: "token",
  verifyOptions: {
    algorithms: ["HS256"],
  },
});

authManager.registerProvider(jwtProvider);
```

**Environment Variables:**

- `AUTH_JWT_SECRET` - JWT secret key

**Token Locations:**

- `socket.handshake.auth.token` (default)
- `socket.handshake.query.token` (with `tokenLocation: "query"`)

### Firebase Provider

Verifies Firebase ID tokens.

```typescript
import { FirebaseAuthProvider } from "../shared/providers/firebase-provider";

const firebaseProvider = new FirebaseAuthProvider();
await firebaseProvider.initialize({
  credentialsBase64: process.env.FIREBASE_ADMIN_CREDENTIALS_B64,
  // OR credentialsFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  // OR serviceAccount: { ... },
  tokenLocation: "both",
  queryTokenField: "idToken",
  uuidField: "uuid", // Fallback field
});

authManager.registerProvider(firebaseProvider);
```

**Environment Variables:**

- `FIREBASE_ADMIN_CREDENTIALS_B64` - Base64 encoded service account JSON
- `FIREBASE_ADMIN_CREDENTIALS` - Service account JSON string
- `FIREBASE_ADMIN_CREDENTIALS_FILE` - Path to service account file
- `GOOGLE_APPLICATION_CREDENTIALS` - Google Cloud credentials path

**Token Locations:**

- `socket.handshake.query.idToken` (default)
- `socket.handshake.headers.authorization` (Bearer token)

**UUID Fallback:**

- If token verification fails, falls back to `socket.handshake.query.uuid`

## Authentication Strategies

### FIRST_SUCCESS (Default)

Try each provider in order, accept the first successful authentication.

```typescript
const authManager = new AuthManager({
  strategy: AuthStrategy.FIRST_SUCCESS,
});
```

**Use Case:** Multiple auth methods (JWT or Firebase or API key)

### FALLBACK_CHAIN

Similar to FIRST_SUCCESS but logs fallback attempts.

```typescript
const authManager = new AuthManager({
  strategy: AuthStrategy.FALLBACK_CHAIN,
});
```

**Use Case:** Primary + backup authentication

### ALL_REQUIRED

All providers must succeed and agree on user ID.

```typescript
const authManager = new AuthManager({
  strategy: AuthStrategy.ALL_REQUIRED,
});
```

**Use Case:** Multi-factor authentication

## Configuration Options

```typescript
interface AuthManagerConfig {
  /** Authentication strategy */
  strategy?: AuthStrategy;

  /** Allow unauthenticated connections (development only) */
  allowAnonymous?: boolean; // Default: true

  /** Anonymous user ID prefix */
  anonymousPrefix?: string; // Default: "anon-"

  /** Require auth in production */
  requireAuthInProduction?: boolean; // Default: true

  /** Environment name */
  env?: string;
}
```

## Complete Example

```typescript
import { Server } from "socket.io";
import {
  AuthManager,
  AuthStrategy,
  JWTAuthProvider,
  FirebaseAuthProvider,
} from "../shared/auth-index";

async function setupAuth(io: Server) {
  // Create auth manager
  const authManager = new AuthManager({
    strategy: AuthStrategy.FIRST_SUCCESS,
    allowAnonymous: process.env.NODE_ENV !== "production",
    anonymousPrefix: "guest-",
    requireAuthInProduction: true,
    env: process.env.NODE_ENV,
  });

  // Setup JWT provider
  if (process.env.AUTH_JWT_SECRET) {
    const jwtProvider = new JWTAuthProvider();
    await jwtProvider.initialize({
      secret: process.env.AUTH_JWT_SECRET,
      tokenLocation: "both",
    });
    authManager.registerProvider(jwtProvider);
  }

  // Setup Firebase provider
  if (process.env.FIREBASE_ADMIN_CREDENTIALS_B64) {
    const firebaseProvider = new FirebaseAuthProvider();
    await firebaseProvider.initialize({
      credentialsBase64: process.env.FIREBASE_ADMIN_CREDENTIALS_B64,
      tokenLocation: "both",
    });
    authManager.registerProvider(firebaseProvider);
  }

  // Initialize and apply middleware
  await authManager.initialize();
  io.use(authManager.createMiddleware());

  console.log(
    `✅ Enabled providers: ${authManager.getEnabledProviders().join(", ")}`
  );

  return authManager;
}

// In your server startup
const io = new Server(httpServer);
const authManager = await setupAuth(io);

// Socket handlers can access authenticated user
io.on("connection", (socket) => {
  const userId = socket.data.userId;
  const userData = socket.data.user;

  console.log(`User ${userId} connected`, userData);

  // Your socket handlers...
});

// Cleanup on shutdown
process.on("SIGTERM", async () => {
  await authManager.cleanup();
});
```

## Client Usage

### JWT Client

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:3000", {
  auth: {
    token: "your-jwt-token",
  },
});
```

### Firebase Client

```javascript
// Option 1: Query parameter
const socket = io("http://localhost:3000", {
  query: {
    idToken: firebaseIdToken,
    uuid: userId, // Fallback
  },
});

// Option 2: Authorization header
const socket = io("http://localhost:3000", {
  extraHeaders: {
    authorization: `Bearer ${firebaseIdToken}`,
  },
});
```

### Anonymous Client (Development)

```javascript
const socket = io("http://localhost:3000", {
  query: {
    uuid: "user-123",
  },
});
```

## Creating Custom Providers

Implement the `IAuthProvider` interface:

```typescript
import { Socket } from "socket.io";
import { IAuthProvider, AuthVerificationResult } from "../shared/auth-provider";

export class CustomAuthProvider implements IAuthProvider {
  readonly name = "custom";
  private config: any;

  async initialize(config: any): Promise<void> {
    this.config = config;
    console.log("Custom provider initialized");
  }

  async verifySocket(socket: Socket): Promise<AuthVerificationResult> {
    // Extract credentials from socket
    const apiKey = socket.handshake.query.apiKey as string;

    if (!apiKey) {
      return { success: false, error: "API key not found" };
    }

    return this.verifyCredentials(apiKey);
  }

  async verifyCredentials(apiKey: string): Promise<AuthVerificationResult> {
    // Your custom verification logic
    try {
      const user = await this.validateApiKey(apiKey);
      return {
        success: true,
        userId: user.id,
        userData: user,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  isEnabled(): boolean {
    return !!this.config;
  }

  async cleanup(): Promise<void> {
    // Cleanup resources
  }

  private async validateApiKey(apiKey: string): Promise<any> {
    // Your validation logic
    // e.g., database lookup, API call, etc.
  }
}

// Register with auth manager
const customProvider = new CustomAuthProvider();
await customProvider.initialize({
  /* config */
});
authManager.registerProvider(customProvider);
```

## Migration from Inline Auth

### Before (Inline Firebase Auth)

```typescript
io.use(async (socket, next) => {
  const idToken = socket.handshake.query.idToken;
  const uuid = socket.handshake.query.uuid;

  try {
    if (idToken && admin.apps.length) {
      const decoded = await admin.auth().verifyIdToken(idToken);
      socket.user = { uid: decoded.uid };
      socket.id = decoded.uid;
      return next();
    }

    if (uuid) {
      socket.id = uuid;
      return next();
    }

    return next(new Error("Unauthorized"));
  } catch (err) {
    return next(new Error("Unauthorized"));
  }
});
```

### After (Multi-Provider System)

```typescript
import {
  AuthManager,
  AuthStrategy,
  createFirebaseProviderFromEnv,
} from "../shared/auth-index";

const authManager = new AuthManager({
  strategy: AuthStrategy.FIRST_SUCCESS,
  allowAnonymous: true, // Supports uuid fallback
});

authManager.registerProvider(createFirebaseProviderFromEnv());
await authManager.initialize();
io.use(authManager.createMiddleware());
```

## Environment Configuration

### JWT Only

```bash
AUTH_JWT_SECRET=your-secret-key
NODE_ENV=production
```

### Firebase Only

```bash
# Option 1: Base64 encoded
FIREBASE_ADMIN_CREDENTIALS_B64=<base64-encoded-json>

# Option 2: File path
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# Option 3: JSON string
FIREBASE_ADMIN_CREDENTIALS='{"type":"service_account",...}'

NODE_ENV=production
```

### Multiple Providers

```bash
# Enable both JWT and Firebase
AUTH_JWT_SECRET=your-secret-key
FIREBASE_ADMIN_CREDENTIALS_B64=<base64-encoded-json>
NODE_ENV=production
```

### Development Mode

```bash
# Allow anonymous connections
NODE_ENV=development
# No auth secrets needed
```

## Troubleshooting

### Provider Not Loading

```typescript
// Check enabled providers
console.log(authManager.getEnabledProviders());

// Get specific provider
const firebaseProvider = authManager.getProvider("firebase");
console.log("Firebase enabled:", firebaseProvider?.isEnabled());
```

### Authentication Failures

```typescript
// Enable detailed logging in provider
const result = await provider.verifySocket(socket);
if (!result.success) {
  console.error("Auth failed:", result.error);
}
```

### Multiple Providers Conflicting

Use `ALL_REQUIRED` strategy to ensure all providers agree:

```typescript
const authManager = new AuthManager({
  strategy: AuthStrategy.ALL_REQUIRED,
});
```

## Security Best Practices

1. **Always require auth in production**:

   ```typescript
   requireAuthInProduction: true;
   ```

2. **Use HTTPS/WSS in production**

3. **Rotate secrets regularly**

4. **Set short token expiration** (15 minutes recommended)

5. **Validate tokens on every request** (automatic with providers)

6. **Monitor failed auth attempts**:

   ```typescript
   io.use(authManager.createMiddleware());

   io.on("connection_error", (err) => {
     console.error("Auth error:", err.message);
     // Alert security team
   });
   ```

7. **Disable anonymous mode in production**:
   ```typescript
   allowAnonymous: process.env.NODE_ENV !== "production";
   ```

## Testing

```typescript
import { AuthManager, JWTAuthProvider } from "../shared/auth-index";

describe("Multi-Provider Auth", () => {
  let authManager: AuthManager;

  beforeEach(() => {
    authManager = new AuthManager({
      strategy: AuthStrategy.FIRST_SUCCESS,
      allowAnonymous: false,
    });
  });

  test("JWT provider authenticates valid token", async () => {
    const provider = new JWTAuthProvider();
    await provider.initialize({ secret: "test-secret" });
    authManager.registerProvider(provider);

    const mockSocket = {
      handshake: {
        auth: { token: generateTestToken() },
      },
      data: {},
    } as any;

    const result = await authManager.verifySocket(mockSocket);
    expect(result.success).toBe(true);
    expect(result.userId).toBe("user-123");
  });
});
```
