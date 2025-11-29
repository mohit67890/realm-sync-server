/**
 * Extension system exports
 */
export { PluginManager } from "./plugin-manager";
export {
  SyncServerPlugin,
  PluginContext,
  EventHooks,
  CustomEventHandler,
} from "./plugin-types";

// Re-export example plugins for convenience
export * from "./examples";
