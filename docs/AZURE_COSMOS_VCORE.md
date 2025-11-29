# Azure Cosmos DB MongoDB vCore Deployment Guide

This guide covers deploying the Realm Sync Server with Azure Cosmos DB MongoDB vCore.

## Why vCore?

Azure Cosmos DB for MongoDB vCore is **purpose-built for MongoDB workloads** with native wire protocol compatibility:

| Feature               | Cosmos DB vCore  | Cosmos DB API       | MongoDB Atlas   |
| --------------------- | ---------------- | ------------------- | --------------- |
| MongoDB Wire Protocol | ✅ 5.0+          | ⚠️ 4.2 (limited)    | ✅ 7.0+         |
| Change Streams        | ✅ Full support  | ❌ Not supported    | ✅ Full support |
| TTL Indexes           | ✅ Native        | ⚠️ Limited          | ✅ Native       |
| Transactions          | ✅ Multi-doc     | ⚠️ Partition-scoped | ✅ Multi-doc    |
| Pricing Model         | vCores + Storage | RU/s (complex)      | Tiers (simple)  |
| Azure Integration     | ✅ Native VNet   | ✅ Native           | ⚠️ Via peering  |

**✅ vCore is ideal for this sync server** because it requires:

- Change streams for real-time updates (not available in traditional Cosmos DB API)
- TTL indexes for automatic subscription cleanup
- Predictable pricing without RU/s surprises

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Azure Region (e.g., East US)              │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Azure Virtual Network (VNet)                       │    │
│  │                                                      │    │
│  │  ┌────────────────┐      ┌─────────────────────┐  │    │
│  │  │ App Service    │◄────►│ Cosmos DB vCore     │  │    │
│  │  │ (Sync Server)  │      │ (MongoDB 5.0)       │  │    │
│  │  │                │      │                     │  │    │
│  │  │ - Node.js 18   │      │ M25: 2 vCores       │  │    │
│  │  │ - Socket.IO    │      │ 32 GB storage       │  │    │
│  │  │ - WebSockets   │      │ 250 IOPS/vCore      │  │    │
│  │  └────────┬───────┘      └──────────┬──────────┘  │    │
│  │           │                          │              │    │
│  │           │   Private Endpoint       │              │    │
│  │           └──────────────────────────┘              │    │
│  │                                                      │    │
│  └──────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Azure Web PubSub (Optional - for horizontal scale) │    │
│  │  Standard Tier: 1,000 concurrent connections        │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

## Setup Steps

### 1. Create Cosmos DB vCore Cluster

```bash
# Variables
RESOURCE_GROUP="realm-sync-rg"
LOCATION="eastus"
CLUSTER_NAME="realm-sync-mongo"
ADMIN_USER="syncadmin"
ADMIN_PASSWORD="<strong-password>"  # Generate: openssl rand -base64 32

# Create resource group
az group create \
  --name $RESOURCE_GROUP \
  --location $LOCATION

# Create Cosmos DB MongoDB vCore cluster (M25 tier - 2 vCores)
az cosmosdb mongocluster create \
  --resource-group $RESOURCE_GROUP \
  --cluster-name $CLUSTER_NAME \
  --location $LOCATION \
  --administrator-login $ADMIN_USER \
  --administrator-login-password $ADMIN_PASSWORD \
  --shard-node-tier "M25" \
  --shard-node-disk-size-gb 32 \
  --shard-node-count 1

# Note: Creation takes ~10-15 minutes
```

**Pricing (as of 2024):**

- M25 (2 vCores): ~$108/month (handles 1-5K users)
- M30 (4 vCores): ~$216/month (handles 10K+ users)
- M50 (8 vCores): ~$434/month (handles 50K+ users)

### 2. Configure Firewall Rules

```bash
# Allow Azure services (for App Service deployment)
az cosmosdb mongocluster firewall rule create \
  --resource-group $RESOURCE_GROUP \
  --cluster-name $CLUSTER_NAME \
  --rule-name "AllowAzureServices" \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0

# Allow your development machine (get your IP from https://ifconfig.me)
MY_IP=$(curl -s https://ifconfig.me)
az cosmosdb mongocluster firewall rule create \
  --resource-group $RESOURCE_GROUP \
  --cluster-name $CLUSTER_NAME \
  --rule-name "DevMachine" \
  --start-ip-address $MY_IP \
  --end-ip-address $MY_IP
```

**Production:** Use Private Endpoints instead of firewall rules for enhanced security.

### 3. Get Connection String

