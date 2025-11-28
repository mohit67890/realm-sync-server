import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config();

async function cleanup() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("❌ MONGODB_URI not set in .env file");
    process.exit(1);
  }

  const client = new MongoClient(mongoUri);
  try {
    console.log("🔗 Connecting to MongoDB Atlas...");
    await client.connect();
    console.log("✅ Connected to MongoDB\n");

    const db = client.db("realmSyncDB");

    const goalsResult = await db.collection("goals").deleteMany({});
    console.log(`🗑️  Deleted ${goalsResult.deletedCount} goals`);

    const changesResult = await db.collection("_sync_changes").deleteMany({});
    console.log(`🗑️  Deleted ${changesResult.deletedCount} sync changes`);

    console.log("\n✅ MongoDB cleanup complete");
  } finally {
    await client.close();
    console.log("🔌 Disconnected from MongoDB");
  }
}

cleanup();
