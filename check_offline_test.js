const { MongoClient } = require("mongodb");

async function checkOfflineSyncTest() {
  const uri =
    "mongodb+srv://mohit0321:Emotionlydb1!@emotionly.tprpr.mongodb.net/";
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db("sync-test-db");

    console.log("\n🔍 Checking for test-offline-sync-user data:\n");

    // Check _sync_changes
    const changes = await db
      .collection("_sync_changes")
      .find({ userId: "test-offline-sync-user" })
      .sort({ timestamp: 1 })
      .toArray();

    console.log(`📋 _sync_changes: Found ${changes.length} changes\n`);
    changes.forEach((change, i) => {
      console.log(
        `  ${i + 1}. ${change.operation} ${change.collection}:${change.documentId}`
      );
      console.log(`     Data: ${JSON.stringify(change.data)}`);
      console.log(`     Time: ${change.timestamp}`);
      console.log();
    });

    // Check tasks collection
    const tasks = await db
      .collection("tasks")
      .find({ _updated_by: "test-offline-sync-user" })
      .sort({ priority: 1 })
      .toArray();

    console.log(`\n📝 tasks collection: Found ${tasks.length} tasks\n`);
    tasks.forEach((task, i) => {
      console.log(`  ${i + 1}. ID: ${task._id}`);
      console.log(`     Title: ${task.title}`);
      console.log(`     Priority: ${task.priority}`);
      console.log(`     Created Offline: ${task.created_offline || false}`);
      console.log(`     Updated by: ${task._updated_by}`);
      console.log(`     Updated at: ${task.sync_updated_at}`);
      console.log();
    });
  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    await client.close();
  }
}

checkOfflineSyncTest();
