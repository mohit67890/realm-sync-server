/**
 * Tests for the plugin system
 */
import { PluginManager } from "../extensions/plugin-manager";
import { SyncServerPlugin } from "../extensions/plugin-types";
import { Socket } from "socket.io";
import { Change } from "../shared/types";

describe("Plugin System", () => {
  let pluginManager: PluginManager;

  beforeEach(() => {
    pluginManager = new PluginManager();
  });

  describe("Plugin Registration", () => {
    it("should register a plugin successfully", () => {
      const testPlugin: SyncServerPlugin = {
        name: "test-plugin",
        version: "1.0.0",
      };

      pluginManager.registerPlugin(testPlugin);

      const plugins = pluginManager.getPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe("test-plugin");
    });

    it("should reject duplicate plugin names", () => {
      const plugin1: SyncServerPlugin = {
        name: "duplicate",
        version: "1.0.0",
      };
      const plugin2: SyncServerPlugin = {
        name: "duplicate",
        version: "2.0.0",
      };

      pluginManager.registerPlugin(plugin1);

      expect(() => {
        pluginManager.registerPlugin(plugin2);
      }).toThrow('Plugin with name "duplicate" is already registered');
    });
  });

  describe("Plugin Initialization", () => {
    it("should initialize plugins with context", async () => {
      const initializeSpy = jest.fn();

      const testPlugin: SyncServerPlugin = {
        name: "init-test",
        version: "1.0.0",
        initialize: initializeSpy,
      };

      pluginManager.registerPlugin(testPlugin);

      const mockContext: any = {
        app: {},
        io: {},
        db: {},
        activeConnections: new Map(),
        userSubscriptions: new Map(),
        version: "test",
      };

      await pluginManager.initialize(mockContext);

      expect(initializeSpy).toHaveBeenCalledWith(mockContext);
    });
  });

  describe("beforeJoin Hook", () => {
    it("should execute beforeJoin hooks", async () => {
      const beforeJoinSpy = jest.fn();

      const testPlugin: SyncServerPlugin = {
        name: "join-test",
        version: "1.0.0",
        hooks: {
          beforeJoin: beforeJoinSpy,
        },
      };

      pluginManager.registerPlugin(testPlugin);

      const mockSocket = {} as Socket;
      await pluginManager.executeBeforeJoin(mockSocket, "user123");

      expect(beforeJoinSpy).toHaveBeenCalledWith(mockSocket, "user123");
    });

    it("should reject join if hook throws error", async () => {
      const testPlugin: SyncServerPlugin = {
        name: "reject-test",
        version: "1.0.0",
        hooks: {
          beforeJoin: async (socket, userId) => {
            throw new Error("User banned");
          },
        },
      };

      pluginManager.registerPlugin(testPlugin);

      const mockSocket = {} as Socket;
      await expect(
        pluginManager.executeBeforeJoin(mockSocket, "banned-user")
      ).rejects.toThrow("User banned");
    });
  });

  describe("beforeChange Hook", () => {
    it("should allow modification of change data", async () => {
      const testPlugin: SyncServerPlugin = {
        name: "modify-test",
        version: "1.0.0",
        hooks: {
          beforeChange: async (socket, change) => {
            // Modify change data
            return {
              ...change,
              data: {
                ...change.data,
                modified: true,
              },
            };
          },
        },
      };

      pluginManager.registerPlugin(testPlugin);

      const mockSocket = {} as Socket;
      const originalChange: Change = {
        id: "1",
        userId: "user123",
        timestamp: Date.now(),
        operation: "update",
        collection: "test",
        documentId: "doc1",
        data: { value: "original" },
        synced: false,
      };

      const result = await pluginManager.executeBeforeChange(
        mockSocket,
        originalChange
      );

      expect(result).toBeDefined();
      expect((result as Change).data?.modified).toBe(true);
      expect((result as Change).data?.value).toBe("original");
    });

    it("should reject change if hook throws error", async () => {
      const testPlugin: SyncServerPlugin = {
        name: "validate-test",
        version: "1.0.0",
        hooks: {
          beforeChange: async (socket, change) => {
            if (!change.data?.required) {
              throw new Error("Missing required field");
            }
          },
        },
      };

      pluginManager.registerPlugin(testPlugin);

      const mockSocket = {} as Socket;
      const invalidChange: Change = {
        id: "1",
        userId: "user123",
        timestamp: Date.now(),
        operation: "update",
        collection: "test",
        documentId: "doc1",
        data: {},
        synced: false,
      };

      await expect(
        pluginManager.executeBeforeChange(mockSocket, invalidChange)
      ).rejects.toThrow("Missing required field");
    });
  });

  describe("afterChange Hook", () => {
    it("should execute afterChange hooks", async () => {
      const afterChangeSpy = jest.fn();

      const testPlugin: SyncServerPlugin = {
        name: "after-test",
        version: "1.0.0",
        hooks: {
          afterChange: afterChangeSpy,
        },
      };

      pluginManager.registerPlugin(testPlugin);

      const mockSocket = {} as Socket;
      const change: Change = {
        id: "1",
        userId: "user123",
        timestamp: Date.now(),
        operation: "insert",
        collection: "test",
        documentId: "doc1",
        synced: true,
      };

      await pluginManager.executeAfterChange(mockSocket, change);

      expect(afterChangeSpy).toHaveBeenCalledWith(mockSocket, change);
    });

    it("should not throw if afterChange hook fails", async () => {
      const testPlugin: SyncServerPlugin = {
        name: "failing-after",
        version: "1.0.0",
        hooks: {
          afterChange: async () => {
            throw new Error("Notification service down");
          },
        },
      };

      pluginManager.registerPlugin(testPlugin);

      const mockSocket = {} as Socket;
      const change: Change = {
        id: "1",
        userId: "user123",
        timestamp: Date.now(),
        operation: "insert",
        collection: "test",
        documentId: "doc1",
        synced: true,
      };

      // Should not throw - just log error
      await expect(
        pluginManager.executeAfterChange(mockSocket, change)
      ).resolves.not.toThrow();
    });
  });

  describe("Custom Event Handlers", () => {
    it("should collect custom event handlers from plugins", () => {
      const testPlugin: SyncServerPlugin = {
        name: "events-test",
        version: "1.0.0",
        customEvents: [
          {
            event: "custom:action1",
            handler: async () => {},
          },
          {
            event: "custom:action2",
            handler: async () => {},
            rateLimit: 10,
          },
        ],
      };

      pluginManager.registerPlugin(testPlugin);

      const handlers = pluginManager.getCustomEventHandlers();
      expect(handlers).toHaveLength(2);
      expect(handlers[0].event).toBe("custom:action1");
      expect(handlers[1].event).toBe("custom:action2");
      expect(handlers[1].rateLimit).toBe(10);
    });
  });

  describe("Plugin Cleanup", () => {
    it("should cleanup plugins on server stop", async () => {
      const cleanupSpy = jest.fn();

      const testPlugin: SyncServerPlugin = {
        name: "cleanup-test",
        version: "1.0.0",
        cleanup: cleanupSpy,
      };

      pluginManager.registerPlugin(testPlugin);

      const mockContext: any = {
        app: {},
        io: {},
        db: {},
        activeConnections: new Map(),
        userSubscriptions: new Map(),
        version: "test",
      };

      await pluginManager.initialize(mockContext);
      await pluginManager.cleanup();

      expect(cleanupSpy).toHaveBeenCalledWith(mockContext);
    });
  });

  describe("Multiple Plugins", () => {
    it("should execute hooks in registration order", async () => {
      const executionOrder: string[] = [];

      const plugin1: SyncServerPlugin = {
        name: "plugin1",
        version: "1.0.0",
        hooks: {
          afterJoin: async () => {
            executionOrder.push("plugin1");
          },
        },
      };

      const plugin2: SyncServerPlugin = {
        name: "plugin2",
        version: "1.0.0",
        hooks: {
          afterJoin: async () => {
            executionOrder.push("plugin2");
          },
        },
      };

      pluginManager.registerPlugin(plugin1);
      pluginManager.registerPlugin(plugin2);

      const mockSocket = {} as Socket;
      await pluginManager.executeAfterJoin(mockSocket, "user123");

      expect(executionOrder).toEqual(["plugin1", "plugin2"]);
    });
  });
});
