import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';
dotenv.config();
async function clear() {
  const client = new MongoClient(process.env.MONGODB_URI || '');
  try {
    await client.connect();
    await client.db('test').collection('chatrooms').deleteMany({});
    console.log('🗑️  Cleared chatrooms');
  } finally {
    await client.close();
  }
}
clear();
