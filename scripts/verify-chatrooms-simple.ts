import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';

dotenv.config();

async function verify() {
  const client = new MongoClient(process.env.MONGODB_URI || '');
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');
    
    const db = client.db('test');
    const rooms = await db.collection('chatrooms')
      .find({})
      .sort({ _id: -1 })
      .limit(1)
      .toArray();
    
    console.log('Most recent chatroom:');
    console.log(JSON.stringify(rooms[0], null, 2));
  } finally {
    await client.close();
  }
}

verify();
