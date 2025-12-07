import { Socket } from "socket.io";
import { Express } from "express";
import { Database } from "../server/database";
import { Change } from "../shared/types";

/**
 * Plugin context provides access to server internals
 */
export interface PluginContext {
  /** Express app instance for adding custom REST endpoints */
  app: Express;
  /** Socket.IO server instance */
  io: import("socket.io").Server;
  /** Database instance for direct MongoDB access */
  db: Database;
  /** Active user connections map */
  activeConnections: Map<string, Set<string>>;
  /** User subscriptions map */
  userSubscriptions: Map<string, any>;
  /** Server version */
  version: string;
}

/**
 * Event hooks allow intercepting and extending built-in events
 */
export interface EventHooks {
  /** Called before a user joins (can reject by throwing error) */
  beforeJoin?: (socket: Socket, userId: string) => Promise<void> | void;
  /** Called after a user successfully joins */
  afterJoin?: (socket: Socket, userId: string) => Promise<void> | void;

  /** Called before a change is processed (can modify or reject) */
  beforeChange?: (
    socket: Socket,
    change: Change
  ) => Promise<Change | void> | Change | void;
  /** Called after a change is successfully applied */
  afterChange?: (socket: Socket, change: Change) => Promise<void> | void;

  /** Called before broadcasting a change (can transform the change data) */
  broadcastProcessor?: (
    socket: Socket,
    change: Change,
    targetUserId: string
  ) => Promise<Change | void> | Change | void;

  /** Called before sending a callback response (can transform the response) */
  callbackProcessor?: (
    socket: Socket,
    eventName: string,
    response: any,
    originalData?: any
  ) => Promise<any> | any;

  /** Called before subscriptions are updated */
  beforeUpdateSubscriptions?: (
    socket: Socket,
    userId: string,
    subscriptions: any[]
  ) => Promise<void> | void;
  /** Called after subscriptions are successfully updated */
  afterUpdateSubscriptions?: (
    socket: Socket,
    userId: string,
    version: number
  ) => Promise<void> | void;

  /** Called when a socket disconnects */
  onDisconnect?: (socket: Socket, userId?: string) => Promise<void> | void;

  /** Called on server startup (after database connection) */
  onServerStart?: (context: PluginContext) => Promise<void> | void;
  /** Called on server shutdown (before database close) */
  onServerStop?: (context: PluginContext) => Promise<void> | void;
}

/**
 * Custom socket event handlers
 */
export interface CustomEventHandler {
  /** Event name (e.g., "custom:action") */
  event: string;
  /** Handler function (with optional callback support) */
  handler: (
    socket: Socket,
    data: any,
    callback?: (response: any) => void
  ) => Promise<void> | void;
  /** Optional: Rate limit for this event (requests per window) */
  rateLimit?: number;
}

/**
 * Plugin interface - implement this to create a plugin
 */
export interface SyncServerPlugin {
  /** Plugin name (must be unique) */
  name: string;
  /** Plugin version */
  version: string;
  /** Optional: Plugin description */
  description?: string;

  /** Event hooks to intercept built-in events */
  hooks?: EventHooks;

  /** Custom socket event handlers to register */
  customEvents?: CustomEventHandler[];

  /**
   * Initialize plugin (called once on server startup)
   * Use this to set up any resources, connect to external services, etc.
   */
  initialize?: (context: PluginContext) => Promise<void> | void;

  /**
   * Cleanup plugin (called on server shutdown)
   * Use this to release resources, close connections, etc.
   */
  cleanup?: (context: PluginContext) => Promise<void> | void;
}
