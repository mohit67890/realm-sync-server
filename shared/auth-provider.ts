import { Socket } from "socket.io";

/**
 * Result of authentication verification
 */
export interface AuthVerificationResult {
  success: boolean;
  userId?: string;
  userData?: any;
  error?: string;
}

/**
 * Authentication provider interface
 * Implement this interface to create custom auth providers
 */
export interface IAuthProvider {
  /**
   * Name of the auth provider (e.g., "jwt", "firebase", "custom")
   */
  readonly name: string;

  /**
   * Initialize the provider with configuration
   */
  initialize(config: any): Promise<void>;

  /**
   * Verify authentication credentials from socket handshake
   * @param socket - Socket.IO socket instance
   * @returns Authentication result with userId if successful
   */
  verifySocket(socket: Socket): Promise<AuthVerificationResult>;

  /**
   * Verify authentication token/credentials
   * @param credentials - Token or credentials object
   * @returns Authentication result with userId if successful
   */
  verifyCredentials(credentials: any): Promise<AuthVerificationResult>;

  /**
   * Check if provider is enabled/initialized
   */
  isEnabled(): boolean;

  /**
   * Cleanup resources
   */
  cleanup?(): Promise<void>;
}

/**
 * Authentication strategy - determines how multiple providers are evaluated
 */
export enum AuthStrategy {
  /** Try providers in order, accept first success */
  FIRST_SUCCESS = "first_success",
  /** All providers must succeed */
  ALL_REQUIRED = "all_required",
  /** Try providers in order, fallback to next on failure */
  FALLBACK_CHAIN = "fallback_chain",
}

/**
 * Authentication manager configuration
 */
export interface AuthManagerConfig {
  /** Authentication strategy to use */
  strategy?: AuthStrategy;
  /** Allow unauthenticated connections (legacy mode) */
  allowAnonymous?: boolean;
  /** Anonymous user ID prefix */
  anonymousPrefix?: string;
  /** Require authentication in production */
  requireAuthInProduction?: boolean;
  /** Environment */
  env?: string;
}

/**
 * Authentication manager - orchestrates multiple auth providers
 */
export class AuthManager {
  private providers: IAuthProvider[] = [];
  private strategy: AuthStrategy;
  private allowAnonymous: boolean;
  private anonymousPrefix: string;
  private requireAuthInProduction: boolean;
  private env?: string;

  constructor(config: AuthManagerConfig = {}) {
    this.strategy = config.strategy || AuthStrategy.FIRST_SUCCESS;
    this.allowAnonymous = config.allowAnonymous ?? true;
    this.anonymousPrefix = config.anonymousPrefix || "anon-";
    this.requireAuthInProduction = config.requireAuthInProduction ?? true;
    this.env = config.env;
  }

  /**
   * Register an authentication provider
   */
  registerProvider(provider: IAuthProvider): void {
    if (this.providers.some((p) => p.name === provider.name)) {
      console.warn(
        `⚠️ Auth provider '${provider.name}' already registered, skipping`
      );
      return;
    }
    this.providers.push(provider);
    console.log(`✅ Registered auth provider: ${provider.name}`);
  }

  /**
   * Initialize all registered providers
   */
  async initialize(): Promise<void> {
    console.log(`🔐 Initializing ${this.providers.length} auth provider(s)...`);

    const enabledProviders = this.providers.filter((p) => p.isEnabled());

    if (enabledProviders.length === 0) {
      if (this.env === "production" && this.requireAuthInProduction) {
        throw new Error(
          "❌ FATAL: No auth providers enabled in production. Set AUTH_JWT_SECRET or configure other providers."
        );
      }
      console.warn(
        "⚠️ No auth providers enabled. Running in anonymous mode (not recommended for production)."
      );
    } else {
      console.log(
        `🔐 Enabled providers: ${enabledProviders.map((p) => p.name).join(", ")}`
      );
    }
  }

  /**
   * Verify authentication from socket handshake
   */
  async verifySocket(socket: Socket): Promise<AuthVerificationResult> {
    const enabledProviders = this.providers.filter((p) => p.isEnabled());

    if (enabledProviders.length === 0) {
      return this.handleNoProviders(socket);
    }

    switch (this.strategy) {
      case AuthStrategy.FIRST_SUCCESS:
        return this.verifyFirstSuccess(socket, enabledProviders);

      case AuthStrategy.ALL_REQUIRED:
        return this.verifyAllRequired(socket, enabledProviders);

      case AuthStrategy.FALLBACK_CHAIN:
        return this.verifyFallbackChain(socket, enabledProviders);

      default:
        return { success: false, error: "Unknown auth strategy" };
    }
  }

