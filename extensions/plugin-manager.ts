import { Socket } from "socket.io";
import {
  SyncServerPlugin,
  PluginContext,
  CustomEventHandler,
} from "./plugin-types";
import { Change } from "../shared/types";

/**
 * PluginManager handles loading, initializing, and executing plugins
 */
export class PluginManager {
  private plugins: SyncServerPlugin[] = [];
  private context: PluginContext | null = null;

  constructor() {}

  /**
   * Register a plugin
   */
  registerPlugin(plugin: SyncServerPlugin): void {
    // Check for duplicate plugin names
    if (this.plugins.some((p) => p.name === plugin.name)) {
      throw new Error(
        `Plugin with name "${plugin.name}" is already registered`
      );
    }

    this.plugins.push(plugin);
    console.log(
      `📦 Registered plugin: ${plugin.name} v${plugin.version}${plugin.description ? ` - ${plugin.description}` : ""}`
    );
  }

  /**
   * Initialize all plugins (called on server startup)
   */
  async initialize(context: PluginContext): Promise<void> {
    this.context = context;

    for (const plugin of this.plugins) {
      try {
        if (plugin.initialize) {
          await plugin.initialize(context);
          console.log(`✅ Initialized plugin: ${plugin.name}`);
        }
      } catch (error) {
        console.error(`❌ Failed to initialize plugin ${plugin.name}:`, error);
        throw error;
      }
    }
  }

  /**
   * Cleanup all plugins (called on server shutdown)
   */
  async cleanup(): Promise<void> {
    if (!this.context) return;

    for (const plugin of this.plugins) {
      try {
        if (plugin.cleanup) {
          await plugin.cleanup(this.context);
          console.log(`🧹 Cleaned up plugin: ${plugin.name}`);
        }
      } catch (error) {
        console.error(`❌ Failed to cleanup plugin ${plugin.name}:`, error);
      }
    }
  }

  /**
   * Get all custom event handlers from plugins
   */
  getCustomEventHandlers(): CustomEventHandler[] {
    return this.plugins
      .filter((p) => p.customEvents && p.customEvents.length > 0)
      .flatMap((p) => p.customEvents || []);
  }

  /**
   * Execute beforeJoin hooks
   */
  async executeBeforeJoin(socket: Socket, userId: string): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.hooks?.beforeJoin) {
        try {
          await plugin.hooks.beforeJoin(socket, userId);
        } catch (error) {
          console.error(
            `❌ Plugin ${plugin.name} beforeJoin hook failed:`,
            error
          );
          throw error; // Propagate to prevent join
        }
      }
    }
  }

  /**
   * Execute afterJoin hooks
   */
  async executeAfterJoin(socket: Socket, userId: string): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.hooks?.afterJoin) {
        try {
          await plugin.hooks.afterJoin(socket, userId);
        } catch (error) {
          console.error(
            `⚠️ Plugin ${plugin.name} afterJoin hook failed:`,
            error
          );
          // Don't throw - user already joined
        }
      }
    }
  }

  /**
   * Execute beforeChange hooks (can modify change)
   */
  async executeBeforeChange(
    socket: Socket,
    change: Change
  ): Promise<Change | void> {
    let modifiedChange: Change | void = change;

    for (const plugin of this.plugins) {
      if (plugin.hooks?.beforeChange) {
        try {
          const result = await plugin.hooks.beforeChange(
            socket,
            modifiedChange || change
          );
          if (result) {
            modifiedChange = result;
          }
        } catch (error) {
          console.error(
            `❌ Plugin ${plugin.name} beforeChange hook failed:`,
            error
          );
          throw error; // Propagate to reject change
        }
      }
    }

    return modifiedChange;
  }

  /**
   * Execute afterChange hooks
   */
  async executeAfterChange(socket: Socket, change: Change): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.hooks?.afterChange) {
        try {
          await plugin.hooks.afterChange(socket, change);
        } catch (error) {
          console.error(
            `⚠️ Plugin ${plugin.name} afterChange hook failed:`,
            error
          );
          // Don't throw - change already applied
        }
      }
    }
  }

  /**
   * Execute beforeUpdateSubscriptions hooks
   */
  async executeBeforeUpdateSubscriptions(
    socket: Socket,
    userId: string,
    subscriptions: any[]
  ): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.hooks?.beforeUpdateSubscriptions) {
        try {
          await plugin.hooks.beforeUpdateSubscriptions(
            socket,
            userId,
            subscriptions
          );
        } catch (error) {
          console.error(
            `❌ Plugin ${plugin.name} beforeUpdateSubscriptions hook failed:`,
            error
          );
          throw error;
        }
      }
    }
  }

  /**
   * Execute afterUpdateSubscriptions hooks
   */
  async executeAfterUpdateSubscriptions(
    socket: Socket,
    userId: string,
    version: number
  ): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.hooks?.afterUpdateSubscriptions) {
        try {
          await plugin.hooks.afterUpdateSubscriptions(socket, userId, version);
        } catch (error) {
          console.error(
            `⚠️ Plugin ${plugin.name} afterUpdateSubscriptions hook failed:`,
            error
          );
        }
      }
    }
  }

  /**
   * Execute onDisconnect hooks
   */
  async executeOnDisconnect(socket: Socket, userId?: string): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.hooks?.onDisconnect) {
        try {
          await plugin.hooks.onDisconnect(socket, userId);
        } catch (error) {
          console.error(
            `⚠️ Plugin ${plugin.name} onDisconnect hook failed:`,
            error
          );
        }
      }
    }
  }

  /**
   * Execute onServerStart hooks
   */
  async executeOnServerStart(): Promise<void> {
    if (!this.context) return;

    for (const plugin of this.plugins) {
      if (plugin.hooks?.onServerStart) {
        try {
          await plugin.hooks.onServerStart(this.context);
        } catch (error) {
          console.error(
            `⚠️ Plugin ${plugin.name} onServerStart hook failed:`,
            error
          );
        }
      }
    }
  }

  /**
   * Execute onServerStop hooks
   */
  async executeOnServerStop(): Promise<void> {
    if (!this.context) return;

    for (const plugin of this.plugins) {
      if (plugin.hooks?.onServerStop) {
        try {
          await plugin.hooks.onServerStop(this.context);
        } catch (error) {
          console.error(
            `⚠️ Plugin ${plugin.name} onServerStop hook failed:`,
            error
          );
        }
      }
    }
  }

  /**
   * Get all registered plugins
   */
  getPlugins(): SyncServerPlugin[] {
    return [...this.plugins];
  }
}
