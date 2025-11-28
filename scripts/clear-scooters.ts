import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';

dotenv.config();

async function clearCollections() {
  const uri = process.env.MONGODB_URI || '';
  if (!uri) {
    console.error('❌ MONGODB_URI not found');
    process.exit(1);
  }
  
  const client = new MongoClient(uri);
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = client.db('test');
    
    await db.collection('scooters').deleteMany({});
    console.log('🗑️  Cleared scooters collection');
    
    await db.collection('scooter_shops').deleteMany({});
    console.log('🗑️  Cleared scooter_shops collection');
    
  } finally {
    await client.close();
  }
}

clearCollections().catch(console.error);