  /**
   * Create Socket.IO middleware
   */
  createMiddleware() {
    return async (socket: Socket, next: (err?: Error) => void) => {
      try {
        const result = await this.verifySocket(socket);

        if (!result.success) {
          console.warn(
            `🚫 Auth failed for socket ${socket.id}: ${result.error}`
          );
          return next(new Error(result.error || "Unauthorized"));
        }

        // Attach user data to socket
        socket.data.userId = result.userId;
        if (result.userData) {
          socket.data.user = result.userData;
        }

        console.log(
          `✅ Authenticated socket ${socket.id} as user: ${result.userId}`
        );
        next();
      } catch (error: any) {
        console.error(`❌ Auth middleware error:`, error);
        next(new Error("Authentication failed"));
      }
    };
  }

  /**
   * Cleanup all providers
   */
  async cleanup(): Promise<void> {
    for (const provider of this.providers) {
      if (provider.cleanup) {
        await provider.cleanup();
      }
    }
  }

  // Private strategy implementations

  private async verifyFirstSuccess(
    socket: Socket,
    providers: IAuthProvider[]
  ): Promise<AuthVerificationResult> {
    const errors: string[] = [];

    for (const provider of providers) {
      try {
        const result = await provider.verifySocket(socket);
        if (result.success) {
          return result;
        }
        if (result.error) {
          errors.push(`${provider.name}: ${result.error}`);
        }
      } catch (error: any) {
        errors.push(`${provider.name}: ${error.message}`);
      }
    }

    // All providers failed
    return this.handleNoProviders(socket, errors.join("; "));
  }

  private async verifyAllRequired(
    socket: Socket,
    providers: IAuthProvider[]
  ): Promise<AuthVerificationResult> {
    let userId: string | undefined;
    const userData: any = {};

    for (const provider of providers) {
      const result = await provider.verifySocket(socket);
      if (!result.success) {
        return {
          success: false,
          error: `${provider.name} verification failed: ${result.error}`,
        };
      }

      // Ensure all providers agree on userId
      if (userId && userId !== result.userId) {
        return {
          success: false,
          error: `User ID mismatch between providers`,
        };
      }

      userId = result.userId;
      if (result.userData) {
        Object.assign(userData, result.userData);
      }
    }

    return {
      success: true,
      userId,
      userData: Object.keys(userData).length > 0 ? userData : undefined,
    };
  }

  private async verifyFallbackChain(
    socket: Socket,
    providers: IAuthProvider[]
  ): Promise<AuthVerificationResult> {
    // Same as FIRST_SUCCESS but logs fallback attempts
    for (const provider of providers) {
      try {
        const result = await provider.verifySocket(socket);
        if (result.success) {
          if (providers.indexOf(provider) > 0) {
            console.log(
              `🔄 Fallback auth succeeded with provider: ${provider.name}`
            );
          }
          return result;
        }
      } catch (error: any) {
        console.warn(
          `⚠️ Provider ${provider.name} failed, trying next: ${error.message}`
        );
      }
    }

    return this.handleNoProviders(socket);
  }

  private handleNoProviders(
    socket: Socket,
    error?: string
  ): AuthVerificationResult {
    if (this.allowAnonymous) {
      // Try to extract anonymous ID from handshake
      const uuid = socket.handshake.query.uuid as string | undefined;
      const anonymousId = uuid || `${this.anonymousPrefix}${socket.id}`;

      console.warn(
        `⚠️ Anonymous auth for socket ${socket.id} -> ${anonymousId}`
      );

      return {
        success: true,
        userId: anonymousId,
        userData: { anonymous: true },
      };
    }

    return {
      success: false,
      error: error || "No authentication providers available",
    };
  }

  /**
   * Get enabled provider names
   */
  getEnabledProviders(): string[] {
    return this.providers.filter((p) => p.isEnabled()).map((p) => p.name);
  }

  /**
   * Get provider by name
   */
  getProvider(name: string): IAuthProvider | undefined {
    return this.providers.find((p) => p.name === name);
  }
}
