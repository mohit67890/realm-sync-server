#!/usr/bin/env ts-node
import { Server } from "socket.io";
import { createServer } from "http";

/**
 * Minimal Socket.IO v4 test server for validating C++ SocketIOClient
 *
 * Features:
 * - Basic connect/disconnect logging
 * - Echo event: client sends "echo", server responds with same data
 * - Upload event: client sends "upload", server logs and acknowledges
 * - Download event: server can push "download" events to clients
 * - Ping-pong keepalive
 */

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3030;

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  transports: ["websocket"], // Force WebSocket only for testing
  pingInterval: 25000,
  pingTimeout: 60000,
});

console.log("🚀 Socket.IO Test Server starting...");

io.on("connection", (socket) => {
  console.log(`✅ Client connected: ${socket.id}`);
  console.log(`   - Transport: ${socket.conn.transport.name}`);
  console.log(`   - Namespace: ${socket.nsp.name}`);

  // Echo event handler
  socket.on("echo", (data) => {
    console.log(`📨 Received 'echo' event from ${socket.id}:`, data);
    socket.emit("echo", data);
    console.log(`📤 Sent 'echo' response to ${socket.id}`);
  });

  // Upload event handler (simulates client uploading changesets)
  socket.on("upload", (data) => {
    console.log(`📥 Received 'upload' event from ${socket.id}:`, data);

    // Validate payload structure
    if (data && typeof data === "object") {
      const { changeset_id, timestamp, operations } = data;
      console.log(`   - Changeset ID: ${changeset_id}`);
      console.log(`   - Timestamp: ${timestamp}`);
      console.log(`   - Operations: ${operations?.length || 0}`);
    }

    // Acknowledge upload
    socket.emit("upload_ack", {
      status: "success",
      changeset_id: data?.changeset_id || "unknown",
      server_timestamp: Date.now(),
    });
    console.log(`✅ Sent 'upload_ack' to ${socket.id}`);
  });

  // Download request handler (client requests server changes)
  socket.on("download_request", (data) => {
    console.log(`📨 Received 'download_request' from ${socket.id}:`, data);

    // Simulate server sending a download event
    const mockChangeset = {
      changeset_id: `cs_${Date.now()}`,
      timestamp: Date.now(),
      operations: [
        {
          type: "create",
          table: "users",
          pk: "user_123",
          data: { name: "Alice" },
        },
        {
          type: "update",
          table: "users",
          pk: "user_456",
          data: { name: "Bob" },
        },
      ],
    };

    socket.emit("download", mockChangeset);
    console.log(`📤 Sent 'download' event to ${socket.id}`);
  });

  // Custom sync event handler
  socket.on("sync", (data) => {
    console.log(`🔄 Received 'sync' event from ${socket.id}:`, data);
    socket.emit("sync_response", {
      status: "synced",
      timestamp: Date.now(),
      received: data,
    });
  });

  // Disconnect handler
  socket.on("disconnect", (reason) => {
    console.log(`❌ Client disconnected: ${socket.id}, reason: ${reason}`);
  });

  // Error handler
  socket.on("error", (error) => {
    console.error(`⚠️ Socket error for ${socket.id}:`, error);
  });

  // Send welcome message
  socket.emit("welcome", {
    message: "Connected to Socket.IO test server",
    server_time: Date.now(),
    socket_id: socket.id,
  });
});

// Server-side periodic broadcast (optional)
setInterval(() => {
  const connectedClients = io.sockets.sockets.size;
  if (connectedClients > 0) {
    console.log(`📊 Status: ${connectedClients} client(s) connected`);

    // Broadcast a test download event every 30 seconds
    io.emit("periodic_update", {
      timestamp: Date.now(),
      message: "Periodic server update",
    });
  }
}, 30000);

httpServer.listen(PORT, () => {
  console.log(`✅ Socket.IO Test Server listening on http://localhost:${PORT}`);
  console.log(`   - Engine.IO protocol: v4`);
  console.log(`   - Socket.IO protocol: v5`);
  console.log(`   - Transports: websocket only`);
  console.log(`\n💡 Test with C++ client: ws://localhost:${PORT}`);
  console.log(`\n📋 Available events:`);
  console.log(`   - Client → Server: echo, upload, download_request, sync`);
  console.log(
    `   - Server → Client: welcome, echo, upload_ack, download, sync_response, periodic_update`
  );
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down test server...");
  io.close(() => {
    httpServer.close(() => {
      console.log("✅ Server closed");
      process.exit(0);
    });
  });
});
