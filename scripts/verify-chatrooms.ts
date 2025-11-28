import * as dotenv from "dotenv";
dotenv.config();

import { MongoClient } from "mongodb";

async function verifyChatRooms() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("❌ MONGODB_URI not set in environment/.env");
    process.exit(1);
  }

  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB Atlas");

    // Use default DB from URI unless explicitly set; fall back to 'realm_sync_test'
    const dbName = client.db().databaseName || "realm_sync_test";
    const db = client.db(dbName);

    console.log(`\n📋 Checking 'chatrooms' in database: ${dbName}`);

    // Find recent chatrooms (last 20) sorted by sync_updated_at desc
    const rooms = await db
      .collection("chatrooms")
      .find({})
      .sort({ sync_updated_at: -1 })
      .limit(20)
      .toArray();

    if (!rooms.length) {
      console.log("  No chatrooms found.");
    } else {
      console.log(`  Found ${rooms.length} chatrooms:`);
      for (let i = 0; i < rooms.length; i++) {
        const r: any = rooms[i];
        const updatedAt = r.sync_updated_at
          ? new Date(r.sync_updated_at).toISOString()
          : "n/a";
        console.log(
          `  ${i + 1}. _id: ${r._id} | name: ${r.name} | _updated_by: ${r._updated_by} | sync_updated_at: ${updatedAt}`
        );
        if (r.members) {
          console.log(
            `     members: ${Array.isArray(r.members) ? r.members.join(", ") : JSON.stringify(r.members)}`
          );
        }
        if (r.lastMessage) {
          console.log(`     lastMessage: ${r.lastMessage}`);
        }
        if (r.users) {
          console.log(`     users field structure:`);
          console.log(JSON.stringify(r.users, null, 6));
        }
      }
    }

    // Also show recent _sync_changes for chatrooms
    console.log("\n📜 Recent _sync_changes for 'chatrooms':");
    const changes = await db
      .collection("_sync_changes")
      .find({ collection: "chatrooms" })
      .sort({ timestamp: -1 })
      .limit(20)
      .toArray();
    if (!changes.length) {
      console.log("  No changes recorded for 'chatrooms'.");
    } else {
      console.log(`  Found ${changes.length} change records:`);
      changes.forEach((c: any, idx: number) => {
        console.log(
          `  ${idx + 1}. ${c.operation.toUpperCase()} docId=${c.documentId} by=${c.userId} at=${new Date(c.timestamp).toISOString()}`
        );
      });
    }

    console.log("\n✅ Verification complete.");
  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

verifyChatRooms();