```bash
# Get connection string
az cosmosdb mongocluster show \
  --resource-group $RESOURCE_GROUP \
  --cluster-name $CLUSTER_NAME \
  --query connectionString \
  --output tsv
```

**Connection string format:**

```
mongodb://syncadmin:<password>@realm-sync-mongo.mongocluster.cosmos.azure.com:10255/?tls=true&authMechanism=SCRAM-SHA-256&retrywrites=false&maxIdleTimeMS=120000
```

### 4. Configure Environment Variables

Update your `.env` file:

```bash
# Azure Cosmos DB MongoDB vCore
MONGODB_URI=mongodb://syncadmin:<password>@realm-sync-mongo.mongocluster.cosmos.azure.com:10255/realm-sync?tls=true&authMechanism=SCRAM-SHA-256&retrywrites=false&maxIdleTimeMS=120000

# vCore optimizations (automatically detected by database.ts)
DB_MAX_POOL_SIZE=100
DB_MIN_POOL_SIZE=10

# Server configuration
PORT=3000
NODE_ENV=production
AUTH_JWT_SECRET=<your-256-bit-secret>

# Optional: Azure Web PubSub for horizontal scaling
WEB_PUBSUB_CONNECTION_STRING=Endpoint=https://your-pubsub.webpubsub.azure.com;AccessKey=YOUR_KEY;Version=1.0;
WEB_PUBSUB_HUB_NAME=sync-hub
```

### 5. Test Connection Locally

```bash
# Install dependencies
npm install

# Test connection (will auto-detect vCore and configure optimally)
npm run dev:server
```

You should see:

```
🔷 Detected Azure Cosmos DB MongoDB vCore connection
✅ Database connected and indexes created
🚀 Sync server started on port 3000
```

## Performance Tuning

### Connection Pooling

vCore handles **up to 500 concurrent connections per vCore**. Our default pool settings:

```typescript
// Automatically configured in database.ts when vCore detected
{
  maxPoolSize: 100,        // Maximum connections in pool
  minPoolSize: 10,         // Minimum kept alive
  maxIdleTimeMS: 120000,   // 2-minute idle timeout
  retryWrites: false,      // vCore doesn't support retryable writes yet
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000
}
```

**For M25 (2 vCores):** Default pool size (100) is optimal.  
**For M50+ (8+ vCores):** Increase to `DB_MAX_POOL_SIZE=200`.

### Indexes

The sync server automatically creates these indexes on startup:

```typescript
// _sync_changes collection (audit log)
{ timestamp: 1 }                    // Time-based queries
{ userId: 1, timestamp: 1 }         // User-scoped changes
{ collection: 1, documentId: 1 }    // Document lookups
{ synced: 1, timestamp: 1 }         // Cleanup queries
{ id: 1 }                           // Unique constraint (idempotency)

// _sync_subscriptions collection (FLX filtering)
{ userId: 1, version: 1 }           // User subscription versions
{ userId: 1, "subscriptions.id": 1 } // Subscription lookup
{ updatedAt: 1 }                    // TTL index (90-day auto-delete)
```

**vCore advantage:** TTL indexes work natively (unlike traditional Cosmos DB API).

### Monitoring Queries

```bash
# Connect via mongosh
mongosh "mongodb://syncadmin:<password>@realm-sync-mongo.mongocluster.cosmos.azure.com:10255/?tls=true&authMechanism=SCRAM-SHA-256"

# Check slow queries
use realm-sync
db.setProfilingLevel(1, { slowms: 100 })
db.system.profile.find().sort({ ts: -1 }).limit(10)

# Check collection stats
db._sync_changes.stats()
db._sync_subscriptions.stats()

# Check index usage
db._sync_changes.aggregate([
  { $indexStats: {} }
])
```

## Scaling Guide

### Vertical Scaling (Upgrade vCore Tier)

```bash
# Upgrade from M25 → M30 (2 vCores → 4 vCores)
az cosmosdb mongocluster update \
  --resource-group $RESOURCE_GROUP \
  --cluster-name $CLUSTER_NAME \
  --shard-node-tier "M30"

# Upgrade from M30 → M50 (4 vCores → 8 vCores)
az cosmosdb mongocluster update \
  --resource-group $RESOURCE_GROUP \
  --cluster-name $CLUSTER_NAME \
  --shard-node-tier "M50"
```

**Downtime:** None (rolling upgrade takes ~5-10 minutes).

### Horizontal Scaling (Multiple Sync Server Instances)

For **10K+ concurrent users**, deploy multiple sync server instances with Azure Web PubSub:

