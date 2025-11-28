# Realm Sync Server

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Real-time, offline-first sync for Realm-backed apps. Socket.IO + MongoDB with timestamp-based conflict resolution. Built for mobile and web.

## ✨ Highlights

- 🔄 Real-time bi-directional sync over WebSockets
- 📱 Offline-first with durable outbox queue
- ⚡ Optimistic updates; instant UI then server-verify
- 🔀 Conflict resolution via last-write-wins timestamps
- 🎯 Flexible subscriptions (server-side filtering)
- 🔐 JWT auth, 🛡️ rate limiting, 📝 audit log
- 🌐 Optional Azure Web PubSub for horizontal scale

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- MongoDB 5.0+ (local or Atlas)
- Azure subscription (optional; for Web PubSub scaling)

### Installation

```bash
npm install
```

### Configuration

Create a `.env` file:

```bash
# MongoDB Configuration
MONGODB_URI=mongodb://localhost:27017/realm-sync

# Azure Web PubSub (Optional - for horizontal scaling)
WEB_PUBSUB_CONNECTION_STRING=Endpoint=https://your-pubsub.webpubsub.azure.com;AccessKey=YOUR_KEY;Version=1.0;
WEB_PUBSUB_HUB_NAME=Hub

# Server Configuration
PORT=3000
NODE_ENV=development

# Security (Production)
AUTH_JWT_SECRET=your-secret-key-here

# Performance Tuning
MAX_CONNECTIONS_PER_USER=10
SYNC_RATE_LIMIT_MAX=50
SYNC_RATE_LIMIT_WINDOW_MS=10000
```

### Start Development Server

```bash
npm run dev:server
```

Server starts on `http://localhost:3000`

**Health check:** http://localhost:3000/health  
**Metrics:** http://localhost:3000/stats

### Try It: Example Clients

Open multiple terminals to simulate real-time sync:

```bash
# Terminal 1 - First client
npm run dev:client

# Terminal 2 - Second client (simulates another device)
npx ts-node client/example.ts demo-user-2

# Terminal 3 - Third client (observe real-time sync)
npx ts-node client/example.ts demo-user-3
```

Watch as changes made in one client instantly appear in all others! 🎉

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Client Layer                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ Flutter  │  │   Web    │  │  React   │  │ Node.js  │       │
│  │  Mobile  │  │ Browser  │  │  Native  │  │  Client  │       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘       │
│       │             │               │             │              │
│       └─────────────┴───────────────┴─────────────┘              │
│                          │                                        │
│                   Socket.IO (WebSocket/HTTP)                     │
└──────────────────────────┼──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                     Sync Server Layer                            │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ Socket.IO Server + TypeScript + Express               │    │
│  ├────────────────────────────────────────────────────────┤    │
│  │ • Authentication & Authorization                       │    │
│  │ • Rate Limiting & Security                            │    │
│  │ • Connection Management (per-user rooms)              │    │
│  │ • Subscription Management (FLX filtering)             │    │
│  │ • Conflict Resolution (timestamp-based)               │    │
│  │ • Change Broadcasting                                  │    │
│  │ • Query Translation (RQL → MongoDB)                   │    │
│  └────────────────────────────────────────────────────────┘    │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                    Persistence Layer                             │
│  ┌──────────────┐        ┌──────────────┐                      │
│  │   MongoDB    │        │   Change     │                      │
│  │              │        │   Audit Log  │                      │
│  │ • Documents  │        │ • Timestamps │                      │
│  │ • Collections│◄───────┤ • Operations │                      │
│  │ • Indexes    │        │ • User IDs   │                      │
│  └──────────────┘        └──────────────┘                      │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│              Optional: Azure Web PubSub                          │
│  (Horizontal Scaling for 1000+ Concurrent Connections)          │
│                                                                   │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐               │
│  │ Server │  │ Server │  │ Server │  │ Server │               │
│  │ Node 1 │  │ Node 2 │  │ Node 3 │  │ Node N │               │
│  └────┬───┘  └────┬───┘  └────┬───┘  └────┬───┘               │
│       └───────────┴───────────┴───────────┘                     │
│                        │                                         │
│              Azure Web PubSub Hub                               │
└──────────────────────────────────────────────────────────────────┘
```

### Data Flow

1) Client makes change (optimistic) → sends to server
2) Server validates → resolves conflicts via `sync_updated_at`
3) Server persists (MongoDB) → writes audit log
4) Server broadcasts to subscribers
5) Clients apply + update UI

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

## 📋 Use Cases

- Offline-first mobile (Flutter/React Native)
- Collaborative, multi-user apps
- IoT device-to-cloud sync
- Field service with spotty connectivity
- Chats and activity feeds
- Multi-tenant SaaS with scoped access

## 🎯 Key Concepts

### Conflict Resolution

Last-write-wins via `sync_updated_at` (UTC ms):

```typescript
if (local.sync_updated_at >= remote.sync_updated_at) {
  // Keep local version (newer or equal)
} else {
  // Apply remote version (remote is newer)
}
```

### Subscriptions (Flexible Sync)

Filter server data with MongoDB-style queries:

```typescript
// Client subscribes to only their own tasks
socket.emit('sync:subscribe', {
  collection: 'tasks',
  filter: 'userId == $0',
  args: [currentUserId]
});
```

### Historical Sync

Catch up after offline periods:

```typescript
socket.emit('sync:get_changes', {
  collection: 'tasks',
  since: lastSyncTimestamp,
  limit: 500
});
```

## 📡 API Reference

### REST

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/ready` | GET | Readiness probe (MongoDB) |
| `/stats` | GET | Metrics & counters |
| `/api/negotiate?userId=<id>` | GET | Web PubSub token |

