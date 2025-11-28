/**
 * MongoDB Verification Script for Integration Tests
 *
 * This script connects to MongoDB Atlas and verifies the data
 * synced from Flutter integration tests.
 *
 * Usage:
 *   npx ts-node scripts/verify-integration-test-data.ts <userId>
 */

import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || "";

interface GoalDocument {
  _id: string;
  userId: string;
  title: string;
  description?: string;
  status: string;
  progress: number;
  createdAt?: Date;
  updatedAt?: Date;
  sync_updated_at?: number;
  _updated_by?: string;
}

async function verifyIntegrationTestData(userId: string) {
  if (!MONGODB_URI) {
    console.error("❌ MONGODB_URI not set in .env file");
    process.exit(1);
  }

  console.log("🔗 Connecting to MongoDB Atlas...");
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log("✅ Connected to MongoDB\n");

    const db = client.db();
    const goalsCollection = db.collection<GoalDocument>("goals");
    const changesCollection = db.collection("_sync_changes");

    // Query goals for the test user
    console.log(`📊 Querying goals for userId: ${userId}\n`);

    const goals = await goalsCollection
      .find({ userId })
      .sort({ sync_updated_at: -1 })
      .toArray();

    console.log(`📦 Found ${goals.length} goals in MongoDB:\n`);

    if (goals.length === 0) {
      console.log("ℹ️  No goals found (expected if cleanup ran successfully)");
    } else {
      goals.forEach((goal, index) => {
        console.log(`${index + 1}. ${goal.title}`);
        console.log(`   ID: ${goal._id}`);
        console.log(`   Status: ${goal.status}`);
        console.log(`   Progress: ${goal.progress}%`);
        console.log(`   Description: ${goal.description || "N/A"}`);
        if (goal.sync_updated_at) {
          const date = new Date(goal.sync_updated_at);
          console.log(`   Last Updated: ${date.toISOString()}`);
        }
        if (goal._updated_by) {
          console.log(`   Updated By: ${goal._updated_by}`);
        }
        console.log("");
      });
    }

    // Check sync changes log
    console.log("📝 Checking sync changes log...\n");

    const changes = await changesCollection
      .find({ userId })
      .sort({ timestamp: -1 })
      .limit(20)
      .toArray();

    console.log(`📦 Found ${changes.length} sync changes:\n`);

    // Group by operation
    const operations = {
      insert: 0,
      update: 0,
      delete: 0,
    };

    changes.forEach((change) => {
      if (change.operation === "insert") operations.insert++;
      else if (change.operation === "update") operations.update++;
      else if (change.operation === "delete") operations.delete++;
    });

    console.log(`   📥 Inserts: ${operations.insert}`);
    console.log(`   ✏️  Updates: ${operations.update}`);
    console.log(`   🗑️  Deletes: ${operations.delete}`);
    console.log("");

    // Show recent changes
    console.log("📋 Recent changes (last 10):\n");
    changes.slice(0, 10).forEach((change, index) => {
      const date = new Date(change.timestamp);
      console.log(
        `${index + 1}. ${change.operation.toUpperCase()}: ${change.documentId}`
      );
      console.log(`   Collection: ${change.collection}`);
      console.log(`   Timestamp: ${date.toISOString()}`);
      console.log(`   Synced: ${change.synced ? "✅" : "⏳"}`);
      console.log("");
    });

    // Verification summary
    console.log("═══════════════════════════════════════════════");
    console.log("📊 VERIFICATION SUMMARY");
    console.log("═══════════════════════════════════════════════\n");

    console.log(`✅ MongoDB Connection: OK`);
    console.log(`✅ Goals Collection: ${goals.length} documents`);
    console.log(`✅ Changes Log: ${changes.length} entries`);
    console.log(
      `✅ Operations Tracked: ${operations.insert + operations.update + operations.delete} total`
    );

    if (goals.length === 0 && changes.length > 0) {
      console.log(
        `\n✅ EXPECTED STATE: No goals remaining (cleanup successful)`
      );
      console.log(`   But ${changes.length} changes logged (correct)`);
    } else if (goals.length > 0) {
      console.log(
        `\n⚠️  UNEXPECTED STATE: ${goals.length} goals still in database`
      );
      console.log(`   Expected 0 after cleanup`);
    }

    console.log("\n═══════════════════════════════════════════════\n");

    // Check for specific test patterns
    const batchGoals = goals.filter((g) => g.title?.startsWith("Batch Goal"));
    const progressGoals = goals.filter((g) =>
      g.title?.includes("Progress Tracking")
    );
    const conflictGoals = goals.filter((g) =>
      g.title?.includes("Conflict Test")
    );

    if (batchGoals.length > 0) {
      console.log(
        `🔍 Found ${batchGoals.length} batch goals (should be 0 after cleanup)`
      );
    }
    if (progressGoals.length > 0) {
      console.log(
        `🔍 Found ${progressGoals.length} progress tracking goals (should be 0 after cleanup)`
      );
    }
    if (conflictGoals.length > 0) {
      console.log(
        `🔍 Found ${conflictGoals.length} conflict test goals (should be 0 after cleanup)`
      );
    }

    // Success indicators
    const allSynced = changes.every((c) => c.synced);
    console.log(
      `\n${allSynced ? "✅" : "⚠️"} All changes synced: ${allSynced ? "YES" : "NO"}`
    );
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  } finally {
    await client.close();
    console.log("\n🔌 Disconnected from MongoDB");
  }
}

// Main execution
const userId = process.argv[2];

if (!userId) {
  console.error(
    "❌ Usage: npx ts-node scripts/verify-integration-test-data.ts <userId>"
  );
  console.error("\nExample:");
  console.error(
    "  npx ts-node scripts/verify-integration-test-data.ts test-user-1764295276566"
  );
  process.exit(1);
}

console.log("🚀 Starting MongoDB verification...\n");
verifyIntegrationTestData(userId).catch(console.error);
