import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config();

async function inspect() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("❌ MONGODB_URI not set");
    process.exit(1);
  }

  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db();

    // Get all goals sorted by sync_updated_at descending
    const goals = await db
      .collection("goals")
      .find({})
      .sort({ sync_updated_at: -1 })
      .limit(10)
      .toArray();
    console.log(`📄 Found ${goals.length} recent goals\n`);

    // Show most recent batch goal (not the server created one)
    const batchGoal =
      goals.find((g) => g.title !== "Server Created Goal") || goals[1];
    console.log(
      '📄 Most Recent Batch Goal Document (expected to have title="Batch Goal X"):'
    );
    console.log(JSON.stringify(batchGoal, null, 2));

    // Get corresponding sync change
    if (batchGoal) {
      const change = await db
        .collection("_sync_changes")
        .findOne({ documentId: batchGoal._id });
      console.log("\n📄 Corresponding Sync Change:");
      console.log(JSON.stringify(change, null, 2));
    }
  } finally {
    await client.close();
  }
}

inspect();