<details>
<summary><b>Example Response: GET /stats</b></summary>

```json
{
  "totalChanges": 15420,
  "syncedChanges": 15380,
  "pendingChanges": 40,
  "activeConnections": 23,
  "activeUsers": ["user-1", "user-2", "user-3"]
}
```
</details>

### Socket.IO

#### 🔼 Client → Server

<details>
<summary><code>sync:join</code> - Join sync session</summary>

```typescript
socket.emit('sync:join', 
  { userId: 'user-123', token: 'jwt-token' }, 
  (response) => {
    console.log(response); // { success: true, timestamp: 1234567890 }
  }
);
```
</details>

<details>
<summary><code>sync:change</code> - Send single change</summary>

```typescript
const change = {
  operation: 'update',
  collection: 'tasks',
  documentId: 'task-1',
  data: { title: 'Updated', completed: true },
  timestamp: Date.now()
};

socket.emit('sync:change', change, (ack) => {
  console.log(ack); // { success: true, changeId: '...' }
});
```
</details>

<details>
<summary><code>sync:changeBatch</code> - Send multiple changes efficiently</summary>

```typescript
socket.emit('sync:changeBatch', {
  changes: [
    { operation: 'update', collection: 'tasks', documentId: 'task-1', data: {...} },
    { operation: 'delete', collection: 'tasks', documentId: 'task-2' }
  ]
}, (response) => {
  console.log(response.results); // Array of results per change
});
```
</details>

<details>
<summary><code>sync:subscribe</code> - Subscribe to filtered data</summary>

```typescript
socket.emit('sync:subscribe', {
  collection: 'tasks',
  filter: 'userId == $0 AND status == $1',
  args: ['user-123', 'active']
});
```
</details>

<details>
<summary><code>sync:get_changes</code> - Fetch historical changes</summary>

```typescript
socket.emit('sync:get_changes', {
  userId: 'user-123',
  collection: 'tasks',
  since: 1234567890,
  limit: 500
}, (response) => {
  console.log(response.changes.length);
  console.log(response.latestTimestamp);
  console.log(response.hasMore);
});
```
</details>

#### 🔽 Server → Client

<details>
<summary><code>sync:bootstrap</code> - Initial data load</summary>

```typescript
socket.on('sync:bootstrap', (payload) => {
  console.log(payload.collection); // 'tasks'
  console.log(payload.data);       // Array of documents
});
```
</details>

<details>
<summary><code>sync:changes</code> - Real-time change notifications</summary>