```bash
# Create Azure Web PubSub (Standard tier supports 1K concurrent connections per unit)
az webpubsub create \
  --resource-group $RESOURCE_GROUP \
  --name realm-sync-pubsub \
  --location $LOCATION \
  --sku Standard_S1 \
  --unit-count 10  # 10 units = 10K concurrent connections

# Get connection string
az webpubsub key show \
  --resource-group $RESOURCE_GROUP \
  --name realm-sync-pubsub \
  --query primaryConnectionString \
  --output tsv
```

**Architecture:**

```
Load Balancer → Sync Server 1 ──┐
               → Sync Server 2 ──┼── Azure Web PubSub ← Cosmos DB vCore
               → Sync Server 3 ──┘
```

**Cost:** Web PubSub Standard = $50/month per unit (1K connections per unit).

### Capacity Planning

| Users | Sync Server Instances | vCore Tier      | Web PubSub Units | Monthly Cost  |
| ----- | --------------------- | --------------- | ---------------- | ------------- |
| 1-5K  | 1                     | M25 (2 vCores)  | 0 (optional)     | $108          |
| 10K   | 2-3                   | M30 (4 vCores)  | 10               | $216 + $500   |
| 50K   | 5-10                  | M50 (8 vCores)  | 50               | $434 + $2,500 |
| 100K+ | 10-20                 | M80 (16 vCores) | 100              | $868 + $5,000 |

## High Availability

### Zone Redundancy

Enable for 99.995% SLA:

```bash
az cosmosdb mongocluster update \
  --resource-group $RESOURCE_GROUP \
  --cluster-name $CLUSTER_NAME \
  --high-availability-mode "ZoneRedundant"
```

**Cost:** +50% (e.g., M25 becomes ~$162/month).

### Multi-Region Reads

Add read replicas for global latency optimization:

```bash
az cosmosdb mongocluster update \
  --resource-group $RESOURCE_GROUP \
  --cluster-name $CLUSTER_NAME \
  --location "westus2"  # Add West US 2 as read region
```

**Note:** vCore does **not support multi-region writes** (use Atlas for that).

## Security Best Practices

### 1. Use Private Endpoints (Production)

```bash
# Create VNet
az network vnet create \
  --resource-group $RESOURCE_GROUP \
  --name realm-sync-vnet \
  --address-prefix 10.0.0.0/16 \
  --subnet-name app-subnet \
  --subnet-prefix 10.0.1.0/24

# Create private endpoint for Cosmos DB
az network private-endpoint create \
  --resource-group $RESOURCE_GROUP \
  --name cosmos-private-endpoint \
  --vnet-name realm-sync-vnet \
  --subnet app-subnet \
  --private-connection-resource-id $(az cosmosdb mongocluster show -g $RESOURCE_GROUP -n $CLUSTER_NAME --query id -o tsv) \
  --group-id MongoCluster \
  --connection-name cosmos-connection

# Disable public network access
az cosmosdb mongocluster update \
  --resource-group $RESOURCE_GROUP \
  --cluster-name $CLUSTER_NAME \
  --public-network-access Disabled
```

### 2. Enable Azure AD Authentication

```bash
# Assign Cosmos DB account contributor role to managed identity
MANAGED_IDENTITY_ID=$(az webapp identity show --resource-group $RESOURCE_GROUP --name realm-sync-app --query principalId --output tsv)

az role assignment create \
  --assignee $MANAGED_IDENTITY_ID \
  --role "DocumentDB Account Contributor" \
  --scope $(az cosmosdb mongocluster show -g $RESOURCE_GROUP -n $CLUSTER_NAME --query id -o tsv)
```

### 3. Enable Diagnostic Logs

```bash
# Create Log Analytics workspace
az monitor log-analytics workspace create \
  --resource-group $RESOURCE_GROUP \
  --workspace-name realm-sync-logs

# Enable diagnostic settings
az monitor diagnostic-settings create \
  --resource $(az cosmosdb mongocluster show -g $RESOURCE_GROUP -n $CLUSTER_NAME --query id -o tsv) \
  --name cosmos-diagnostics \
  --workspace realm-sync-logs \
  --logs '[{"category": "MongoRequests", "enabled": true}]' \
  --metrics '[{"category": "AllMetrics", "enabled": true}]'
```

## Cost Optimization

### 1. Right-Size Your Cluster

Start small and scale up:

```bash
# Start with M25 (2 vCores) for development/staging
# Monitor CPU/memory usage in Azure Portal
# Upgrade when CPU consistently > 70% or memory > 80%
```

### 2. Enable Auto-Pause (Development)

