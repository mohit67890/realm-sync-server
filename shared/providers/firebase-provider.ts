import { Socket } from "socket.io";
import * as fs from "fs";
import { IAuthProvider, AuthVerificationResult } from "../auth-provider";

/**
 * Firebase Authentication Provider Configuration
 */
export interface FirebaseProviderConfig {
  /** Firebase Admin SDK initialized instance */
  adminApp?: any;
  /** Service account credentials (JSON object) */
  serviceAccount?: any;
  /** Base64 encoded credentials */
  credentialsBase64?: string;
  /** Path to credentials file */
  credentialsFile?: string;
  /** Where to look for token: 'query', 'header', or 'both' */
  tokenLocation?: "query" | "header" | "both";
  /** Token field name in query (default: 'idToken') */
  queryTokenField?: string;
  /** UUID field name in query for fallback (default: 'uuid') */
  uuidField?: string;
}

/**
 * Firebase Authentication Provider
 * Verifies Firebase ID tokens from socket handshake
 */
export class FirebaseAuthProvider implements IAuthProvider {
  readonly name = "firebase";
  private admin: any = null;
  private config?: FirebaseProviderConfig;

  async initialize(config: FirebaseProviderConfig): Promise<void> {
    this.config = {
      ...config,
      tokenLocation: config.tokenLocation || "both",
      queryTokenField: config.queryTokenField || "idToken",
      uuidField: config.uuidField || "uuid",
    };

    // Try to load firebase-admin
    try {
      this.admin = require("firebase-admin");
    } catch (e) {
      console.warn(
        "⚠️ firebase-admin not installed. Run: npm install firebase-admin"
      );
      return;
    }

    // Initialize Firebase Admin if not already initialized
    if (config.adminApp) {
      // Use provided admin app
      console.log("🔥 Using provided Firebase Admin app");
      return;
    }

    if (this.admin.apps.length > 0) {
      console.log("🔥 Firebase Admin already initialized");
      return;
    }

    // Load credentials
    const credentials = this.loadCredentials();
    if (!credentials) {
      console.warn(
        "⚠️ Firebase credentials not found. Token auth will be disabled."
      );
      return;
    }

    // Initialize Firebase Admin
    this.admin.initializeApp({
      credential: this.admin.credential.cert(credentials),
    });
    console.log("🔥 Firebase Admin initialized");
  }

  async verifySocket(socket: Socket): Promise<AuthVerificationResult> {
    if (!this.isEnabled()) {
      return { success: false, error: "Firebase provider not initialized" };
    }

    const token = this.extractToken(socket);
    if (!token) {
      // Try UUID fallback if configured
      const uuid = socket.handshake.query[this.config!.uuidField!] as
        | string
        | undefined;
      if (uuid) {
        console.warn(
          `⚠️ Firebase token not found, using UUID fallback: ${uuid}`
        );
        return {
          success: true,
          userId: uuid,
          userData: { source: "uuid_fallback", anonymous: true },
        };
      }
      return { success: false, error: "Firebase ID token not found" };
    }

    return this.verifyCredentials(token);
  }

  async verifyCredentials(idToken: string): Promise<AuthVerificationResult> {
    if (!this.isEnabled()) {
      return { success: false, error: "Firebase provider not initialized" };
    }

    try {
      const decodedToken = await this.admin.auth().verifyIdToken(idToken);

      return {
        success: true,
        userId: decodedToken.uid,
        userData: {
          email: decodedToken.email,
          emailVerified: decodedToken.email_verified,
          name: decodedToken.name,
          picture: decodedToken.picture,
          firebase: decodedToken,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Firebase token verification failed: ${error.message}`,
      };
    }
  }

  isEnabled(): boolean {
    return !!(this.admin && this.admin.apps.length > 0);
  }

  async cleanup(): Promise<void> {
    if (this.admin && this.admin.apps.length > 0) {
      await Promise.all(this.admin.apps.map((app: any) => app.delete()));
      console.log("🔥 Firebase Admin cleaned up");
    }
  }

  private loadCredentials(): any {
    if (!this.config) return null;

    try {
      // 1. From base64 env var
      if (this.config.credentialsBase64) {
        const json = Buffer.from(
          this.config.credentialsBase64,
          "base64"
        ).toString("utf8");
        return JSON.parse(json);
      }

      // 2. From service account object
      if (this.config.serviceAccount) {
        return this.config.serviceAccount;
      }

      // 3. From file path
      const filePath = this.config.credentialsFile;
      if (filePath && fs.existsSync(filePath)) {
        const json = fs.readFileSync(filePath, "utf8");
        return JSON.parse(json);
      }
    } catch (e: any) {
      console.error("❌ Failed to load Firebase credentials:", e.message);
    }

    return null;
  }

  private extractToken(socket: Socket): string | undefined {
    if (!this.config) return undefined;

    const { tokenLocation, queryTokenField } = this.config;

    // 1. Try query parameter
    if (tokenLocation === "query" || tokenLocation === "both") {
      const qToken = socket.handshake.query[queryTokenField!];
      if (qToken) {
        return Array.isArray(qToken) ? qToken[0] : qToken;
      }
    }

    // 2. Try Authorization header
    if (tokenLocation === "header" || tokenLocation === "both") {
      const authHeader =
        socket.handshake.headers["authorization"] ||
        socket.handshake.headers["Authorization"];

      if (authHeader) {
        const headerValue = Array.isArray(authHeader)
          ? authHeader[0]
          : authHeader;
        const parts = headerValue.split(" ");
        if (parts.length === 2 && parts[0] === "Bearer") {
          return parts[1];
        }
      }
    }

    return undefined;
  }
}

/**
 * Create Firebase provider from environment variables
 */
export function createFirebaseProviderFromEnv(): FirebaseAuthProvider {
  const provider = new FirebaseAuthProvider();

  const config: FirebaseProviderConfig = {
    tokenLocation: "both",
  };

  // Try to load credentials from environment
  if (process.env.FIREBASE_ADMIN_CREDENTIALS_B64) {
    config.credentialsBase64 = process.env.FIREBASE_ADMIN_CREDENTIALS_B64;
  } else if (process.env.FIREBASE_ADMIN_CREDENTIALS) {
    try {
      config.serviceAccount = JSON.parse(
        process.env.FIREBASE_ADMIN_CREDENTIALS
      );
    } catch (e) {
      console.error("❌ Invalid FIREBASE_ADMIN_CREDENTIALS JSON");
    }
  } else if (
    process.env.FIREBASE_ADMIN_CREDENTIALS_FILE ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  ) {
    config.credentialsFile =
      process.env.FIREBASE_ADMIN_CREDENTIALS_FILE ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }

  provider.initialize(config);
  return provider;
}