```typescript
socket.on('sync:changes', (changes) => {
  changes.forEach(change => {
    console.log(change.operation);   // 'update' | 'delete'
    console.log(change.collection);  // 'tasks'
    console.log(change.documentId);
    console.log(change.data);
  });
});
```
</details>

## 💻 Client SDK

### Basic Example

```typescript
import { SyncClient } from './client/sync-client';

// Initialize client
const client = new SyncClient(
  'http://localhost:3000',              // Server URL
  'user-123',                            // User ID
  'mongodb://localhost:27017/myapp'     // Local MongoDB (for offline queue)
);

await client.initialize();
await client.connect();

// Make changes (automatically synced)
await client.makeChange('insert', 'tasks', 'task-1', {
  title: 'Buy groceries',
  completed: false,
  userId: 'user-123',
  sync_updated_at: Date.now()
});

await client.makeChange('update', 'tasks', 'task-1', {
  completed: true,
  sync_updated_at: Date.now()
});

await client.makeChange('delete', 'tasks', 'task-1');

// Monitor connection
console.log('Online:', client.isOnline());
console.log('Pending:', client.getPendingChangesCount());
console.log('Last sync:', new Date(client.getLastSyncTimestamp()));

// Cleanup
await client.disconnect();
```

### Flutter/Dart

See the [Dart client SDK](../lib/services/RealmSync.dart) for Flutter integration.

```dart
final realmSync = RealmSync(
  realm: realm,
  socket: socket,
  userId: userId,
  configs: [
    SyncCollectionConfig<ChatMessage>(
      results: realm.all<ChatMessage>(),
      collectionName: 'chat_messages',
      idSelector: (m) => m.id,
      needsSync: (m) => m.syncUpdateDb == true,
      fromServerMap: (map) => ChatMessage(
        map['_id'] as String,
        map['message'] as String,
        map['senderId'] as String,
        map['timestamp'] as int,
      ),
    ),
  ],
);

realmSync.start();
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Watch mode (for development)
npm run test:watch

# Integration tests only
npm run test:integration

# Load testing
npm run test:load

# Coverage report
npm run test:coverage
```

### Test Structure

```
tests/
├── database.test.ts       # MongoDB operations
├── integration.test.ts    # End-to-end sync scenarios
├── crud-operations.test.ts # Create, read, update, delete
├── optimistic-updates.test.ts # Optimistic UI patterns
├── benchmarks/            # Performance tests
├── e2e/                   # Full system tests
└── load/                  # Stress testing
```

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `MONGODB_URI` | MongoDB connection string | ✅ Yes | - |
| `WEB_PUBSUB_CONNECTION_STRING` | Azure Web PubSub connection | ⚠️ Production | - |
| `WEB_PUBSUB_HUB_NAME` | Web PubSub hub name | ⚠️ Production | `Hub` |
| `PORT` | Server HTTP port | ❌ No | `3000` |
| `NODE_ENV` | Environment mode | ❌ No | `development` |
| `AUTH_JWT_SECRET` | JWT signing secret | ⚠️ Production | - |
| `MAX_CONNECTIONS_PER_USER` | Connection limit per user | ❌ No | `10` (prod), `100` (dev) |
| `MAX_CONNECTIONS_PER_IP` | Connection limit per IP | ❌ No | `50` (prod), `500` (dev) |
| `SYNC_RATE_LIMIT_MAX` | Max changes per window | ❌ No | `50` |
| `SYNC_RATE_LIMIT_WINDOW_MS` | Rate limit window (ms) | ❌ No | `10000` |
| `RATE_LIMIT_DISABLED` | Disable rate limiting | ❌ No | `false` |
| `LOG_LEVEL` | Logging verbosity | ❌ No | `info` |
| `ALLOWED_ORIGINS` | CORS allowed origins (comma-separated) | ⚠️ Production | `*` (dev) |

### Advanced Configuration

Create `config/production.json` for environment-specific settings:

```json
{
  "server": {
    "port": 3000,
    "corsOrigins": ["https://app.example.com"]
  },
  "sync": {
    "maxBatchSize": 100,
    "changeRetentionDays": 30,
    "enableOptimisticLocking": true
  },
  "mongodb": {
    "poolSize": 10,
    "socketTimeoutMS": 45000
  }
}
```

