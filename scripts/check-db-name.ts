import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config();

async function checkDatabase() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("❌ MONGODB_URI not set");
    process.exit(1);
  }

  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db();

    console.log("📊 Database name:", db.databaseName);
    console.log("\n📂 Collections:");
    const collections = await db.listCollections().toArray();
    collections.forEach((c) => console.log("   -", c.name));
  } finally {
    await client.close();
  }
}

checkDatabase();
