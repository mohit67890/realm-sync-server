# Sync Demo Implementation

Real-time data synchronization using Azure Web PubSub, Socket.IO, and MongoDB with timestamp-based versioning.

## Quick Start

### 1. Prerequisites

- Node.js 18+ and npm
- MongoDB running locally or connection string
- Azure subscription (for Web PubSub)

### 2. Setup Azure Web PubSub

```bash
# Login to Azure
az login

# Create resource group
az group create --name sync-demo-rg --location eastus

# Create Web PubSub service
az webpubsub create \
  --name sync-demo-pubsub \
  --resource-group sync-demo-rg \
  --location eastus \
  --sku Free_F1

# Get connection string
az webpubsub key show \
  --name sync-demo-pubsub \
  --resource-group sync-demo-rg \
  --query primaryConnectionString \
  --output tsv
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment

```bash
cp .env.example .env
# Edit .env with your MongoDB URI and Web PubSub connection string
```

### 5. Start the Server

```bash
npm run dev:server
```

Server will start on http://localhost:3000

Check health: http://localhost:3000/health

### 6. Run Example Clients

In separate terminals:

```bash
# Terminal 1 - Client 1
npm run dev:client

# Terminal 2 - Client 2 (different user)
ts-node client/example.ts demo-user-2
```

## Architecture

```
┌─────────────────┐         WebSocket         ┌─────────────────┐
│   Client 1      │◄──────────────────────────►│                 │
│  (Browser/Node) │                            │  Sync Server    │
└─────────────────┘                            │  (Node.js +     │
                                               │   Socket.IO)    │
┌─────────────────┐         WebSocket         │                 │
│   Client 2      │◄──────────────────────────►│                 │
│  (Browser/Node) │                            └────────┬────────┘
└─────────────────┘                                     │
                                                        │
                                                        ▼
                                               ┌─────────────────┐
                                               │    MongoDB      │
                                               │  - Data         │
                                               │  - Change Log   │
                                               └─────────────────┘
```

## Project Structure

```
sync-implementation/
├── server/
│   ├── index.ts          # Server entry point
│   ├── sync-server.ts    # Main sync server logic
│   └── database.ts       # MongoDB operations
├── client/
│   ├── sync-client.ts    # Client SDK
│   └── example.ts        # Example usage
├── shared/
│   ├── types.ts          # Shared TypeScript types
│   └── conflict-resolver.ts  # Conflict resolution strategies
├── tests/
│   ├── database.test.ts
│   └── integration.test.ts
└── package.json
```

## Features

### Core Sync (Inspired by Realm-Core Architecture)

✅ **WebSocket Connection Layer** - Socket.IO over HTTP/WebSocket with Azure Web PubSub
✅ **Changeset Structure** - Timestamp-based change tracking with version metadata
✅ **Pending Changes Queue** - Offline-first with persistent queue (MongoDB-backed)
✅ **Exponential Backoff Reconnection** - Smart reconnection with configurable delays
✅ **Version/Timestamp Tracking** - Last-write-wins conflict resolution
✅ **Progress Callbacks** - Socket.IO acknowledgments for operation completion
✅ **Optimistic Updates** - Apply changes locally first, rollback on server rejection
✅ **Message Acknowledgments** - Full request/response cycle with error propagation
✅ **Conflict Detection** - Server-side concurrent modification detection
✅ **Automatic Rollback** - Failed optimistic changes automatically reverted

### Additional Features

✅ Real-time bidirectional sync
✅ JWT authentication (optional)
✅ Rate limiting protection
✅ Change history/audit log
✅ Batch operations
✅ Connection health monitoring (`/health`, `/ready` endpoints)
✅ Graceful shutdown (SIGINT/SIGTERM handlers)
✅ Scoped broadcasts (per-user rooms)

## API Reference

### Server Endpoints

#### `GET /health`

Health check endpoint

**Response:**

```json
{
  "status": "healthy",
  "timestamp": 1234567890,
  "activeConnections": 5
}
```

#### `GET /stats`

Server statistics

**Response:**

```json
{
  "totalChanges": 1000,
  "syncedChanges": 950,
  "pendingChanges": 50,
  "activeConnections": 5,
  "activeUsers": ["user-1", "user-2"]
}
```

#### `GET /api/negotiate?userId=<userId>`

Get Web PubSub access token

### Socket.IO Events

#### Client → Server

##### `sync:join`

Join sync room

```typescript
socket.emit("sync:join", { userId: "user-1" }, (response) => {
  // response: { success: true, timestamp: number }
});
```

##### `sync:change`

Send a change

```typescript
socket.emit("sync:change", change, (ack) => {
  // ack: { changeId: string, success: boolean, timestamp?: number }
});
```

##### `sync:get_changes`

Request historical changes

```typescript
socket.emit("sync:get_changes", { userId: "user-1", since: 0 }, (response) => {
  // response: { changes: Change[], latestTimestamp: number, hasMore: boolean }
});
```

#### Server → Client

##### `sync:changes`

Receive changes from server

```typescript
socket.on("sync:changes", (changes: Change[]) => {
  // Handle incoming changes
});
```

## Client SDK Usage

### Initialize

```typescript
import { SyncClient } from "./client/sync-client";