## 🚀 Deployment

### Build for Production

```bash
npm run build
npm start
```

### Docker Deployment

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
```

```bash
docker build -t realm-sync-server .
docker run -p 3000:3000 \
  -e MONGODB_URI="mongodb://..." \
  -e AUTH_JWT_SECRET="your-secret" \
  realm-sync-server
```

### Azure App Service

<details>
<summary><b>Deploy to Azure App Service</b></summary>

```bash
# Login to Azure
az login

# Create resource group
az group create --name realm-sync-rg --location eastus

# Create App Service plan
az appservice plan create \
  --name realm-sync-plan \
  --resource-group realm-sync-rg \
  --sku B1 \
  --is-linux

# Create web app
az webapp create \
  --name realm-sync-server \
  --resource-group realm-sync-rg \
  --plan realm-sync-plan \
  --runtime "NODE:18-lts"

# Configure environment variables
az webapp config appsettings set \
  --name realm-sync-server \
  --resource-group realm-sync-rg \
  --settings \
    MONGODB_URI="..." \
    AUTH_JWT_SECRET="..." \
    NODE_ENV="production"

# Deploy code
az webapp deployment source config-zip \
  --name realm-sync-server \
  --resource-group realm-sync-rg \
  --src dist.zip
```
</details>

### Kubernetes

<details>
<summary><b>Kubernetes manifests</b></summary>

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: realm-sync-server
spec:
  replicas: 3
  selector:
    matchLabels:
      app: realm-sync
  template:
    metadata:
      labels:
        app: realm-sync
    spec:
      containers:
      - name: server
        image: realm-sync-server:latest
        ports:
        - containerPort: 3000
        env:
        - name: MONGODB_URI
          valueFrom:
            secretKeyRef:
              name: sync-secrets
              key: mongodb-uri
        - name: AUTH_JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: sync-secrets
              key: jwt-secret
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: realm-sync-service
spec:
  selector:
    app: realm-sync
  ports:
  - protocol: TCP
    port: 80
    targetPort: 3000
  type: LoadBalancer
```
</details>

### Azure Web PubSub (scaling)

```bash
# Create Web PubSub resource
az webpubsub create \
  --name realm-sync-pubsub \
  --resource-group realm-sync-rg \
  --location eastus \
  --sku Standard_S1

# Get connection string
az webpubsub key show \
  --name realm-sync-pubsub \
  --resource-group realm-sync-rg \
  --query primaryConnectionString
```

## 🐛 Troubleshooting

### Common Issues

<details>
<summary><b>Connection refused / Cannot connect to server</b></summary>

1. Check server is running: `npm run dev:server`
2. Verify port is not blocked: `lsof -i :3000`
3. Check firewall settings
4. Ensure MongoDB is accessible: `mongosh $MONGODB_URI`
</details>

<details>
<summary><b>Changes not syncing between clients</b></summary>

1. Verify both clients are connected: Check `client.isOnline()`
2. Check server logs for errors
3. Verify `sync_updated_at` timestamps are being set
4. Confirm subscription filters match the data
5. Check network tab in browser DevTools for WebSocket errors
</details>

<details>
<summary><b>High latency or slow sync</b></summary>

1. Enable MongoDB indexes on `sync_updated_at` and `_id`
2. Reduce batch size if memory is constrained
3. Check network latency: `ping your-server.com`
4. Monitor server metrics at `/stats`
5. Consider enabling Azure Web PubSub for horizontal scaling
</details>

<details>
<summary><b>Authentication failures</b></summary>

1. Verify `AUTH_JWT_SECRET` is set in production
2. Check JWT token expiration
3. Ensure token is passed in `sync:join` event
4. Validate token format (should be `Bearer <token>`)
</details>

### Debug Mode

Enable verbose logging:

```bash
LOG_LEVEL=debug npm run dev:server
```

### Health Check Commands

```bash
# Server health
curl http://localhost:3000/health

# MongoDB connection
mongosh $MONGODB_URI --eval "db.adminCommand('ping')"

# Active connections
curl http://localhost:3000/stats | jq '.activeConnections'
```

