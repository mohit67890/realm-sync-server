/**
 * Example: Multi-Provider Authentication Setup
 *
 * This example shows how to configure the sync server with multiple authentication providers
 * including JWT, Firebase, and custom providers.
 */

import { SyncServer } from "../server/sync-server";
import {
  AuthManager,
  AuthStrategy,
  JWTAuthProvider,
  FirebaseAuthProvider,
  createJWTProviderFromEnv,
  createFirebaseProviderFromEnv,
} from "../shared/auth-index";

// ==============================================================================
// Example 1: Legacy JWT Auth (Backward Compatible)
// ==============================================================================

async function setupLegacyJWTServer() {
  // Simply don't pass authManager - uses legacy JWT auth
  const server = new SyncServer(
    process.env.MONGODB_URI!,
    process.env.WEB_PUBSUB_CONNECTION_STRING!,
    process.env.WEB_PUBSUB_HUB_NAME!,
    3000
  );

  await server.start();
  console.log("✅ Legacy JWT server started");
  return server;
}

// ==============================================================================
// Example 2: JWT-Only Multi-Provider
// ==============================================================================

async function setupJWTOnlyServer() {
  // Create auth manager with JWT provider only
  const authManager = new AuthManager({
    strategy: AuthStrategy.FIRST_SUCCESS,
    allowAnonymous: process.env.NODE_ENV !== "production",
    requireAuthInProduction: true,
    env: process.env.NODE_ENV,
  });

  // Register JWT provider using environment variable
  authManager.registerProvider(createJWTProviderFromEnv());

  // Initialize providers
  await authManager.initialize();

  // Create server with auth manager
  const server = new SyncServer(
    process.env.MONGODB_URI!,
    process.env.WEB_PUBSUB_CONNECTION_STRING!,
    process.env.WEB_PUBSUB_HUB_NAME!,
    3000,
    authManager
  );

  await server.start();
  console.log("✅ JWT-only multi-provider server started");
  return server;
}

// ==============================================================================
// Example 3: Firebase-Only Authentication
// ==============================================================================

async function setupFirebaseOnlyServer() {
  const authManager = new AuthManager({
    strategy: AuthStrategy.FIRST_SUCCESS,
    allowAnonymous: false, // Require Firebase auth
    requireAuthInProduction: true,
    env: process.env.NODE_ENV,
  });

  // Register Firebase provider
  authManager.registerProvider(createFirebaseProviderFromEnv());

  await authManager.initialize();

  const server = new SyncServer(
    process.env.MONGODB_URI!,
    process.env.WEB_PUBSUB_CONNECTION_STRING!,
    process.env.WEB_PUBSUB_HUB_NAME!,
    3000,
    authManager
  );

  await server.start();
  console.log("✅ Firebase-only server started");
  return server;
}

// ==============================================================================
// Example 4: JWT + Firebase Fallback Chain
// ==============================================================================

async function setupJWTFirebaseFallback() {
  const authManager = new AuthManager({
    strategy: AuthStrategy.FALLBACK_CHAIN, // Try JWT first, then Firebase
    allowAnonymous: process.env.NODE_ENV !== "production",
    anonymousPrefix: "guest-",
    requireAuthInProduction: true,
    env: process.env.NODE_ENV,
  });

  // Register providers in order - JWT tried first
  authManager.registerProvider(createJWTProviderFromEnv());
  authManager.registerProvider(createFirebaseProviderFromEnv());

  await authManager.initialize();

  const server = new SyncServer(
    process.env.MONGODB_URI!,
    process.env.WEB_PUBSUB_CONNECTION_STRING!,
    process.env.WEB_PUBSUB_HUB_NAME!,
    3000,
    authManager
  );

  await server.start();
  console.log("✅ JWT + Firebase fallback server started");
  return server;
}

// ==============================================================================
// Example 5: Manual Provider Configuration (Advanced)
// ==============================================================================

async function setupManualConfiguration() {
  const authManager = new AuthManager({
    strategy: AuthStrategy.FIRST_SUCCESS,
    allowAnonymous: false,
    requireAuthInProduction: true,
    env: process.env.NODE_ENV,
  });

  // Manually configure JWT provider
  const jwtProvider = new JWTAuthProvider();
  await jwtProvider.initialize({
    secret: process.env.AUTH_JWT_SECRET!,
    tokenLocation: "both", // Check both auth and query
    tokenField: "token",
    verifyOptions: {
      algorithms: ["HS256"],
      issuer: "my-app",
      audience: "sync-server",
    },
  });
  authManager.registerProvider(jwtProvider);

  // Manually configure Firebase provider
  const firebaseProvider = new FirebaseAuthProvider();
  await firebaseProvider.initialize({
    credentialsBase64: process.env.FIREBASE_ADMIN_CREDENTIALS_B64,
    tokenLocation: "both",
    queryTokenField: "idToken",
    uuidField: "uuid",
  });
  authManager.registerProvider(firebaseProvider);

  await authManager.initialize();

  const server = new SyncServer(
    process.env.MONGODB_URI!,
    process.env.WEB_PUBSUB_CONNECTION_STRING!,
    process.env.WEB_PUBSUB_HUB_NAME!,
    3000,
    authManager
  );

  await server.start();
  console.log("✅ Manually configured server started");
  return server;
}

