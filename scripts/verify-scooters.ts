import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config();

const uri = process.env.MONGODB_URI || "";
const dbName = "test";

async function verifyScooters() {
  if (!uri) {
    console.error("❌ MONGODB_URI not found in .env file");
    process.exit(1);
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log("✅ Connected to MongoDB Atlas\n");

    const db = client.db(dbName);

    // Check scooters collection
    const scootersCollection = db.collection("scooters");
    const scooters = await scootersCollection.find({}).limit(2).toArray();
    console.log(`📋 Checking 'scooters' in database: ${dbName}`);
    console.log(
      `  Found ${scooters.length} scooters (showing first 2 with full structure):\n`
    );

    scooters.forEach((scooter, index) => {
      console.log(`  ${index + 1}. Raw document structure:`);
      console.log(JSON.stringify(scooter, null, 2));
      console.log("");
    });

    // Check scooter_shops collection
    console.log(`\n📋 Checking 'scooter_shops' in database: ${dbName}`);
    const shopsCollection = db.collection("scooter_shops");
    const shops = await shopsCollection.find({}).limit(1).toArray();
    console.log(
      `  Found ${shops.length} scooter shops (showing first 1 with full structure):\n`
    );

    shops.forEach((shop, index) => {
      console.log(`  ${index + 1}. Raw document structure:`);
      console.log(JSON.stringify(shop, null, 2));
      console.log("");
    });

    console.log("\n✅ Verification complete.");
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await client.close();
  }
}

verifyScooters();
