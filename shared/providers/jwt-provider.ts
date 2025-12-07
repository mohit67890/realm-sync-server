import jwt from "jsonwebtoken";
import { Socket } from "socket.io";
import { IAuthProvider, AuthVerificationResult } from "../auth-provider";

/**
 * JWT Authentication Provider Configuration
 */
export interface JWTProviderConfig {
  secret: string;
  /** Where to look for token: 'auth' (socket.handshake.auth.token) or 'query' (socket.handshake.query.token) */
  tokenLocation?: "auth" | "query" | "both";
  /** Custom token field name (default: 'token') */
  tokenField?: string;
  /** Verify token options */
  verifyOptions?: jwt.VerifyOptions;
}

/**
 * JWT Authentication Provider
 * Verifies JWT tokens from socket handshake
 */
export class JWTAuthProvider implements IAuthProvider {
  readonly name = "jwt";
  private config?: JWTProviderConfig;

  async initialize(config: JWTProviderConfig): Promise<void> {
    if (!config.secret) {
      throw new Error("JWT secret is required");
    }
    this.config = {
      ...config,
      tokenLocation: config.tokenLocation || "auth",
      tokenField: config.tokenField || "token",
    };
    console.log(
      `🔐 JWT provider initialized (location: ${this.config.tokenLocation})`
    );
  }

  async verifySocket(socket: Socket): Promise<AuthVerificationResult> {
    if (!this.config) {
      return { success: false, error: "JWT provider not initialized" };
    }

    const token = this.extractToken(socket);
    if (!token) {
      return { success: false, error: "JWT token not found" };
    }

    return this.verifyCredentials(token);
  }

  async verifyCredentials(token: string): Promise<AuthVerificationResult> {
    if (!this.config) {
      return { success: false, error: "JWT provider not initialized" };
    }

    try {
      const payload = jwt.verify(
        token,
        this.config.secret,
        this.config.verifyOptions
      ) as any;

      const userId = payload.sub || payload.userId || payload.uid;
      if (!userId) {
        return { success: false, error: "JWT token missing user identifier" };
      }

      return {
        success: true,
        userId,
        userData: payload,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `JWT verification failed: ${error.message}`,
      };
    }
  }

  isEnabled(): boolean {
    return !!this.config?.secret;
  }

  private extractToken(socket: Socket): string | undefined {
    if (!this.config) return undefined;

    const { tokenLocation, tokenField } = this.config;

    if (tokenLocation === "auth" || tokenLocation === "both") {
      const token = socket.handshake.auth?.[tokenField!];
      if (token) return Array.isArray(token) ? token[0] : token;
    }

    if (tokenLocation === "query" || tokenLocation === "both") {
      const token = socket.handshake.query?.[tokenField!];
      if (token) return Array.isArray(token) ? token[0] : token;
    }

    return undefined;
  }
}

/**
 * Create JWT provider from environment variables
 */
export function createJWTProviderFromEnv(): JWTAuthProvider {
  const provider = new JWTAuthProvider();
  const secret = process.env.AUTH_JWT_SECRET;

  if (secret) {
    provider.initialize({
      secret,
      tokenLocation: "both", // Support both auth and query
    });
  }

  return provider;
}