// ==============================================================================
// Example 6: Custom Provider Implementation
// ==============================================================================

import { Socket } from "socket.io";
import { IAuthProvider, AuthVerificationResult } from "../shared/auth-provider";

class APIKeyAuthProvider implements IAuthProvider {
  readonly name = "apikey";
  private validKeys: Set<string> = new Set();

  async initialize(config: { apiKeys: string[] }): Promise<void> {
    this.validKeys = new Set(config.apiKeys);
    console.log(
      `✅ API Key provider initialized with ${this.validKeys.size} keys`
    );
  }

  async verifySocket(socket: Socket): Promise<AuthVerificationResult> {
    const apiKey = socket.handshake.query.apiKey as string;

    if (!apiKey) {
      return { success: false, error: "API key not provided" };
    }

    return this.verifyCredentials(apiKey);
  }

  async verifyCredentials(apiKey: string): Promise<AuthVerificationResult> {
    if (this.validKeys.has(apiKey)) {
      // In a real implementation, you'd map API key to user ID
      const userId = `apikey-${apiKey.substring(0, 8)}`;
      return {
        success: true,
        userId: userId,
        userData: { authMethod: "apikey" },
      };
    }

    return { success: false, error: "Invalid API key" };
  }

  isEnabled(): boolean {
    return this.validKeys.size > 0;
  }

  async cleanup(): Promise<void> {
    this.validKeys.clear();
  }
}

async function setupCustomProviderServer() {
  const authManager = new AuthManager({
    strategy: AuthStrategy.FIRST_SUCCESS,
    allowAnonymous: false,
    requireAuthInProduction: true,
    env: process.env.NODE_ENV,
  });

  // Register custom API key provider
  const apiKeyProvider = new APIKeyAuthProvider();
  await apiKeyProvider.initialize({
    apiKeys: (process.env.VALID_API_KEYS || "").split(",").filter(Boolean),
  });
  authManager.registerProvider(apiKeyProvider);

  // Also allow JWT
  authManager.registerProvider(createJWTProviderFromEnv());

  await authManager.initialize();

  const server = new SyncServer(
    process.env.MONGODB_URI!,
    process.env.WEB_PUBSUB_CONNECTION_STRING!,
    process.env.WEB_PUBSUB_HUB_NAME!,
    3000,
    authManager
  );

  await server.start();
  console.log("✅ Server with custom API key provider started");
  return server;
}

// ==============================================================================
// Example 7: Multi-Factor Authentication (All Required)
// ==============================================================================

async function setupMultiFactorAuth() {
  const authManager = new AuthManager({
    strategy: AuthStrategy.ALL_REQUIRED, // Both JWT and Firebase must succeed
    allowAnonymous: false,
    requireAuthInProduction: true,
    env: process.env.NODE_ENV,
  });

  // Both providers must authenticate successfully
  authManager.registerProvider(createJWTProviderFromEnv());
  authManager.registerProvider(createFirebaseProviderFromEnv());

  await authManager.initialize();

  const server = new SyncServer(
    process.env.MONGODB_URI!,
    process.env.WEB_PUBSUB_CONNECTION_STRING!,
    process.env.WEB_PUBSUB_HUB_NAME!,
    3000,
    authManager
  );

  await server.start();
  console.log(
    "✅ Multi-factor auth server started (JWT + Firebase both required)"
  );
  return server;
}

// ==============================================================================
// Main Entry Point - Choose Your Configuration
// ==============================================================================

async function main() {
  const authMode = process.env.AUTH_MODE || "jwt-firebase-fallback";

  let server: SyncServer;

  switch (authMode) {
    case "legacy":
      server = await setupLegacyJWTServer();
      break;
    case "jwt-only":
      server = await setupJWTOnlyServer();
      break;
    case "firebase-only":
      server = await setupFirebaseOnlyServer();
      break;
    case "jwt-firebase-fallback":
      server = await setupJWTFirebaseFallback();
      break;
    case "manual":
      server = await setupManualConfiguration();
      break;
    case "custom":
      server = await setupCustomProviderServer();
      break;
    case "multi-factor":
      server = await setupMultiFactorAuth();
      break;
    default:
      console.error(`Unknown auth mode: ${authMode}`);
      process.exit(1);
  }

  console.log(`✅ Server started in ${authMode} mode`);
  return server;
}

// Export for use as module
export {
  setupLegacyJWTServer,
  setupJWTOnlyServer,
  setupFirebaseOnlyServer,
  setupJWTFirebaseFallback,
  setupManualConfiguration,
  setupCustomProviderServer,
  setupMultiFactorAuth,
};

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error("❌ Server startup failed:", error);
    process.exit(1);
  });
}
