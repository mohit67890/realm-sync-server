#!/usr/bin/env ts-node
/**
 * Verify MongoDB Atlas data after running integration tests
 * Usage: npx ts-node scripts/verify-test-data.ts [userId]
 */

import * as dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

async function verifyTestData(userId?: string) {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("❌ MONGODB_URI not set in .env file");
    process.exit(1);
  }

  const client = new MongoClient(mongoUri);

  try {
    console.log("🔗 Connecting to MongoDB Atlas...");
    await client.connect();
    console.log("✅ Connected to MongoDB");

    const db = client.db();
    const goalsCollection = db.collection("goals");
    const changesCollection = db.collection("_sync_changes");

    // If userId provided, filter by it, otherwise show recent test data
    const userFilter = userId ? { userId } : {};

    console.log("\n📊 Querying goals collection...");
    const goals = await goalsCollection
      .find(userFilter)
      .sort({ sync_updated_at: -1 })
      .limit(20)
      .toArray();

    console.log(
      `\n📋 Found ${goals.length} goals${userId ? ` for user: ${userId}` : ""}`
    );
    console.log("=".repeat(80));

    if (goals.length === 0) {
      console.log("⚠️  No goals found in MongoDB");
      console.log("\nPossible reasons:");
      console.log("1. Integration tests haven't run yet");
      console.log("2. Server isn't connected to MongoDB Atlas");
      console.log("3. Data was cleaned up after tests");
      console.log("4. Wrong userId filter");
    } else {
      goals.forEach((goal, index) => {
        console.log(`\n${index + 1}. Goal ID: ${goal._id}`);
        console.log(`   Title: ${goal.title}`);
        console.log(`   User ID: ${goal.userId}`);
        console.log(`   Status: ${goal.status}`);
        console.log(`   Progress: ${goal.progress}%`);
        console.log(`   Description: ${goal.description || "N/A"}`);
        console.log(`   Created: ${goal.createdAt}`);
        console.log(`   Updated: ${goal.updatedAt}`);
        console.log(
          `   Sync Updated: ${goal.sync_updated_at ? new Date(goal.sync_updated_at).toISOString() : "N/A"}`
        );
        console.log(`   Updated By: ${goal._updated_by || "N/A"}`);
      });
    }

    // Check sync changes log
    console.log("\n" + "=".repeat(80));
    console.log("📊 Querying _sync_changes collection...");
    const changes = await changesCollection
      .find(userFilter)
      .sort({ timestamp: -1 })
      .limit(20)
      .toArray();

    console.log(
      `\n📋 Found ${changes.length} sync changes${userId ? ` for user: ${userId}` : ""}`
    );
    console.log("=".repeat(80));

    if (changes.length > 0) {
      const operations = {
        insert: changes.filter((c) => c.operation === "insert").length,
        update: changes.filter((c) => c.operation === "update").length,
        delete: changes.filter((c) => c.operation === "delete").length,
      };

      console.log("\n📈 Operations Summary:");
      console.log(`   Inserts: ${operations.insert}`);
      console.log(`   Updates: ${operations.update}`);
      console.log(`   Deletes: ${operations.delete}`);
      console.log(`   Total: ${changes.length}`);
      console.log(`   Synced: ${changes.filter((c) => c.synced).length}`);
      console.log(`   Pending: ${changes.filter((c) => !c.synced).length}`);

      console.log("\n🔍 Recent Changes:");
      changes.slice(0, 10).forEach((change, index) => {
        console.log(`\n${index + 1}. Change ID: ${change.id}`);
        console.log(`   Operation: ${change.operation}`);
        console.log(`   Collection: ${change.collection}`);
        console.log(`   Document ID: ${change.documentId}`);
        console.log(`   User ID: ${change.userId}`);
        console.log(
          `   Timestamp: ${new Date(change.timestamp).toISOString()}`
        );
        console.log(`   Synced: ${change.synced ? "✅" : "⏳"}`);
        if (change.data && change.operation !== "delete") {
          console.log(`   Title: ${change.data.title || "N/A"}`);
          console.log(`   Status: ${change.data.status || "N/A"}`);
        }
      });
    }

    // Database statistics
    console.log("\n" + "=".repeat(80));
    console.log("📊 Database Statistics:");
    const totalGoals = await goalsCollection.countDocuments();
    const totalChanges = await changesCollection.countDocuments();
    console.log(`   Total Goals: ${totalGoals}`);
    console.log(`   Total Sync Changes: ${totalChanges}`);

    // Check if server is configured correctly
    console.log("\n" + "=".repeat(80));
    console.log("✅ Verification Complete!");
    console.log("\n💡 Tips:");
    console.log(
      "   - Run integration tests: cd example && flutter test integration_test/"
    );
    console.log(
      "   - Check specific user: npx ts-node scripts/verify-test-data.ts <userId>"
    );
    console.log("   - Monitor logs: tail -f server.log");
    console.log(
      "   - MongoDB URI: " +
        mongoUri.replace(/\/\/([^:]+):([^@]+)@/, "//$1:****@")
    );
  } catch (error) {
    console.error("\n❌ Error verifying test data:", error);
    process.exit(1);
  } finally {
    await client.close();
    console.log("\n🔌 Disconnected from MongoDB");
  }
}

// Parse command line arguments
const userId = process.argv[2];

if (userId) {
  console.log(`🔍 Filtering by userId: ${userId}`);
}

verifyTestData(userId);