```bash
# Note: Auto-pause not available for vCore yet, but you can:
# - Delete test clusters when not in use
# - Use lower tiers (M25) for non-production
```

### 3. Use Burstable Compute (Preview)

```bash
# Enable burstable tier for variable workloads
az cosmosdb mongocluster create \
  --resource-group $RESOURCE_GROUP \
  --cluster-name realm-sync-mongo-dev \
  --shard-node-tier "M25Burstable"  # ~40% cheaper
```

**Burstable tiers:** Ideal for dev/test or workloads with predictable low traffic.

## Troubleshooting

### Connection Timeout

**Symptom:** `MongoServerError: connection timed out`

**Solution:**

1. Check firewall rules: `az cosmosdb mongocluster firewall rule list`
2. Verify connection string has `tls=true` and `maxIdleTimeMS=120000`
3. Increase timeout in connection options:
   ```typescript
   serverSelectionTimeoutMS: 10000,
   connectTimeoutMS: 10000
   ```

### Retryable Writes Error

**Symptom:** `MongoServerError: This MongoDB deployment does not support retryable writes`

**Solution:** Already configured in `database.ts` with `retryWrites: false`.

### TTL Index Not Working

**Symptom:** Old subscriptions not automatically deleted after 90 days.

**Solution:** vCore TTL indexes work natively (unlike traditional Cosmos DB API). Verify:

```bash
mongosh <connection-string>
use realm-sync
db._sync_subscriptions.getIndexes()
# Should see: { updatedAt: 1 }, expireAfterSeconds: 7776000
```

### High Latency (>100ms)

**Possible causes:**

1. **Undersized cluster:** Upgrade vCore tier (M25 → M30 → M50).
2. **Missing indexes:** Check slow query log (see Monitoring section).
3. **Network latency:** Use Azure regions closer to users or add read replicas.
4. **Connection pool exhausted:** Increase `DB_MAX_POOL_SIZE`.

**Debug with:**

```bash
# Enable slow query logging
mongosh <connection-string>
use realm-sync
db.setProfilingLevel(1, { slowms: 50 })  # Log queries > 50ms
db.system.profile.find().sort({ ts: -1 }).limit(10)
```

## Migration from MongoDB Atlas

### Export Data

```bash
# Export from Atlas
mongodump --uri "mongodb+srv://user:pass@atlas-cluster.mongodb.net/realm-sync"

# Import to vCore
mongorestore --uri "mongodb://syncadmin:pass@realm-sync-mongo.mongocluster.cosmos.azure.com:10255/?tls=true&authMechanism=SCRAM-SHA-256" --db realm-sync dump/realm-sync
```

### Update Connection String

```bash
# Old (Atlas)
MONGODB_URI=mongodb+srv://user:pass@atlas-cluster.mongodb.net/realm-sync

# New (vCore)
MONGODB_URI=mongodb://syncadmin:pass@realm-sync-mongo.mongocluster.cosmos.azure.com:10255/realm-sync?tls=true&authMechanism=SCRAM-SHA-256&retrywrites=false&maxIdleTimeMS=120000
```

### Compatibility Notes

✅ **What works the same:**

- Change streams
- TTL indexes
- Multi-document transactions
- Aggregation pipelines
- Full-text search

⚠️ **What's different:**

- vCore uses port `10255` (Atlas uses `27017`)
- Auth mechanism: `SCRAM-SHA-256` (Atlas supports `SCRAM-SHA-1` too)
- `retryWrites: false` required (Atlas supports `retryWrites: true`)
- No sharding yet (vCore single shard per cluster)

## Next Steps

1. **Deploy to Production:** Follow [DEPLOYMENT.md](DEPLOYMENT.md) for App Service deployment
2. **Monitor Performance:** Set up Azure Monitor alerts for CPU/memory/IOPS
3. **Load Testing:** Use [tests/load/README.md](../tests/load/README.md) to validate capacity
4. **Optimize Queries:** Review slow query logs and add indexes as needed

## Resources

- [Azure Cosmos DB MongoDB vCore Docs](https://learn.microsoft.com/azure/cosmos-db/mongodb/vcore/)
- [Pricing Calculator](https://azure.microsoft.com/pricing/calculator/)
- [Performance Best Practices](https://learn.microsoft.com/azure/cosmos-db/mongodb/vcore/performance-best-practices)
- [Migration Guide](https://learn.microsoft.com/azure/cosmos-db/mongodb/vcore/migration-options)

---

**Questions?** Open an issue on [GitHub](https://github.com/mohit67890/realm-sync-server/issues).
