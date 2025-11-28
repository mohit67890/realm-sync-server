/**
 * Script to check for DELETE operations in MongoDB
 */

import * as dotenv from "dotenv";
dotenv.config();

import { MongoClient } from "mongodb";

async function checkDeleteOperations() {
  const mongoUri = process.env.MONGODB_URI!;
  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    console.log("✅ Connected to MongoDB Atlas");

    const db = client.db("realm_sync_test");

    // Check for DELETE operations in sync changes log
    console.log("\n🗑️  DELETE Operations in Sync Log:");
    const deleteChanges = await db
      .collection("_sync_changes")
      .find({ operation: "delete" })
      .sort({ timestamp: -1 })
      .limit(20)
      .toArray();

    console.log(`  Found ${deleteChanges.length} DELETE operations`);
    deleteChanges.forEach((change, idx) => {
      console.log(
        `  ${idx + 1}. DELETE ${change.collection}/${change.documentId} - Synced: ${change.synced ? "✅" : "⏳"} - Time: ${new Date(change.timestamp).toLocaleString()}`
      );
    });

    if (deleteChanges.length === 0) {
      console.log("  ⚠️  No DELETE operations found in sync log!");
    }

    // Check notes collection for deleted note IDs
    console.log("\n📝 Checking for specific note IDs:");
    const noteIds = ["note-91205fec", "note-8652356c", "note-07d672c3"];
    for (const noteId of noteIds) {
      const note = await db.collection("notes").findOne({ _id: noteId } as any);
      if (note) {
        console.log(`  ❌ ${noteId} still exists in notes collection!`);
      } else {
        console.log(
          `  ✅ ${noteId} successfully deleted from notes collection`
        );
      }
    }
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await client.close();
  }
}

checkDeleteOperations().catch(console.error);