## 📊 Performance & Scaling

### Optimization Tips

1. **Database Indexes**: Create compound indexes on `sync_updated_at` and collection-specific fields
   ```javascript
   db.tasks.createIndex({ sync_updated_at: 1, userId: 1 });
   ```

2. **Batch Operations**: Use `sync:changeBatch` for bulk updates (10x faster than individual changes)

3. **Connection Pooling**: Configure MongoDB pool size based on concurrent users
   ```
   MONGODB_URI=mongodb://...?maxPoolSize=50
   ```

4. **Rate Limiting**: Adjust limits based on your use case
   ```bash
   SYNC_RATE_LIMIT_MAX=100          # Higher for power users
   SYNC_RATE_LIMIT_WINDOW_MS=5000   # Shorter window for stricter limits
   ```

5. **Change Retention**: Clean up old change logs automatically
   ```javascript
   // Runs daily by default, keeps last 30 days
   ```

### Benchmarks

Tested on Azure Standard_B2s (2 vCPU, 4 GB RAM):

| Metric | Value |
|--------|-------|
| Concurrent connections | 1,000+ |
| Changes per second | 5,000+ |
| Average latency | <50ms |
| Memory per connection | ~1MB |
| MongoDB write throughput | 10,000 ops/s |

### Scaling Strategy

- **Vertical**: Increase server resources (CPU/RAM)
- **Horizontal**: Deploy multiple instances behind load balancer + Azure Web PubSub
- **Database**: Use MongoDB Atlas auto-scaling or sharding

## 🔒 Security

### Production Checklist

- ✅ Enable JWT authentication (`AUTH_JWT_SECRET`)
- ✅ Use HTTPS/WSS in production
- ✅ Implement CORS whitelist (`ALLOWED_ORIGINS`)
- ✅ Enable rate limiting (default: enabled in production)
- ✅ Validate all user inputs server-side
- ✅ Use environment variables for secrets (never commit)
- ✅ Rotate JWT secrets regularly
- ✅ Monitor failed authentication attempts
- ✅ Set up MongoDB authentication and network rules
- ✅ Use Azure Private Endpoints for Web PubSub

### Example Secure Configuration

```bash
# Production .env
NODE_ENV=production
AUTH_JWT_SECRET=<256-bit-random-secret>
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/?authSource=admin&ssl=true
ALLOWED_ORIGINS=https://app.example.com,https://mobile.example.com
MAX_CONNECTIONS_PER_USER=5
SYNC_RATE_LIMIT_MAX=30
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md).

```bash
# Fork the repository
git clone https://github.com/mohit67890/realm-sync-server.git
cd realm-sync-server

# Create feature branch
git checkout -b feature/amazing-feature

# Make changes and test
npm test
npm run test:integration

# Commit with conventional commits
git commit -m "feat: add amazing feature"

# Push and create PR
git push origin feature/amazing-feature
```

## 📄 License

MIT — see [LICENSE](LICENSE)

## 🙏 Acknowledgments

- Inspired by [MongoDB Realm Sync](https://www.mongodb.com/docs/atlas/app-services/sync/)
- Built with [Socket.IO](https://socket.io/) for WebSocket communications
- Powered by [Azure Web PubSub](https://azure.microsoft.com/en-us/products/web-pubsub) for scalability
- TypeScript SDK patterns from [Realm JavaScript](https://github.com/realm/realm-js)

## 📞 Support & Community

- **Issues**: [GitHub Issues](https://github.com/mohit67890/realm-sync-server/issues)
- **Discussions**: [GitHub Discussions](https://github.com/mohit67890/realm-sync-server/discussions)
- **Documentation**: See [IMPLEMENTATION_GUIDE.md](IMPLEMENTATION_GUIDE.md) for detailed setup
- **Examples**: Check [client/example.ts](client/example.ts) for usage examples

---

**Built with ❤️ for real-time applications**

[![Star on GitHub](https://img.shields.io/github/stars/mohit67890/realm-sync-server?style=social)](https://github.com/mohit67890/realm-sync-server)
