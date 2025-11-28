import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';

dotenv.config();

async function verify() {
  const client = new MongoClient(process.env.MONGODB_URI || '');
  try {
    await client.connect();
    const db = client.db('test');
    
    // Find chatroom with users data
    const room = await db.collection('chatrooms')
      .findOne({ 'name': { $regex: 'Alice.*Bob' } });
    
    if (!room) {
      console.log('❌ No chatroom with users found');
      return;
    }
    
    console.log('✅ Found chatroom with nested users:\n');
    console.log('Room ID:', room._id);
    console.log('Room name:', room.name);
    console.log('Members:', room.members);
    console.log('\nUsers field (nested objects):');
    console.log(JSON.stringify(room.users, null, 2));
  } finally {
    await client.close();
  }
}

verify();
