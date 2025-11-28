/**
 * Script to verify data in MongoDB Atlas after sync test
 */

import * as dotenv from "dotenv";
dotenv.config();

import { MongoClient } from "mongodb";

async function verifyMongoDBData() {
  const mongoUri = process.env.MONGODB_URI!;
  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    console.log("✅ Connected to MongoDB Atlas");

    const db = client.db("realm_sync_test");

    // Check users collection
    console.log("\n📊 Users Collection:");
    const users = await db
      .collection("users")
      .find({})
      .sort({ sync_updated_at: -1 })
      .limit(10)
      .toArray();
    console.log(`  Total documents: ${users.length}`);
    users.forEach((user, idx) => {
      console.log(
        `  ${idx + 1}. ${user.name} (${user.email}) - Updated: ${new Date(user.sync_updated_at).toLocaleString()}`
      );
    });

    // Check tasks collection
    console.log("\n📋 Tasks Collection:");
    const tasks = await db
      .collection("tasks")
      .find({})
      .sort({ sync_updated_at: -1 })
      .limit(10)
      .toArray();
    console.log(`  Total documents: ${tasks.length}`);
    tasks.forEach((task, idx) => {
      console.log(
        `  ${idx + 1}. "${task.title}" - Completed: ${task.completed} - Updated: ${new Date(task.sync_updated_at).toLocaleString()}`
      );
    });

    // Check notes collection
    console.log("\n📝 Notes Collection:");
    const notes = await db
      .collection("notes")
      .find({})
      .sort({ sync_updated_at: -1 })
      .limit(10)
      .toArray();
    console.log(`  Total documents: ${notes.length}`);
    notes.forEach((note, idx) => {
      console.log(
        `  ${idx + 1}. "${note.content.substring(0, 50)}..." - Updated: ${new Date(note.sync_updated_at).toLocaleString()}`
      );
    });

    // Check sync changes log
    console.log("\n📜 Sync Changes Log:");
    const changes = await db
      .collection("_sync_changes")
      .find({})
      .sort({ timestamp: -1 })
      .limit(10)
      .toArray();
    console.log(`  Total change records: ${changes.length}`);
    changes.forEach((change, idx) => {
      console.log(
        `  ${idx + 1}. ${change.operation.toUpperCase()} ${change.collection}/${change.documentId} - Synced: ${change.synced ? "✅" : "⏳"}`
      );
    });

    console.log("\n✅ Verification complete!");
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await client.close();
  }
}

verifyMongoDBData().catch(console.error);