const client = new SyncClient(
  "http://localhost:3000", // Server URL
  "user-123", // User ID
  "mongodb://localhost:27017/mydb" // Local MongoDB
);

await client.initialize();
await client.connect();
```

### Make Changes

```typescript
// Insert
await client.makeChange("insert", "tasks", "task-1", {
  title: "Buy milk",
  completed: false,
});

// Update
await client.makeChange("update", "tasks", "task-1", {
  completed: true,
});

// Delete
await client.makeChange("delete", "tasks", "task-1");
```

### Monitor Status

```typescript
client.isOnline(); // Check connection status
client.getPendingChangesCount(); // Get queued changes count
client.getLastSyncTimestamp(); // Get last sync time
```

### Cleanup

```typescript
await client.disconnect();
```

## Testing

### Run All Tests

```bash
npm test
```

### Run Tests in Watch Mode

```bash
npm run test:watch
```

### Run Integration Tests

```bash
npm run test:integration
```

## Configuration

### Environment Variables

| Variable                       | Description                        | Required                  |
| ------------------------------ | ---------------------------------- | ------------------------- |
| `MONGODB_URI`                  | MongoDB connection string          | Yes                       |
| `WEB_PUBSUB_CONNECTION_STRING` | Azure Web PubSub connection string | Yes                       |
| `WEB_PUBSUB_HUB_NAME`          | Web PubSub hub name                | Yes                       |
| `PORT`                         | Server port                        | No (default: 3000)        |
| `NODE_ENV`                     | Environment                        | No (default: development) |

## Production Deployment

### Build

```bash
npm run build
```

### Start Production Server

```bash
npm start
```

### Deploy to Azure

See `IMPLEMENTATION_GUIDE.md` for detailed deployment instructions.

## Troubleshooting

### Connection Issues

1. **Check MongoDB is running:**

   ```bash
   mongosh
   ```

2. **Verify Azure Web PubSub connection string:**

   ```bash
   echo $WEB_PUBSUB_CONNECTION_STRING
   ```

3. **Check server logs:**
   Look for connection errors in terminal output

### Sync Not Working

1. **Verify both clients are connected:**
   Check `client.isOnline()` returns true

2. **Check pending changes:**
   Use `client.getPendingChangesCount()`

3. **View server stats:**
   Visit http://localhost:3000/stats

## Performance Tips

1. **Batch changes** when making multiple updates
2. **Use indexes** on frequently queried collections
3. **Clean up old changes** regularly (runs automatically daily)
4. **Monitor metrics** via `/stats` endpoint

## Security Considerations

⚠️ This is a demo implementation. For production:

- [ ] Add authentication/authorization
- [ ] Validate all inputs
- [ ] Use HTTPS/WSS
- [ ] Implement rate limiting
- [ ] Add request signing
- [ ] Encrypt sensitive data
- [ ] Set up proper CORS

## License

MIT

## Support

For issues or questions, check the `IMPLEMENTATION_GUIDE.md` for detailed step-by-step instructions.
