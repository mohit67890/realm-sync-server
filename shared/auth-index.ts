/**
 * Auth Providers - Pluggable authentication system
 *
 * This module provides a flexible authentication system that supports
 * multiple auth providers (JWT, Firebase, custom) with configurable strategies.
 */

// Core interfaces and manager
export {
  IAuthProvider,
  AuthVerificationResult,
  AuthStrategy,
  AuthManager,
  AuthManagerConfig,
} from "./auth-provider";

// Built-in providers
export {
  JWTAuthProvider,
  JWTProviderConfig,
  createJWTProviderFromEnv,
} from "./providers/jwt-provider";

export {
  FirebaseAuthProvider,
  FirebaseProviderConfig,
  createFirebaseProviderFromEnv,
} from "./providers/firebase-provider";
// Note: Legacy JWT utilities are deprecated and intentionally not exported.
